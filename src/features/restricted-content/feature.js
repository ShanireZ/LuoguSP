import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { createArticleInteractionStore } from "./article-interaction-store.js";
import { prepareRestrictedArticleInteraction } from "./article-interaction-tracker.js";
import { resolveLiveArticleCounts } from "./article-live-counts.js";
import { relabelArchiveTime } from "./archive-time-label.js";
import { createRestrictedDocumentBoot } from "./document-boot.js";
import {
  createRestrictedDocumentCommitter,
  serializeJsonForScript,
} from "./document-committer.js";
import {
  RST_BTN_ICONS,
  RST_EXTRA_CSS,
  RST_LOADER_CONTENT_HTML,
  RST_LOADER_HTML,
  injectRstStyle,
  rstEscapeHtmlText,
  rstFmtTime,
  rstPreparationError,
  rstSafeCsrf,
  rstTrustedCdnUrl,
  rstUserSummary,
} from "./presentation.js";
import {
  buildColumbaDocument,
  columbaScaffoldProblem,
  parseColumbaScaffold,
} from "./columba-scaffold.js";
import { createRestrictedPageDetector } from "./page-detector.js";
import {
  buildPasteShowContext,
  findPasteChrome,
  pasteTimeLabel,
} from "./paste-show.js";
import { pickPublishTime } from "./publish-time.js";
import { createRestrictedReplyFetchInstaller } from "./reply-fetch-installer.js";
import { resolveRestrictedTransportRealm } from "./transport-realm.js";
import { createRestrictedUrlPolicy } from "./url-policy.js";
import { createSaverProtocol } from "./saver-protocol.js";
import { createSaverTransport } from "./saver-transport.js";
import { createSaverWorkflow } from "./saver-workflow.js";

