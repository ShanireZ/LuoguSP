import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { makeCopyButton } from "../../browser/copy-button.js";
import { createHiddenIntroDiagnostics } from "./diagnostics.js";
import { renderMarkdownLite } from "./markdown-lite.js";
import { createNativeIntroAdapter } from "./native-intro-adapter.js";
import { HIDDEN_INTRO_STYLE } from "./style.js";

export function createHiddenIntroFeature({ storage, nativeIntroAdapter } = {}) {
  const SELECTORS = {
    userIntroColumn: ".sidebar-container .main",
    nativeIntro: ".introduction",
  };
  const diagnostics = createHiddenIntroDiagnostics();
  let nativeAdapter = nativeIntroAdapter || null;
  const getNativeAdapter = () => {
    if (!nativeAdapter) nativeAdapter = createNativeIntroAdapter();
    return nativeAdapter;
  };
  const injectStyle = () => {
    if (document.getElementById("luogusp-intro-style")) return;
    const style = document.createElement("style");
    style.id = "luogusp-intro-style";
    style.textContent = HIDDEN_INTRO_STYLE;
    (document.head || document.documentElement).appendChild(style);
  };

  function digIntro(obj, wantUid) {
    let result = null;
    (function walk(o, depth) {
      if (result || !o || typeof o !== "object" || depth > 6) return;
      if (String(o.uid) === wantUid && typeof o.introduction === "string") {
        result = o.introduction;
        return;
      }
      for (const k in o) {
        const v = o[k];
        if (v && typeof v === "object") walk(v, depth + 1);
      }
    })(obj, 0);
    return result;
  }
  async function getIntroduction(uid, signal) {
    // 1) 整页加载：简介就在页面同源 SSR 脚本 JSON 里
    for (const s of document.querySelectorAll("script")) {
      const t = (s.textContent || "").trim();
      if (t[0] !== "{" || t.indexOf('"introduction"') === -1) continue;
      try {
        const intro = digIntro(JSON.parse(t), uid);
        if (intro != null) return intro;
      } catch (e) {
        /* 非纯 JSON，跳过 */
      }
    }
    // 2) SPA 换页等：同源 lentille 接口，返回 {template:"user.show",data:{user:{…introduction}}}。
    // 注意：旧 `?_contentOnly=1` 已死（返回 HTML 壳页，拦截页源实测 2026-07-22），
    // 正确姿势是带 x-lentille-request 头。
    try {
      const r = await fetch(`/user/${uid}`, {
        headers: { "x-lentille-request": "content-only" },
        signal,
      });
      const intro = digIntro(await r.json(), uid);
      if (intro != null) return intro;
    } catch (e) {
      if (!signal || !signal.aborted) console.error("LuoguSP intro fetch:", e);
    }
    return null;
  }
  // 主渲染：优先用 @require 的 marked（真 GFM 解析器：表格+对齐/任务列表/嵌套列表/删除线/自动链接/裸 HTML 全支持）
  // + DOMPurify 消毒（marked 放行的裸 HTML 在此清理，XSS 安全）。数学公式仍走 KaTeX（先抽出占位，避免 marked 破坏 $ 内的 _ *）。
  // marked/DOMPurify 未加载时回退内置轻量渲染器 renderMarkdownLite。样式统一蹭洛谷 .lfe-marked-wrap。
  function renderMarkdown(md) {
    const mk = window.marked,
      dp = window.DOMPurify;
    const kx =
      (typeof window !== "undefined" && window.katex) ||
      (typeof katex !== "undefined" && katex) ||
      null;
    if (!mk || !dp) return renderMarkdownLite(md, { katex: kx }); // 库未加载 → 回退轻量渲染器（本身 XSS 安全）
    const tt = (f, d) => {
      if (!kx) return null;
      try {
        return dp.sanitize(
          kx.renderToString(f, { throwOnError: false, displayMode: d }),
        );
      } catch (e) {
        return null;
      }
    };
    const math = [];
    let mathPrefix = "%%LGMATH";
    while (md.includes(mathPrefix)) mathPrefix += "X";
    const hold = (h) => `${mathPrefix}${math.push(h) - 1}%%`; // 选择正文中不存在的前缀，避免用户文本伪造占位符
    const src = md
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, f) => {
        const h = tt(f.trim(), true);
        return h ? hold(h) : m;
      })
      .replace(/(?<!\\)\$([^\n$]+?)\$/g, (m, f) => {
        const h = tt(f, false);
        return h ? hold(h) : m;
      });
    let html;
    try {
      html = mk.parse(src, { gfm: true, breaks: true });
    } catch (e) {
      return renderMarkdownLite(md, { katex: kx });
    }
    html = dp.sanitize(html, { ADD_ATTR: ["target"] }); // 消毒：剥离 script/on*/javascript: 等
    const mathPattern = new RegExp(`${mathPrefix}(\\d+)%%`, "g");
    return html
      .replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer" ') // 链接新标签打开
      .replace(/<img /gi, '<img style="max-width:100%" ') // 图片限宽防溢出
      .replace(mathPattern, (_, i) => math[i]); // 回填已单独消毒的 KaTeX
  }

  function normalizeCodeLanguageClass(code) {
    const lang = [...code.classList].find((c) => c.startsWith("language-"));
    const pre = code.closest("pre");
    if (lang && pre) pre.classList.add(lang);
  }
  function highlightCodeBlocks(root) {
    const highlighter =
      (typeof window !== "undefined" && window.hljs) ||
      (typeof hljs !== "undefined" && hljs) ||
      null;
    root.querySelectorAll("pre code").forEach((code) => {
      normalizeCodeLanguageClass(code);
      if (!highlighter || typeof highlighter.highlightElement !== "function")
        return;
      if (code.dataset.luoguspHighlighted === "true") return;
      try {
        highlighter.highlightElement(code);
        code.dataset.luoguspHighlighted = "true";
        normalizeCodeLanguageClass(code);
      } catch (e) {
        console.error("LuoguSP highlight:", e);
      }
    });
  }
  function enhanceCodeBlocks(root) {
    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.closest(".code-container")) return;
      const code = pre.querySelector("code");
      if (!code) return;
      const box = document.createElement("div");
      box.className = "code-container";
      pre.parentNode.insertBefore(box, pre);
      box.append(pre, makeCopyButton(code));
    });
  }
  // 卡片外观参考国际站：浅克隆一张原生 .l-card + .header 拿到带 data-v 的作用域样式（裸 class 无边框/背景），
  // 内容套 .lfe-marked-wrap.introduction 走洛谷原生 Markdown 样式；追加到 .main 末尾（国际站里简介就是最后一张卡）。
  function renderIntroCard(col, intro) {
    // 浅克隆一张原生 .l-card 拿带 data-v 的作用域外观（圆角/白底·跟随主题），className 重置只留 l-card 去掉其它卡专属类
    const nativeCard = document.querySelector(".l-card");
    const card = nativeCard
      ? nativeCard.cloneNode(false)
      : document.createElement("div");
    card.className = "l-card luogusp-intro-card luogusp-mdstyle"; // mdstyle=纯样式作用域；intro-card=本功能所有权标记（勿混用）
    card.removeAttribute("id");
    card.removeAttribute("style"); // ★清掉克隆源卡的内联样式：某些卡带 --l-card--padding:0 会让内容贴框
    card.style.setProperty("--l-card--padding", "20.8px"); // 用国际站 intro 卡的内边距（洛谷 .l-card 靠此变量控制）
    // 头部：用国际站原生结构（.header > h3[margin=0]），让标题继承浏览器 h3 的字号与粗细。
    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("h3");
    title.textContent = "个人介绍";
    title.style.margin = "0px";
    header.appendChild(title);
    const body = document.createElement("div");
    body.className = "lfe-marked-wrap introduction"; // 外层容器；同时被 nativeIntro 检测用 :not 排除
    body.style.cssText = "overflow-wrap:break-word;word-break:break-word;";
    const content = document.createElement("div");
    content.className = "lfe-marked"; // ★洛谷 markdown 样式(标题下边框/hr/列表间距等)全局作用域在 .lfe-marked，内容必须套此层
    content.innerHTML = renderMarkdown(intro); // renderMarkdown 已消毒防 XSS
    highlightCodeBlocks(content);
    enhanceCodeBlocks(content);
    body.appendChild(content);
    card.append(header, body);
    col.appendChild(card);
  }
  const introWaiters = new Set();
  async function showHiddenIntro(
    expectedRoute,
    lifecycleContext,
    signal,
    onNativeAttached,
  ) {
    const route = expectedRoute || currentUserRoute();
    if (!route.uid || !route.isHome) return;
    const uid = route.uid;
    const routeKey = route.key;
    const stillCurrent = () => {
      const current = currentUserRoute();
      return (
        (!signal || !signal.aborted) &&
        (!lifecycleContext || lifecycleContext.isCurrent()) &&
        current.uid === uid &&
        current.key === routeKey &&
        current.isHome
      );
    };
    document.querySelectorAll(".luogusp-intro-card").forEach((e) => e.remove()); // 清换页残留
    if (document.querySelector(SELECTORS.nativeIntro)) return; // 原生已显示，不重复补
    const intro = await getIntroduction(uid, signal);
    if (!stillCurrent() || !intro || !intro.trim()) return;
    let nativeResult;
    try {
      nativeResult = await getNativeAdapter().attach({
        uid,
        introduction: intro,
        signal,
      });
    } catch (error) {
      nativeResult = {
        status: "native-unsupported",
        reason: "adapter-error",
      };
      console.debug("LuoguSP hidden-intro native:", nativeResult);
    }
    diagnostics.set(nativeResult.status, nativeResult.reason || null);
    if (!stillCurrent()) {
      nativeResult.restore?.();
      return;
    }
    if (nativeResult.status === "native-attached") {
      onNativeAttached?.({ routeKey, restore: nativeResult.restore });
      return;
    }
    if (
      nativeResult.status === "already-native" ||
      document.querySelector(SELECTORS.nativeIntro)
    )
      return;
    const place = () => {
      if (!stillCurrent()) return true; // 请求期间已换页：停止等待，绝不把旧简介挂到新路由
      if (document.querySelector(".introduction:not(.luogusp-intro-card *)"))
        return true; // 原生简介已出现（管理员等）→ 别补
      if (document.querySelector(".luogusp-intro-card")) return true;
      const col = document.querySelector(SELECTORS.userIntroColumn); // 只挂内层内容列，绝不回退外层全宽（否则内容顶到最左被裁）
      if (!col) return false;
      renderIntroCard(col, intro);
      diagnostics.set("fallback-rendered");
      return true;
    };
    if (place()) return;
    // 内容列尚未渲染（SPA 换页）：等它出现再补，8s 后放弃
    let timer = null;
    const obs = new MutationObserver(() => {
      if (place()) cleanup();
    });
    const cleanup = () => {
      obs.disconnect();
      if (timer !== null) clearTimeout(timer);
      introWaiters.delete(cleanup);
    };
    introWaiters.add(cleanup);
    obs.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(cleanup, 8000);
  }
  // SPA 换页时 URL 变但脚本不重跑：监听用户主页 uid 变化补显。
  function currentUserRoute() {
    const m = location.pathname.match(/^\/(?:user|space)\/(\d+)/);
    const hash = location.hash || "";
    return {
      uid: m ? m[1] : "",
      key: m ? `${location.pathname}${location.search}${hash}` : "",
      isHome:
        !!m && (!hash || hash === "#" || hash === "#home" || hash === "#main"),
    };
  }

  function watchHiddenIntro(lifecycleContext) {
    const controller = new AbortController();
    let requestedRouteKey = "";
    let nativeAttachment = null;
    const restoreNativeAttachment = () => {
      if (!nativeAttachment) return;
      nativeAttachment.restore?.();
      nativeAttachment = null;
    };
    const attachNative = (attachment) => {
      restoreNativeAttachment();
      nativeAttachment = attachment;
    };
    const check = () => {
      const route = currentUserRoute();
      const uid = route.uid;
      if (nativeAttachment && nativeAttachment.routeKey !== route.key)
        restoreNativeAttachment();
      if (!uid || !route.isHome) {
        restoreNativeAttachment();
        document
          .querySelectorAll(".luogusp-intro-card")
          .forEach((e) => e.remove());
        requestedRouteKey = "";
        return;
      }
      // 原生简介出现（管理员等原生可见）→ 移除我的卡，避免重复渲染
      if (document.querySelector(".introduction:not(.luogusp-intro-card *)")) {
        document
          .querySelectorAll(".luogusp-intro-card")
          .forEach((e) => e.remove());
        requestedRouteKey = route.key;
        return;
      }
      if (document.querySelector(".luogusp-intro-card")) {
        requestedRouteKey = route.key;
        return;
      }
      if (route.key !== requestedRouteKey) {
        requestedRouteKey = route.key;
        showHiddenIntro(route, lifecycleContext, controller.signal).catch(
          (e) => {
            if (!controller.signal.aborted)
              console.error("LuoguSP intro render:", e);
          },
        );
      }
    };
    check();
    let frame = null;
    const queueCheck = () => {
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          check();
        });
      }
    };
    const observer = new MutationObserver(() => {
      const route = currentUserRoute();
      if (route.uid && route.isHome) queueCheck();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      controller.abort();
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      restoreNativeAttachment();
      for (const cleanup of [...introWaiters]) cleanup();
      document
        .querySelectorAll(".luogusp-intro-card")
        .forEach((card) => card.remove());
    };
  }

  const feature = defineConfigurableFeature({
    id: "hidden-intro",
    key: "showIntro",
    label: "个人页显示个人介绍",
    storage,
    mount: (context) => {
      injectStyle();
      return watchHiddenIntro(context);
    },
  });
  return Object.freeze({ ...feature, getDiagnostics: diagnostics.get });
}
