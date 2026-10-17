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
  // 顯示受限文章與剪貼簿（原生殼注入）
  // 國內站訪問非本人/未審核的 /article、/paste 會落在「安全訪問中心」攔截頁
  // （獨立靜態頁、零全站樣式、無 CSP）。本功能在攔截頁上重建官方頁面：
  //   1) 殼骨架收割：從 .cn 同源 columba 頁拿官方殼（/ranking、/discuss；
  //      骨架自帶真實 csrf、當前登入使用者、使用者主題、官方指令碼當前版本——全部活取，絕不寫死）；
  //   2) 資料合成：把保存站存檔映射為 lentille-context
  //      （文章 template "article.show"；剪貼簿 template "paste.show"）；
  //   3) document.write 重建文件並載入官方前端 JS——頂欄/側欄/主題/登入態/markdown/評論元件
  //      全部由洛谷原生前端繪製，本指令碼零復刻（2026-07-22 owner 拍板棄手動烘焙路線）；
  //   4) 網路包裝（window 不隨 document.write 重建，包裝器天然存活）：
  //      評論介面 GET /article/{id}/replies 優先讀取洛谷即時資料，僅失敗時用保存站存檔；
  //      退回形狀 {replySlice:[{id,author:userSummary,time,content}]}，支援 sort=time-d、after=<id>；
  //      官方點贊/收藏/評論寫入僅由使用者點擊觸發，使用同源 Cookie 與殼頁面的真實 CSRF；
  //   5) 官方繪製完成後注入兩枚藍色擴充按鈕（申請更新 / 國際站原文）：
  //      文章頁=互動條 button-2line 掛「不推薦」右側；剪貼簿頁=元資訊行右側實心按鈕。
  // 資料源=洛谷保存站 api.luogu.me（CORS 開放、匿名；owner 拍板純保存站+更新僅手動）；
  // 作者資料走 .cn 同源 /api/user/search（owner 要求不吃保存站/國際站的使用者資料）。
  // ★保存站硬邊界：payload 的 createdAt 是入檔時間，非原文發佈時間（無介面可取原始時間）。
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
  // 受限文章頁沒有可讀回當前帳號 favored/voted 的官方唯讀介面（保存站也不提供），
  // 因此已確認的個人狀態只能來自官方寫回應，並按「UID + 文章 ID」隔離持久化。
  const rstInteractionStore = createArticleInteractionStore({
    storage: typeof localStorage === "undefined" ? null : localStorage,
  });

  // 攔截頁判定：URL 形態 + 標題 + pre#url 內容三重錨點；不滿足=正常頁面，絕不接管
  const restrictedPageDetector = createRestrictedPageDetector({
    path: () => location.pathname,
    title: () => document.title,
    target: () => {
      const pre = document.querySelector(SELECTORS.restrictedUrlPre);
      return pre ? (pre.textContent || "").trim() : "";
    },
    urlPolicy: restrictedUrlPolicy,
  });


  // 作者等使用者資料一律走國內站同源介面（owner 要求：不吃保存站/國際站的使用者資料；頭像也全走 .cn CDN）。
  // 介面=/api/user/search?keyword={uid}（攔截頁源實測可用；舊 /user/{uid}?_contentOnly=1 已死，回傳 HTML），
  // 回傳 userSummary：{uid,name,avatar,slogan,badge,color,ccfLevel,xcpcLevel,…}。失敗退回存檔快照。
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
      /* 退回存檔快照 */
    }
    rstUserCache.set(uid, user);
    return user;
  }

  // 載入動畫效果覆蓋層：接管 document-start 早期遮罩，並跨 document.write 保持到原生內容錨點就緒
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

  // 殼骨架收割：/ranking、/discuss 任一帶 lentille-context 即用。
  // 2026-09 剪貼簿已遷 paste.show，舊 lfe 源 /image、/theme/list 分別是 401 和 404。
  async function rstHarvest(signal) {
    for (const src of ["/ranking", "/discuss"]) {
      try {
        const res = await rstFetch(src, signal);
        const html = await res.text();
        if (html.includes("lentille-context")) return html;
      } catch (e) {
        if (e && e.kind === "cancelled") throw e;
        /* 換下一個源 */
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
  // 嵌入 <script> 的 JSON 防拆殼（內容裡出現 </script> 會截斷殼文件）

  // 官方文章元件啟動後會 GET /article/{lid}/replies（?sort=&after=）：先請求洛谷，
  // 僅失敗時退回保存站。寫操作仍由官方 UI 的使用者點擊觸發，包裝器只補同源憑證與 CSRF。
  // fetch / XMLHttpRequest 包裝器不隨 document.write 重建，天然對新文件生效；其餘請求全部放行。
  // ★包裝必須打在**頁面主世界**上：官方前端跑在那裡，而管理器可能把本指令碼放進沙箱
  //   作用域（Tampermonkey 用了 @grant 時即使宣告 @sandbox raw 也會如此）。
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

  // 文章頁：合成 lentille-context（template article.show）+ 官方 columba 前端
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
        // article-live-counts.js 寫死了「截斷必須報出來」，但此前這裡根本沒串接，
        // 於是「掃不完所以沒找到」和「洛谷確實沒有這條資料」在紀錄裡長得一模一樣。
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
        // 存檔快照的新鮮度：只有比已確認記錄更新，保存站計數才允許覆蓋。
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
          // 真實發表時間：保存站 publishTime → 作者專欄列表現掃 → 都沒有才退回入檔時間，
          // 而那種情況下時間欄的文案會被改成「存檔時間」（見 rstMountArticleButtons）。
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

  // 剪貼簿頁：合成 lentille-context（template paste.show）+ 官方 columba 前端。
  async function rstBootPaste(info, data, signal) {
    const [scaffold, cnUser] = await Promise.all([
      rstHarvest(signal),
      rstCnUser(data.authorId, signal),
    ]);
    if (!scaffold)
      throw rstPreparationError("无法获取洛谷页面骨架，暂不能就地渲染。");
    const shell = readColumbaShell(scaffold);
    // 剪貼簿沒有作者專欄列表那條路，真值只可能來自保存站的 publishTime；
    // 沒有就退回入檔時間，並把文案改成「存檔時間」（見 rstMountPasteButtons）。
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

  // 官方前端可能連續多次重繪；同一影格只補種一次，並在補種期間暫停觀察，
  // 避免擴充節點自身觸發下一輪全頁掃描。
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
    run(); // 首次同步補種，保持按鈕出現時機不變
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

  // 擴充按鈕（文章頁）：等官方前端繪製出互動條再注入；Vue 重繪製會抹節點，觀察器負責補種。
  // 同時在正文底部「建立時間：…」後方補「更新時間」＝保存站存檔最近更新時間（updatedAt），
  // 供 owner 判斷是否需要點「申請更新」。
  function rstMountArticleButtons(info, data, live) {
    const updText = rstFmtTime(data && data.updatedAt, true);
    // owner 要求：擴充按鈕不帶 title 懸浮說明（與時間欄一致，頁面不出瀏覽器浮泡）
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
        // owner 拍板：左浮條（left-mode）不放擴充按鈕，只掛內聯互動條
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
      // owner 要求：指向建立/更新時間不出瀏覽器懸浮泡 → 整條時間欄剝 title
      // （removeAttribute 無屬性時不產生變更記錄，天然冪等）
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
                span.setAttribute(at.name, at.value); // 繼承 data-v 作用域樣式
          span.classList.add("luogusp-rst-updtime");
          span.textContent = `更新时间：${updText}`;
          const sep = document.createTextNode("    ");
          if (ref) ref.after(sep, span);
          else bar.append(sep, span);
        });
      // 取不到真實發表時間時，這一行其實是保存站入檔時間，別標成「建立時間」。
      if (pickPublishTime(data, live) === null)
        relabelArchiveTime(updateBars, "创建时间");
      rstApplyRefreshBtns(); // Vue 重種出的「申請更新」按鈕要重新套用當前狀態
      if (actionBars.length && updateBars.length) rstHideLoader();
    };
    return rstObserveInjection(inject);
  }
  // 擴充按鈕（剪貼簿頁）：元資訊行（meta-row）右側兩枚實心藍鈕。
  // 該行是 flex space-between，作者和時間在 .meta-left，本容器落位最右。
  // 「更新時間」跟在「發佈時間」同一行，值是保存站存檔最近更新時間（updatedAt）。
  function rstMountPasteButtons(info, data) {
    const updText = rstFmtTime(data && data.updatedAt, false);
    const inject = () => {
      const chrome = findPasteChrome(document);
      if (!chrome) return;
      const { actionsHost, timeRow } = chrome;
      if (!actionsHost.querySelector(".luogusp-rst-pactions")) {
        // owner 要求：擴充按鈕不帶 title 懸浮說明（與時間欄一致，頁面不出瀏覽器浮泡）
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
      // owner 要求：指向發表/更新時間不出瀏覽器懸浮泡 → 時間行剝 title
      // （removeAttribute 無屬性時不產生變更記錄，天然冪等）
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
      // 保存站給不出真實發表時間時，這一行只能是存檔時間。
      // 當前官方文案是「發佈時間」，舊殼是「發表時間」。
      if (pickPublishTime(data, null) === null) {
        const label = pasteTimeLabel(timeRow);
        if (label) relabelArchiveTime([timeRow], label);
      }
      rstApplyRefreshBtns(); // Vue 重種出的「申請更新」按鈕要重新套用當前狀態
      rstHideLoader();
    };
    return rstObserveInjection(inject);
  }

  // 申請更新（手動）：狀態機 idle=可點 / busy=更新中… / done=已申請。
  // owner 口徑（2026-07-23）：提交成功即鎖定「已申請」且不可再點，不輪詢不自動刷新，
  // 直至使用者主動刷新頁面（保存工作流非同步完成，刷新後自然裝配新檔）；僅提交失敗允許重試。
  // Vue 重繪製會抹掉按鈕由觀察器重種，故狀態存模組級、每次補種後重新套用（rstApplyRefreshBtns）。
  let rstRefreshState = "idle";
  let rstRefreshText = "申请更新";
  let rstRefreshResetTimer = null;
  let rstRefreshController = null;
  // ★本函式被 inject 觀察器（body childList+subtree）的回呼無條件呼叫，必須冪等：
  // textContent 同值重寫也會刪舊建新 Text 節點、產生 childList 變更記錄，
  // 會把觀察器自己再觸發一遍 → 微任務死循環整頁卡死（2.11.0 事故），故同值不寫。
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