export function createRestrictedContentFeature({
  storage,
  restrictedLoadingGate,
  getPageLifecycle,
}) {
  const SELECTORS = {
    restrictedUrlPre: "pre#url",
  };

  // ============================================================
  // 显示受限文章与剪贴板（原生壳注入）
  // 国内站访问非本人/未审核的 /article、/paste 会落在「安全访问中心」拦截页
  // （独立静态页、零全站样式、无 CSP）。本功能在拦截页上重建官方页面：
  //   1) 壳骨架收割：从 .cn 同源 columba 页拿官方壳（/ranking、/discuss；
  //      骨架自带真实 csrf、当前登录用户、用户主题、官方脚本当前版本——全部活取，绝不写死）；
  //   2) 数据合成：把保存站存档映射为 lentille-context
  //      （文章 template "article.show"；剪贴板 template "paste.show"）；
  //   3) document.write 重建文档并加载官方前端 JS——顶栏/侧栏/主题/登录态/markdown/评论组件
  //      全部由洛谷原生前端渲染，本脚本零复刻（2026-07-22 owner 拍板弃手工烘焙路线）；
  //   4) 网络包装（window 不随 document.write 重建，包装器天然存活）：
  //      评论接口 GET /article/{id}/replies 优先读取洛谷实时数据，仅失败时用保存站存档；
  //      回退形状 {replySlice:[{id,author:userSummary,time,content}]}，支持 sort=time-d、after=<id>；
  //      官方点赞/收藏/评论写入仅由用户点击触发，使用同源 Cookie 与壳页面的真实 CSRF；
  //   5) 官方渲染完成后注入两枚蓝色扩展按钮（申请更新 / 国际站原文）：
  //      文章页=互动条 button-2line 挂「不推荐」右侧；剪贴板页=元信息行右侧实心按钮。
  // 数据源=洛谷保存站 api.luogu.me（CORS 开放、匿名；owner 拍板纯保存站+更新仅手动）；
  // 作者数据走 .cn 同源 /api/user/search（owner 要求不吃保存站/国际站的用户数据）。
  // ★保存站硬边界：payload 的 createdAt 是入档时间，非原文发布时间（无接口可取原始时间）。
  // ============================================================
  const SAVER_API = "https://api.luogu.me";
  const saverClock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const saverTransport = createSaverTransport({
    baseUrl: SAVER_API,
    fetch: (url, init) => fetch(url, init),
    clock: saverClock,
    timeoutMs: 15000,
  });
  const saverProtocol = createSaverProtocol();
  const saverWorkflow = createSaverWorkflow({
    transport: saverTransport,
    protocol: saverProtocol,
    clock: saverClock,
  });
  const restrictedUrlPolicy = createRestrictedUrlPolicy();
  // 受限文章页没有可读回当前账号 favored/voted 的官方只读接口（保存站也不提供），
  // 因此已确认的个人状态只能来自官方写响应，并按「UID + 文章 ID」隔离持久化。
  const rstInteractionStore = createArticleInteractionStore({
    storage: typeof localStorage === "undefined" ? null : localStorage,
  });

  // 拦截页判定：URL 形态 + 标题 + pre#url 内容三重锚点；不满足=正常页面，绝不接管
  const restrictedPageDetector = createRestrictedPageDetector({
    path: () => location.pathname,
    title: () => document.title,
    target: () => {
      const pre = document.querySelector(SELECTORS.restrictedUrlPre);
      return pre ? (pre.textContent || "").trim() : "";
    },
    urlPolicy: restrictedUrlPolicy,
  });


  // 作者等用户数据一律走国内站同源接口（owner 要求：不吃保存站/国际站的用户数据；头像也全走 .cn CDN）。
  // 接口=/api/user/search?keyword={uid}（拦截页源实测可用；旧 /user/{uid}?_contentOnly=1 已死，返回 HTML），
  // 返回 userSummary：{uid,name,avatar,slogan,badge,color,ccfLevel,xcpcLevel,…}。失败回退存档快照。
  const rstUserCache = new Map();
  async function rstFetch(input, signal, init) {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    if (signal && signal.aborted)
      throw Object.assign(new Error("受限文档准备已取消"), {
        kind: "cancelled",
      });
    if (signal) signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    try {
      return await fetch(input, { ...(init || {}), signal: controller.signal });
    } catch (error) {
      if (error && error.name === "AbortError")
        throw Object.assign(
          new Error(timedOut ? "洛谷页面数据请求超时" : "受限文档准备已取消"),
          { kind: timedOut ? "timeout" : "cancelled" },
        );
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", cancel);
    }
  }
  async function rstCnUser(uid, signal) {
    if (!uid) return null;
    if (rstUserCache.has(uid)) return rstUserCache.get(uid);
    let user = null;
    try {
      const res = await rstFetch(
        `/api/user/search?keyword=${encodeURIComponent(uid)}`,
        signal,
      );
      const json = await res.json();
      const list = (json && json.users) || [];
      user = list.find((u) => u && Number(u.uid) === Number(uid)) || null;
    } catch (e) {
      if (e && e.kind === "cancelled") throw e;
      /* 回退存档快照 */
    }
    rstUserCache.set(uid, user);
    return user;
  }

  // 加载动效覆盖层：接管 document-start 早期遮罩，并跨 document.write 保持到原生内容锚点就绪
  function rstShowLoader(text) {
    injectRstStyle();
    let el = document.getElementById("luogusp-rst-loader");
    if (!el) {
      el = document.createElement("div");
      el.id = "luogusp-rst-loader";
      el.className = "luogusp-rst-loader";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML = RST_LOADER_CONTENT_HTML;
      (document.body || document.documentElement).appendChild(el);
    }
    el.querySelector(".msg").textContent = text || "加载中…";
    if (restrictedLoadingGate) restrictedLoadingGate.release();
  }
  function rstHideLoader() {
    const el = document.getElementById("luogusp-rst-loader");
    if (el) el.remove();
    if (restrictedLoadingGate) restrictedLoadingGate.release();
  }
  function rstShowUnavailableTip(info, message) {
    rstBuildFailure(info, message);
  }
  function rstBuildFailure(info, reason) {
    rstHideLoader();
    document.title =
      (info.type === "article" ? "文章" : "云剪贴板") + " - 洛谷";
    document.body.className = "luogusp-rst-plain";
    document.body.innerHTML = `
      <div class="luogusp-rst-plaincard"><h1 style="font-size:20px;margin:0 0 10px;">未能获取内容</h1>
      <p></p>
      <p>可能原因：内容未公开、未通过审核，或保存站暂时不可用。</p>
      <p><a class="luogusp-rst-original" rel="noopener noreferrer">前往国际站查看原文 →</a></p>
      <p class="luogusp-rst-note">此页面由 LuoguSP 生成 · 数据来源：洛谷保存站</p></div>`;
    document.querySelector(".luogusp-rst-plaincard p").textContent =
      String(reason);
    document.querySelector(".luogusp-rst-original").href = info.origUrl;
  }

  // 壳骨架收割：/ranking、/discuss 任一带 lentille-context 即用。
  // 2026-09 剪贴板已迁 paste.show，旧 lfe 源 /image、/theme/list 分别是 401 和 404。
  async function rstHarvest(signal) {
    for (const src of ["/ranking", "/discuss"]) {
      try {
        const res = await rstFetch(src, signal);
        const html = await res.text();
        if (html.includes("lentille-context")) return html;
      } catch (e) {
        if (e && e.kind === "cancelled") throw e;
        /* 换下一个源 */
      }
    }
    return null;
  }
  function readColumbaShell(scaffold) {
    const parsed = parseColumbaScaffold(scaffold);
    const problem = columbaScaffoldProblem(parsed, {
      isTrustedUrl: rstTrustedCdnUrl,
      isSafeCsrf: rstSafeCsrf,
    });
    if (problem === "theme")
      throw rstPreparationError("洛谷主题数据解析失败（结构可能已改版）。");
    if (problem)
      throw rstPreparationError("洛谷页面骨架解析失败（结构可能已改版）。");
    return {
      csrf: parsed.csrf,
      globalsRaw: parsed.globalsRaw,
      scripts: parsed.scripts,
      cssLinks: parsed.cssLinks,
      themeJson: parsed.themeRaw
        ? serializeJsonForScript(parsed.theme)
        : "",
      viewer: parsed.context.user || null,
    };
  }
  function columbaHtml(title, shell, ctx) {
    return buildColumbaDocument({
      title,
      csrf: shell.csrf,
      globalsRaw: shell.globalsRaw,
      contextJson: serializeJsonForScript(ctx),
      scripts: shell.scripts,
      cssLinks: shell.cssLinks,
      themeJson: shell.themeJson,
      extraCss: RST_EXTRA_CSS,
      bodySuffix: RST_LOADER_HTML,
    });
  }
  // 嵌入 <script> 的 JSON 防拆壳（内容里出现 </script> 会截断壳文档）

  // 官方文章组件启动后会 GET /article/{lid}/replies（?sort=&after=）：先请求洛谷，
  // 仅失败时回退保存站。写操作仍由官方 UI 的用户点击触发，包装器只补同源凭据与 CSRF。
  // fetch / XMLHttpRequest 包装器不随 document.write 重建，天然对新文档生效；其余请求全部放行。
  // ★包装必须打在**页面主世界**上：官方前端跑在那里，而管理器可能把本脚本放进沙箱
  //   作用域（Tampermonkey 用了 @grant 时即使声明 @sandbox raw 也会如此）。
  const rstTransportRealm = resolveRestrictedTransportRealm({
    scriptWindow: typeof window === "undefined" ? null : window,
    pageWindow: typeof unsafeWindow === "undefined" ? null : unsafeWindow,
  });
  const rstReplyTransportInstaller = rstTransportRealm
    ? createRestrictedReplyFetchInstaller({
        host: rstTransportRealm.host,
        origin: location.origin,
        Response: rstTransportRealm.Response,
        URL: rstTransportRealm.URL,
        Request: rstTransportRealm.Request,
        Headers: rstTransportRealm.Headers,
      })
    : null;
  const rstDisposeReplyTransport = () => {
    if (rstReplyTransportInstaller) rstReplyTransportInstaller.dispose();
  };
  function rstInstallArticleTransport(lid, comments, csrf, onWrite) {
    const mapped = comments.map((c, i) => {
      const a = c.author || {};
      const sourceId = Number(c.id);
      return {
        id:
          Number.isSafeInteger(sourceId) && sourceId > 0
            ? sourceId
            : i + 1,
        author: rstUserSummary(null, a, a.id),
        time: Number(c.time) || 0,
        content: String(c.content || ""),
      };
    });
    return rstReplyTransportInstaller
      ? rstReplyTransportInstaller.install(lid, mapped, csrf, onWrite)
      : () => {};
  }

  // 文章页：合成 lentille-context（template article.show）+ 官方 columba 前端
  async function rstBootArticle(info, data, signal) {
    const [scaffold, cnUser, commentsResult, live] = await Promise.all([
      rstHarvest(signal),
      rstCnUser(data.authorId, signal),
      saverWorkflow.loadComments(info.id, { signal }),
      resolveLiveArticleCounts({
        fetchPage: rstFetch,
        authorUid: data.authorId,
        lid: info.id,
        category: data.category,
        signal,
        // article-live-counts.js 写死了「截断必须报出来」，但此前这里根本没接线，
        // 于是「扫不完所以没找到」和「洛谷确实没有这条数据」在日志里长得一模一样。
        onTruncated: ({ totalPages, scannedPages, category }) =>
          console.warn(
            `[LuoguSP] 文章 ${info.id} 的实时计数只扫了作者专栏的 ${scannedPages}/${totalPages} 页` +
              `${category === null ? "" : `（分类 ${category}）`}，未命中不代表洛谷没有这条数据。`,
          ),
      }),
    ]);
    if (!scaffold)
      throw rstPreparationError("无法获取洛谷页面骨架，暂不能就地渲染。");
    const shell = readColumbaShell(scaffold);
    const comments =
      commentsResult.kind === "available" &&
      Array.isArray(commentsResult.data.comments)
        ? commentsResult.data.comments
        : [];
    const { interaction, tracker: interactionTracker } =
      prepareRestrictedArticleInteraction({
        store: rstInteractionStore,
        origin: location.origin,
        lid: info.id,
        viewer: shell.viewer,
        // 存档快照的新鲜度：只有比已确认记录更新，保存站计数才允许覆盖。
        archivedAt: Date.parse(data.updatedAt || data.createdAt) || null,
        archived: data,
        live,
        onPersistFailure: ({ lid, reason }) =>
          console.warn(
            `[LuoguSP] 文章 ${lid} 的收藏/点赞状态无法保存（${reason}），刷新后将无法撤回。`,
          ),
        article: {
          lid: data.id,
          title: data.title || "",
          category: data.category != null ? data.category : 1,
          // 真实发表时间：保存站 publishTime → 作者专栏列表现扫 → 都没有才退回入档时间，
          // 而那种情况下时间栏的文案会被改成「存档时间」（见 rstMountArticleButtons）。
          time:
            pickPublishTime(data, live) ??
            (Math.floor(new Date(data.createdAt).getTime() / 1000) || 0),
          author: rstUserSummary(cnUser, data.author, data.authorId),
          upvote: Number(data.upvote) || 0,
          replyCount: comments.length,
          favorCount: Number(data.favorCount) || 0,
          status: 2,
          solutionFor: null,
          promoteStatus: 0,
          collection: null,
          content: String(data.content || ""),
          contentFull: true,
          adminNote: null,
        },
      });
    const ctx = {
      instance: "main",
      template: "article.show",
      status: 200,
      locale: "zh-CN",
      data: {
        ...interaction,
      },
      user: shell.viewer,
      time: Math.floor(Date.now() / 1000),
    };
    const title = rstEscapeHtmlText(data.title || "文章");
    return {
      kind: "article",
      html: columbaHtml(`${title} - 洛谷专栏`, shell, ctx),
      install: () =>
        rstInstallArticleTransport(
          info.id,
          comments,
          shell.csrf,
          interactionTracker.observeWrite,
        ),
      rollback: rstDisposeReplyTransport,
      afterReady: () => rstMountArticleButtons(info, data, live),
    };
  }

  // 剪贴板页：合成 lentille-context（template paste.show）+ 官方 columba 前端。
  async function rstBootPaste(info, data, signal) {
    const [scaffold, cnUser] = await Promise.all([
      rstHarvest(signal),
      rstCnUser(data.authorId, signal),
    ]);
    if (!scaffold)
      throw rstPreparationError("无法获取洛谷页面骨架，暂不能就地渲染。");
    const shell = readColumbaShell(scaffold);
    // 剪贴板没有作者专栏列表那条路，真值只可能来自保存站的 publishTime；
    // 没有就退回入档时间，并把文案改成「存档时间」（见 rstMountPasteButtons）。
    const ctx = buildPasteShowContext({
      id: data.id || info.id,
      content: data.content,
      user: rstUserSummary(cnUser, data.author, data.authorId),
      time:
        pickPublishTime(data, null) ??
        (Math.floor(new Date(data.createdAt).getTime() / 1000) || 0),
      viewer: shell.viewer,
      now: Math.floor(Date.now() / 1000),
    });
    return {
      kind: "paste",
      html: columbaHtml("云剪贴板 - 洛谷", shell, ctx),
      afterReady: () => rstMountPasteButtons(info, data),
    };
  }

  // 官方前端可能连续多次重绘；同一帧只补种一次，并在补种期间暂停观察，
  // 避免扩展节点自身触发下一轮全页扫描。
  const rstInjectionDisposers = new Set();
  function rstObserveInjection(inject) {
    const root = document.body || document.documentElement;
    const options = { childList: true, subtree: true };
    let frame = null;
    let observer = null;
    const run = () => {
      frame = null;
      if (observer) observer.disconnect();
      try {
        inject();
      } catch (e) {
        console.error("LuoguSP restricted inject:", e);
      } finally {
        if (observer) observer.observe(root, options);
      }
    };
    run(); // 首次同步补种，保持按钮出现时机不变
    observer = new MutationObserver(() => {
      if (frame === null) frame = requestAnimationFrame(run);
    });
    observer.observe(root, options);
    const dispose = () => {
      if (observer) observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      observer = null;
      frame = null;
      rstInjectionDisposers.delete(dispose);
    };
    rstInjectionDisposers.add(dispose);
    return dispose;
  }

  // 扩展按钮（文章页）：等官方前端渲染出互动条再注入；Vue 重渲染会抹节点，观察器负责补种。
  // 同时在正文底部「创建时间：…」后方补「更新时间」＝保存站存档最近更新时间（updatedAt），
  // 供 owner 判断是否需要点「申请更新」。
  function rstMountArticleButtons(info, data, live) {
    const updText = rstFmtTime(data && data.updatedAt, true);
    // owner 要求：扩展按钮不带 title 悬浮说明（与时间栏一致，页面不出浏览器浮泡）
    const make = (icon, extraCls, text, onClick) => {
      const div = document.createElement("div");
      div.className = `button-2line luogusp-rst-abtn ${extraCls}`;
      div.innerHTML = `<svg class="svg-inline--fa icon" style="font-size:1.25em" viewBox="${icon.vb}" aria-hidden="true"><path fill="currentColor" d="${icon.d}"/></svg><span class="text">${text}</span>`;
      div.addEventListener("click", onClick);
      return div;
    };
    const inject = () => {
      const actionBars = [
        ...document.querySelectorAll(".article-content .actions"),
      ].filter((bar) => !bar.classList.contains("left-mode"));
      actionBars.forEach((bar) => {
        // owner 拍板：左浮条（left-mode）不放扩展按钮，只挂内联互动条
        if (bar.querySelector(".luogusp-rst-abtn")) return;
        bar.appendChild(
          make(
            RST_BTN_ICONS.refresh,
            "luogusp-rst-btn-refresh",
            "申请更新",
            () => rstManualRefresh(info),
          ),
        );
        bar.appendChild(
          make(RST_BTN_ICONS.external, "", "国际站原文", () =>
            window.open(info.origUrl, "_blank", "noopener"),
          ),
        );
      });
      // owner 要求：指向创建/更新时间不出浏览器悬浮泡 → 整条时间栏剥 title
      // （removeAttribute 无属性时不产生变更记录，天然幂等）
      const updateBars = [
        ...document.querySelectorAll(".article-content .update-info"),
      ];
      updateBars.forEach((bar) => {
        bar.removeAttribute("title");
        bar
          .querySelectorAll("[title]")
          .forEach((n) => n.removeAttribute("title"));
      });
      if (updText)
        updateBars.forEach((bar) => {
          if (bar.querySelector(".luogusp-rst-updtime")) return;
          const ref = [...bar.querySelectorAll("span")].find((s) =>
            /创建时间|存档时间/.test(s.textContent || ""),
          );
          const span = document.createElement("span");
          if (ref)
            for (const at of ref.attributes)
              if (at.name.startsWith("data-v-"))
                span.setAttribute(at.name, at.value); // 继承 data-v 作用域样式
          span.classList.add("luogusp-rst-updtime");
          span.textContent = `更新时间：${updText}`;
          const sep = document.createTextNode("    ");
          if (ref) ref.after(sep, span);
          else bar.append(sep, span);
        });
      // 取不到真实发表时间时，这一行其实是保存站入档时间，别标成「创建时间」。
      if (pickPublishTime(data, live) === null)
        relabelArchiveTime(updateBars, "创建时间");
      rstApplyRefreshBtns(); // Vue 重种出的「申请更新」按钮要重新套用当前状态
      if (actionBars.length && updateBars.length) rstHideLoader();
    };
    return rstObserveInjection(inject);
  }
  // 扩展按钮（剪贴板页）：元信息行（meta-row）右侧两枚实心蓝钮。
  // 该行是 flex space-between，作者和时间在 .meta-left，本容器落位最右。
  // 「更新时间」跟在「发布时间」同一行，值是保存站存档最近更新时间（updatedAt）。
  function rstMountPasteButtons(info, data) {
    const updText = rstFmtTime(data && data.updatedAt, false);
    const inject = () => {
      const chrome = findPasteChrome(document);
      if (!chrome) return;
      const { actionsHost, timeRow } = chrome;
      if (!actionsHost.querySelector(".luogusp-rst-pactions")) {
        // owner 要求：扩展按钮不带 title 悬浮说明（与时间栏一致，页面不出浏览器浮泡）
        const mk = (extraCls, text, onClick) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `luogusp-rst-pbtn ${extraCls}`;
          b.textContent = text;
          b.addEventListener("click", onClick);
          return b;
        };
        const box = document.createElement("div");
        box.className = "luogusp-rst-pactions";
        box.append(
          mk("luogusp-rst-btn-refresh", "申请更新", () =>
            rstManualRefresh(info),
          ),
          mk("", "国际站原文", () =>
            window.open(info.origUrl, "_blank", "noopener"),
          ),
        );
        actionsHost.appendChild(box);
      }
      // owner 要求：指向发表/更新时间不出浏览器悬浮泡 → 时间行剥 title
      // （removeAttribute 无属性时不产生变更记录，天然幂等）
      timeRow.removeAttribute("title");
      timeRow
        .querySelectorAll("[title]")
        .forEach((node) => node.removeAttribute("title"));
      const meta = timeRow.parentElement;
      if (updText && meta && !meta.querySelector(".luogusp-rst-updtime")) {
        const span = document.createElement("span");
        span.className = "luogusp-rst-updtime";
        span.textContent = `更新时间 ${updText}`;
        timeRow.after(span);
      }
      // 保存站给不出真实发表时间时，这一行只能是存档时间。
      // 当前官方文案是「发布时间」，旧壳是「发表时间」。
      if (pickPublishTime(data, null) === null) {
        const label = pasteTimeLabel(timeRow);
        if (label) relabelArchiveTime([timeRow], label);
      }
      rstApplyRefreshBtns(); // Vue 重种出的「申请更新」按钮要重新套用当前状态
      rstHideLoader();
    };
    return rstObserveInjection(inject);
  }

  // 申请更新（手动）：状态机 idle=可点 / busy=更新中… / done=已申请。
  // owner 口径（2026-07-23）：提交成功即锁定「已申请」且不可再点，不轮询不自动刷新，
  // 直至用户主动刷新页面（保存工作流异步完成，刷新后自然装配新档）；仅提交失败允许重试。
  // Vue 重渲染会抹掉按钮由观察器重种，故状态存模块级、每次补种后重新套用（rstApplyRefreshBtns）。
  let rstRefreshState = "idle";
  let rstRefreshText = "申请更新";
  let rstRefreshResetTimer = null;
  let rstRefreshController = null;
  // ★本函数被 inject 观察器（body childList+subtree）的回调无条件调用，必须幂等：
  // textContent 同值重写也会删旧建新 Text 节点、产生 childList 变更记录，
  // 会把观察器自己再触发一遍 → 微任务死循环整页卡死（2.11.0 事故），故同值不写。
  function rstApplyRefreshBtns() {
    const off = rstRefreshState !== "idle";
    document.querySelectorAll(".luogusp-rst-btn-refresh").forEach((el) => {
      const t = el.querySelector(".text") || el;
      if (t.textContent !== rstRefreshText) t.textContent = rstRefreshText;
      el.classList.toggle("luogusp-rst-off", off);
      if (el.tagName === "BUTTON" && el.disabled !== off) el.disabled = off;
    });
  }
  function rstSetRefresh(state, text) {
    rstRefreshState = state;
    rstRefreshText = text;
    rstApplyRefreshBtns();
  }
  function rstScheduleRefreshReset() {
    if (rstRefreshResetTimer !== null)
      clearTimeout(rstRefreshResetTimer);
    rstRefreshResetTimer = setTimeout(() => {
      rstRefreshResetTimer = null;
      if (rstRefreshState === "idle") rstSetRefresh("idle", "申请更新");
    }, 3000);
  }
  async function rstManualRefresh(info) {
    if (rstRefreshState !== "idle") return;
    const controller = new AbortController();
    rstRefreshController = controller;
    const current = () =>
      rstRefreshController === controller && !controller.signal.aborted;
    let commentsPending = false;
    rstSetRefresh("busy", "更新中…");
    try {
      const result = await saverWorkflow.requestRefresh(info.type, info.id, {
        signal: controller.signal,
      });
      if (!current()) return;
      if (result.kind === "unknown") {
        rstSetRefresh("idle", "结果未知");
        rstScheduleRefreshReset();
        return;
      }
      if (result.kind !== "accepted")
        throw new Error(result.reason || "保存站拒绝更新请求");
      rstSetRefresh("done", "已申请");
      if (info.type === "article") {
        commentsPending = true;
        const finishComments = () => {
          if (rstRefreshController === controller)
            rstRefreshController = null;
        };
        void saverWorkflow
          .refreshComments(info.id, { signal: controller.signal })
          .then(finishComments, finishComments);
      }
    } catch (e) {
      if (!current()) return;
      console.error("LuoguSP restricted refresh:", e);
      rstSetRefresh("idle", "更新失败");
      rstScheduleRefreshReset();
    } finally {
      if (!commentsPending && rstRefreshController === controller)
        rstRefreshController = null;
    }
  }

  const restrictedDocumentBuilder = {
    prepare: async (info, data, signal) => {
      if (signal.aborted)
        throw Object.assign(new Error("受限文档准备已取消"), {
          kind: "cancelled",
        });
      const prepared =
        info.type === "article"
          ? await rstBootArticle(info, data, signal)
          : await rstBootPaste(info, data, signal);
      if (signal.aborted)
        throw Object.assign(new Error("受限文档准备已取消"), {
          kind: "cancelled",
        });
      return prepared;
    },
    dispose: () => {
      if (rstRefreshController) rstRefreshController.abort();
      rstRefreshController = null;
      rstDisposeReplyTransport();
      for (const dispose of [...rstInjectionDisposers]) dispose();
      if (rstRefreshResetTimer !== null) {
        clearTimeout(rstRefreshResetTimer);
        rstRefreshResetTimer = null;
      }
      rstRefreshState = "idle";
      rstRefreshText = "申请更新";
      document
        .querySelectorAll(
          ".luogusp-rst-abtn,.luogusp-rst-pactions,.luogusp-rst-updtime",
        )
        .forEach((node) => node.remove());
    },
  };
  const restrictedDocumentCommitter = createRestrictedDocumentCommitter({
    documentAdapter: {
      open: () => document.open(),
      write: (html) => document.write(html),
      close: () => document.close(),
    },
    resourcePolicy: { isAllowed: rstTrustedCdnUrl },
  });
  let restrictedDocumentBoot = null;

  const ensureDocumentBoot = () => {
    if (restrictedDocumentBoot) return restrictedDocumentBoot;
    const pageLifecycle = getPageLifecycle();
    restrictedDocumentBoot = createRestrictedDocumentBoot({
      pageAdapter: {
        detect: () => restrictedPageDetector.detect(),
        showLoader: rstShowLoader,
        hideLoader: rstHideLoader,
        showUnavailable: rstShowUnavailableTip,
        showFailure: rstBuildFailure,
        currentPath: () => location.pathname,
        isRestrictedRoute: (path) =>
          /^\/(article|paste)\/[A-Za-z0-9]+\/?$/.test(path),
        reload: () => location.reload(),
      },
      saverWorkflow,
      documentBuilder: restrictedDocumentBuilder,
      documentCommitter: restrictedDocumentCommitter,
      pageLifecycle,
      logError: (error) => console.error("LuoguSP restricted boot:", error),
    });
    return restrictedDocumentBoot;
  };

  return defineConfigurableFeature({
    id: "restricted-document",
    key: "showRestrictedContent",
    label: "受限文章与剪贴板解限",
    storage,
    mount: (context) => ensureDocumentBoot().mount(context),
    onRoute: () => {
      if (restrictedLoadingGate) restrictedLoadingGate.start();
      ensureDocumentBoot().onRoute();
    },
  });
}
