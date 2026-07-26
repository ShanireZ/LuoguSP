// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.12.5
// @description  LuoguSP：题号显示难度颜色 / 私信 Ctrl+Click 打开用户个人页 / 个人页显示个人介绍 / IDE 模式一键测试所有样例 / 显示受限文章与剪贴板
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL   https://github.com/ShanireZ/LuoguSP
// @supportURL    https://github.com/ShanireZ/LuoguSP/issues
// @updateURL     https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @downloadURL   https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js
// @require      https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js
// @run-at       document-start
// ==/UserScript==
(() => {
  // src/core/browser-route-adapter.js
  function createBrowserRouteAdapter(config) {
    const {
      history: historyAdapter,
      eventTarget,
      token: getToken = () => "",
      logError = () => {
      }
    } = config || {};
    if (!historyAdapter || typeof historyAdapter.pushState !== "function" || typeof historyAdapter.replaceState !== "function")
      throw new TypeError("Route Adapter requires a history adapter");
    if (!eventTarget || typeof eventTarget.addEventListener !== "function" || typeof eventTarget.removeEventListener !== "function")
      throw new TypeError("Route Adapter requires an event target");
    const listeners = /* @__PURE__ */ new Set();
    const originals = {};
    const wrappers = {};
    const wrapperStates = {};
    let installed = false;
    const notify = () => {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          logError(error);
        }
      }
    };
    const install = () => {
      if (installed) return;
      installed = true;
      for (const method of ["pushState", "replaceState"]) {
        const raw = historyAdapter[method];
        const wrapperState = { active: true };
        originals[method] = raw;
        const wrapped = function(...args) {
          const result = raw.apply(this, args);
          if (wrapperState.active) notify();
          return result;
        };
        wrappers[method] = wrapped;
        wrapperStates[method] = wrapperState;
        historyAdapter[method] = wrapped;
      }
      eventTarget.addEventListener("popstate", notify);
      eventTarget.addEventListener("hashchange", notify);
    };
    const uninstall = () => {
      if (!installed || listeners.size) return;
      installed = false;
      for (const method of ["pushState", "replaceState"]) {
        if (wrapperStates[method]) wrapperStates[method].active = false;
        if (originals[method] && historyAdapter[method] === wrappers[method])
          historyAdapter[method] = originals[method];
        delete originals[method];
        delete wrappers[method];
        delete wrapperStates[method];
      }
      eventTarget.removeEventListener("popstate", notify);
      eventTarget.removeEventListener("hashchange", notify);
    };
    return Object.freeze({
      token: () => getToken(),
      subscribe: (listener) => {
        if (typeof listener !== "function")
          throw new TypeError("Route Adapter listener must be a function");
        listeners.add(listener);
        install();
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          listeners.delete(listener);
          uninstall();
        };
      }
    });
  }

  // src/core/page-lifecycle.js
  function createPageLifecycle(config) {
    const {
      routeAdapter,
      documentAdapter,
      storage,
      logError = () => {
      }
    } = config || {};
    if (!routeAdapter || typeof routeAdapter.subscribe !== "function")
      throw new TypeError("Page Lifecycle requires a route adapter");
    if (!documentAdapter || typeof documentAdapter.schedule !== "function" || typeof documentAdapter.whenReady !== "function")
      throw new TypeError("Page Lifecycle requires a document adapter");
    const features = /* @__PURE__ */ new Map();
    let disposers = [];
    let routeDispose = null;
    let scheduledDispose = null;
    let readyDispose = null;
    let generation = 0;
    let started = false;
    let disposed = false;
    let replacing = false;
    let lastRouteToken = "";
    const context = () => {
      const contextGeneration = generation;
      return Object.freeze({
        generation,
        routeToken: typeof routeAdapter.token === "function" ? routeAdapter.token() : "",
        isCurrent: () => !disposed && !replacing && generation === contextGeneration
      });
    };
    const disposeFeatures = () => {
      const current = disposers;
      disposers = [];
      for (let index = current.length - 1; index >= 0; index--) {
        try {
          current[index]();
        } catch (error) {
          logError("dispose", error);
        }
      }
    };
    const mountFeatures = () => {
      if (!started || disposed || replacing) return;
      const mountContext = context();
      for (const feature of features.values()) {
        let enabled = true;
        try {
          enabled = typeof feature.enabled === "function" ? !!feature.enabled(storage) : true;
          if (!enabled) continue;
          const dispose2 = feature.mount(mountContext);
          if (typeof dispose2 === "function") disposers.push(dispose2);
        } catch (error) {
          logError(feature.id, error);
        }
      }
    };
    const cancelScheduled = () => {
      if (!scheduledDispose) return;
      scheduledDispose();
      scheduledDispose = null;
    };
    const releaseReady = (dispose2 = readyDispose) => {
      if (dispose2 === readyDispose) readyDispose = null;
      if (typeof dispose2 !== "function") return;
      try {
        dispose2();
      } catch (error) {
        logError("documentReadyDispose", error);
      }
    };
    const remount = () => {
      if (!started || disposed || replacing) return;
      cancelScheduled();
      disposeFeatures();
      generation++;
      scheduledDispose = documentAdapter.schedule(() => {
        scheduledDispose = null;
        mountFeatures();
      }) || null;
    };
    const handleRoute = () => {
      if (!started || disposed || replacing) return;
      const nextRouteToken = typeof routeAdapter.token === "function" ? routeAdapter.token() : "";
      if (nextRouteToken === lastRouteToken) return;
      const routeContext = Object.freeze({
        generation,
        previousRouteToken: lastRouteToken,
        routeToken: nextRouteToken
      });
      for (const feature of features.values()) {
        if (typeof feature.onRoute !== "function") continue;
        try {
          feature.onRoute(routeContext);
        } catch (error) {
          logError(`${feature.id}:route`, error);
        }
      }
      lastRouteToken = nextRouteToken;
      remount();
    };
    const register = (feature) => {
      if (!feature || typeof feature.id !== "string" || typeof feature.mount !== "function")
        throw new TypeError("Page Lifecycle feature is invalid");
      if (features.has(feature.id))
        throw new Error(`Page Lifecycle feature already registered: ${feature.id}`);
      features.set(feature.id, feature);
      if (started && !disposed) remount();
      return lifecycle;
    };
    const start = () => {
      if (disposed || started) return;
      started = true;
      generation++;
      lastRouteToken = typeof routeAdapter.token === "function" ? routeAdapter.token() : "";
      routeDispose = routeAdapter.subscribe(handleRoute) || null;
      mountFeatures();
    };
    const replaceDocument = (commit) => {
      if (disposed || replacing || typeof commit !== "function") return false;
      cancelScheduled();
      disposeFeatures();
      generation++;
      const replacementGeneration = generation;
      replacing = true;
      let afterReady;
      try {
        afterReady = commit(context());
      } catch (error) {
        replacing = false;
        logError("replaceDocument", error);
        return false;
      }
      let readyFired = false;
      let pendingReadyDispose = null;
      try {
        const disposeReady = documentAdapter.whenReady(() => {
          readyFired = true;
          releaseReady();
          if (disposed || generation !== replacementGeneration) return;
          replacing = false;
          mountFeatures();
          if (typeof afterReady === "function") {
            try {
              afterReady(context());
            } catch (error) {
              logError("afterDocumentReady", error);
            }
          }
        });
        if (typeof disposeReady === "function")
          pendingReadyDispose = disposeReady;
      } catch (error) {
        replacing = false;
        logError("documentReady", error);
        return false;
      }
      if (readyFired) {
        releaseReady(pendingReadyDispose);
      } else readyDispose = pendingReadyDispose;
      return true;
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      cancelScheduled();
      releaseReady();
      disposeFeatures();
      if (routeDispose) routeDispose();
      routeDispose = null;
    };
    const getState = () => Object.freeze({
      generation,
      started,
      disposed,
      replacing,
      featureCount: features.size,
      mountedCount: disposers.length
    });
    const lifecycle = Object.freeze({
      register,
      start,
      replaceDocument,
      dispose,
      getState
    });
    return lifecycle;
  }

  // src/app/feature-descriptor.js
  function defineConfigurableFeature({
    id,
    key,
    label,
    storage,
    mount,
    onRoute
  }) {
    if (!id || !key || !label || !storage || typeof mount !== "function")
      throw new TypeError("Configurable feature descriptor is invalid");
    const storageKey = `LuoguSP.${key}`;
    const feature = {
      id,
      key,
      label,
      storageKey,
      defaultEnabled: true,
      enabled: () => storage.get(storageKey),
      mount
    };
    if (typeof onRoute === "function") feature.onRoute = onRoute;
    return Object.freeze(feature);
  }

  // src/features/chat-shortcut/feature.js
  function createChatShortcutFeature({ storage }) {
    const SELECTORS = {
      chatTrigger: '[slot="trigger"]'
    };
    function addMessageLink() {
      const bound = /* @__PURE__ */ new WeakSet();
      const uidCache = /* @__PURE__ */ new Map();
      const cleanups = [];
      const controllers = /* @__PURE__ */ new Set();
      let active = true;
      const openUser = (uid) => {
        if (uid) window.open(`/user/${uid}`, "_blank");
      };
      const inUserLink = (el) => el.closest('a[href*="/user/"], a[href*="/space/"]');
      async function getUidByName(username) {
        if (uidCache.has(username)) return uidCache.get(username);
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const res = await fetch(
            `/api/user/search?keyword=${encodeURIComponent(username)}`,
            { signal: controller.signal }
          );
          const data = await res.json();
          const uid = data && data.users && data.users[0] && data.users[0].uid;
          if (active && !controller.signal.aborted) uidCache.set(username, uid);
          return uid;
        } catch (e) {
          if (!controller.signal.aborted) console.error("LuoguSP getUid:", e);
        } finally {
          controllers.delete(controller);
        }
      }
      function bindName(trigger) {
        if (bound.has(trigger) || inUserLink(trigger)) return;
        bound.add(trigger);
        const onClick = async (e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          e.stopPropagation();
          const name = (trigger.textContent || "").trim();
          const uid = name && await getUidByName(name);
          if (active && uid) openUser(uid);
        };
        trigger.addEventListener("click", onClick);
        cleanups.push(() => trigger.removeEventListener("click", onClick));
      }
      const AVATAR_RE = /\/usericon\/(\d+)/;
      function bindAvatar(img) {
        if (bound.has(img) || inUserLink(img) || !AVATAR_RE.test(img.src || ""))
          return;
        bound.add(img);
        const oldCursor = img.style.cursor;
        img.style.cursor = "pointer";
        const onClick = (e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          e.stopPropagation();
          const m = (img.src || "").match(AVATAR_RE);
          if (m) openUser(m[1]);
        };
        img.addEventListener("click", onClick);
        cleanups.push(() => {
          img.removeEventListener("click", onClick);
          img.style.cursor = oldCursor;
        });
      }
      const scan = (root) => {
        if (!root.querySelectorAll) return;
        root.querySelectorAll(SELECTORS.chatTrigger).forEach(bindName);
        root.querySelectorAll("img").forEach(bindAvatar);
      };
      scan(document);
      const observer = new MutationObserver((muts) => {
        for (const m of muts)
          for (const n of m.addedNodes)
            if (n.nodeType === Node.ELEMENT_NODE) {
              if (n.matches && n.matches(SELECTORS.chatTrigger)) bindName(n);
              if (n.matches && n.matches("img")) bindAvatar(n);
              scan(n);
            }
      });
      observer.observe(document, { childList: true, subtree: true });
      return () => {
        active = false;
        for (const controller of controllers) controller.abort();
        controllers.clear();
        observer.disconnect();
        for (const cleanup of cleanups) cleanup();
      };
    }
    return defineConfigurableFeature({
      id: "chat-shortcut",
      key: "addMessageLink",
      label: "私信 Ctrl+Click 打开用户个人页",
      storage,
      mount: (context) => {
        if (!location.pathname.startsWith("/chat")) return;
        let disposeChat = null;
        const timer = setTimeout(() => {
          if (!context.isCurrent()) return;
          try {
            disposeChat = addMessageLink();
          } catch (error) {
            console.error("LuoguSP lifecycle chat-shortcut:", error);
          }
        }, 500);
        return () => {
          clearTimeout(timer);
          if (disposeChat) disposeChat();
        };
      }
    });
  }

  // src/browser/copy-button.js
  var COPY_ICON_PATH = "M192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-200.6c0-17.4-7.1-34.1-19.7-46.2L370.6 17.8C358.7 6.4 342.8 0 326.3 0L192 0zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-64 0 0 16-192 0 0-256 16 0 0-64-16 0z";
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext)
      return navigator.clipboard.writeText(text);
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      return Promise.resolve();
    } finally {
      textarea.remove();
    }
  }
  function makeCopyButton(code) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.setAttribute("aria-label", "复制代码");
    button.title = "复制代码";
    button.innerHTML = `<svg class="svg-inline--fa fa-copy copy-icon" data-prefix="fas" data-icon="copy" role="img" viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="${COPY_ICON_PATH}"></path></svg>`;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await copyText(code.textContent || "");
        button.classList.add("copied");
        button.title = "已复制";
        setTimeout(() => {
          button.classList.remove("copied");
          button.title = "复制代码";
        }, 900);
      } catch (error) {
        console.error("LuoguSP copy code:", error);
      }
    });
    return button;
  }

  // src/features/hidden-intro/style.js
  var HIDDEN_INTRO_STYLE = `
  .luogusp-mdstyle li:has(> input[type="checkbox"]){list-style:none;margin-left:-1.2em;}
  .luogusp-mdstyle li > input[type="checkbox"]{margin-right:.4em;}
  .luogusp-mdstyle .code-container{margin:1rem 0;position:relative;}
  .luogusp-mdstyle .code-container:hover>.copy-button{opacity:1;}
  .luogusp-mdstyle .code-container:hover>.copy-button:hover{background-color:#ddd;}
  .luogusp-mdstyle .copy-button{position:absolute;top:.5em;right:.5em;padding:.6em;display:flex;align-items:center;justify-content:center;transition:opacity .2s ease-in-out,color .2s ease-in-out,background-color .2s ease-in-out;opacity:0;background-color:transparent;border:0;border-radius:4px;cursor:pointer;color:#555;}
  .luogusp-mdstyle .copy-button:focus{opacity:1;outline:1px solid #ddd;}
  .luogusp-mdstyle .copy-button.copied{color:#52c41a;}
  .luogusp-mdstyle .copy-icon{width:1em;height:1em;}
  .luogusp-mdstyle .code-container>pre{background:#fafafa;color:#383a42;padding:1em;margin:0;overflow:auto;border-radius:.3em;}
  .luogusp-mdstyle .code-container>pre code{font-family:"Fira Code","Fira Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace;line-height:1.5;tab-size:2;}
  .luogusp-mdstyle pre[class*="language-"],.luogusp-mdstyle code[class*="language-"]{background:#fafafa;color:#383a42;font-family:"Fira Code","Fira Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace;direction:ltr;text-align:left;white-space:pre;word-spacing:normal;word-break:normal;line-height:1.5;tab-size:2;hyphens:none;}
  .luogusp-mdstyle pre[class*="language-"]{padding:1em;margin:.5em 0;overflow:auto;border-radius:.3em;}
  .luogusp-mdstyle .code-container>pre[class*="language-"]{margin:0;}
  .luogusp-mdstyle pre code.hljs{display:block;overflow-x:visible;padding:0;background:transparent;}
  .luogusp-mdstyle code.hljs{color:#383a42;background:#fafafa;}
  .luogusp-mdstyle .hljs-comment,.luogusp-mdstyle .hljs-quote{color:#a0a1a7;font-style:italic;}
  .luogusp-mdstyle .hljs-doctag,.luogusp-mdstyle .hljs-formula,.luogusp-mdstyle .hljs-keyword{color:#a626a4;}
  .luogusp-mdstyle .hljs-deletion,.luogusp-mdstyle .hljs-name,.luogusp-mdstyle .hljs-section,.luogusp-mdstyle .hljs-selector-tag,.luogusp-mdstyle .hljs-subst{color:#e45649;}
  .luogusp-mdstyle .hljs-literal{color:#0184bb;}
  .luogusp-mdstyle .hljs-addition,.luogusp-mdstyle .hljs-attribute,.luogusp-mdstyle .hljs-meta .hljs-string,.luogusp-mdstyle .hljs-regexp,.luogusp-mdstyle .hljs-string{color:#50a14f;}
  .luogusp-mdstyle .hljs-attr,.luogusp-mdstyle .hljs-number,.luogusp-mdstyle .hljs-selector-attr,.luogusp-mdstyle .hljs-selector-class,.luogusp-mdstyle .hljs-selector-pseudo,.luogusp-mdstyle .hljs-template-variable,.luogusp-mdstyle .hljs-type,.luogusp-mdstyle .hljs-variable{color:#986801;}
  .luogusp-mdstyle .hljs-bullet,.luogusp-mdstyle .hljs-link,.luogusp-mdstyle .hljs-meta,.luogusp-mdstyle .hljs-selector-id,.luogusp-mdstyle .hljs-symbol,.luogusp-mdstyle .hljs-title{color:#4078f2;}
  .luogusp-mdstyle .hljs-built_in,.luogusp-mdstyle .hljs-class .hljs-title,.luogusp-mdstyle .hljs-title.class_,.luogusp-mdstyle .hljs-title.function_{color:#c18401;}
  .luogusp-mdstyle .hljs-emphasis{font-style:italic;}
  .luogusp-mdstyle .hljs-strong{font-weight:700;}
`;

  // src/features/hidden-intro/feature.js
  function createHiddenIntroFeature({ storage }) {
    const SELECTORS = {
      userIntroColumn: ".sidebar-container .main",
      nativeIntro: ".introduction"
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
      for (const s of document.querySelectorAll("script")) {
        const t = (s.textContent || "").trim();
        if (t[0] !== "{" || t.indexOf('"introduction"') === -1) continue;
        try {
          const intro = digIntro(JSON.parse(t), uid);
          if (intro != null) return intro;
        } catch (e) {
        }
      }
      try {
        const r = await fetch(`/user/${uid}`, {
          headers: { "x-lentille-request": "content-only" },
          signal
        });
        const intro = digIntro(await r.json(), uid);
        if (intro != null) return intro;
      } catch (e) {
        if (!signal || !signal.aborted)
          console.error("LuoguSP intro fetch:", e);
      }
      return null;
    }
    function renderMarkdown(md) {
      const mk = window.marked, dp = window.DOMPurify;
      if (!mk || !dp) return renderMarkdownLite(md);
      const kx = typeof window !== "undefined" && window.katex || typeof katex !== "undefined" && katex || null;
      const tt = (f, d) => {
        if (!kx) return null;
        try {
          return dp.sanitize(
            kx.renderToString(f, { throwOnError: false, displayMode: d })
          );
        } catch (e) {
          return null;
        }
      };
      const math = [];
      let mathPrefix = "%%LGMATH";
      while (md.includes(mathPrefix)) mathPrefix += "X";
      const hold = (h) => `${mathPrefix}${math.push(h) - 1}%%`;
      const src = md.replace(/\$\$([\s\S]+?)\$\$/g, (m, f) => {
        const h = tt(f.trim(), true);
        return h ? hold(h) : m;
      }).replace(/(?<!\\)\$([^\n$]+?)\$/g, (m, f) => {
        const h = tt(f, false);
        return h ? hold(h) : m;
      });
      let html;
      try {
        html = mk.parse(src, { gfm: true, breaks: true });
      } catch (e) {
        return renderMarkdownLite(md);
      }
      html = dp.sanitize(html, { ADD_ATTR: ["target"] });
      const mathPattern = new RegExp(`${mathPrefix}(\\d+)%%`, "g");
      return html.replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer" ').replace(/<img /gi, '<img style="max-width:100%" ').replace(mathPattern, (_, i) => math[i]);
    }
    function renderMarkdownLite(md) {
      const esc = (s) => s.replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
      );
      const url = (u) => /^(https?:)?\/\//i.test(u) || /^\//.test(u) ? u : "";
      const codeLanguageClass = (raw) => {
        const lang = (raw || "").trim().split(/\s+/)[0].toLowerCase();
        return /^[a-z0-9_+-]+$/.test(lang) ? ` class="language-${esc(lang)}"` : "";
      };
      const kx = typeof window !== "undefined" && window.katex || typeof katex !== "undefined" && katex || null;
      const tex = (f, display) => {
        if (!kx) return null;
        try {
          return kx.renderToString(f, {
            throwOnError: false,
            displayMode: display
          });
        } catch (e) {
          return null;
        }
      };
      const spans = [];
      let spanPrefix = "@@LGB";
      while (md.includes(spanPrefix)) spanPrefix += "X";
      const stash = (html2) => `${spanPrefix}${spans.push(html2) - 1}@@`;
      const ga = (t, re) => (t.match(re) || [])[1] || "";
      const inline = (s) => s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`).replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, a, u) => {
        const x = url(u);
        return x ? `<img src="${x}" alt="${a}" style="max-width:100%">` : m;
      }).replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, t, u) => {
        const x = url(u);
        return x ? `<a href="${x}" target="_blank" rel="noopener noreferrer">${t}</a>` : m;
      }).replace(/~~([^~]+)~~/g, "<del>$1</del>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const table = (lines) => `<table><thead><tr>${cells(lines[0]).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${lines.slice(2).map(
        (l) => `<tr>${cells(l).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`
      ).join("")}</tbody></table>`;
      const SAFE = /^(b|strong|i|em|u|s|del|ins|mark|sub|sup|br|hr|code|kbd|small)$/i;
      let src = md.replace(/```([^\n]*)\n?([\s\S]*?)```/g, (_, rawLang, c) => {
        const cls = codeLanguageClass(rawLang);
        return stash(
          `<pre${cls}><code${cls}>${esc(c.replace(/\n$/, ""))}</code></pre>`
        );
      }).replace(/<img\b[^>]*>/gi, (t) => {
        const x = url(ga(t, /\bsrc\s*=\s*["']?([^"'\s>]+)/i));
        return x ? stash(
          `<img src="${esc(x)}" alt="${esc(ga(t, /\balt\s*=\s*["']([^"']*)["']/i))}" style="max-width:100%">`
        ) : "";
      }).replace(/<a\b[^>]*>/gi, (t) => {
        const x = url(ga(t, /\bhref\s*=\s*["']?([^"'\s>]+)/i));
        return stash(
          x ? `<a href="${esc(x)}" target="_blank" rel="noopener noreferrer">` : "<span>"
        );
      }).replace(/<\/a>/gi, () => stash("</a>")).replace(
        /<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi,
        (t, sl, nm) => SAFE.test(nm) ? stash(`<${sl}${nm.toLowerCase()}>`) : t
      ).replace(/\$\$([\s\S]+?)\$\$/g, (m, f) => {
        const h = tex(f.trim(), true);
        return h ? stash(h) : m;
      }).replace(/(?<!\\)\$([^\n$]+?)\$/g, (m, f) => {
        const h = tex(f, false);
        return h ? stash(h) : m;
      });
      src = esc(src).replace(/^([^\n]+)\n=+[ \t]*$/gm, "# $1").replace(/^([^\n]+)\n-{2,}[ \t]*$/gm, "## $1").replace(/^(#{1,6}[ \t]+.+)$/gm, "\n\n$1\n\n").replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "\n\n$1$1$1\n\n");
      const html = src.split(/\n{2,}/).map((block) => {
        const b = block.trim();
        if (new RegExp(`^${spanPrefix}\\d+@@$`).test(b)) return b;
        const lines = block.split("\n");
        if (lines.length >= 2 && /^\s*\|.*\|\s*$/.test(lines[0]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1]))
          return table(lines);
        const h = b.match(/^(#{1,6})[ \t]+(.+)$/);
        if (h && !b.includes("\n"))
          return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
        if (/^([-*_])\1{2,}$/.test(b)) return "<hr>";
        if (lines.every((l) => /^\s*[-*+]\s+/.test(l)))
          return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*+]\s+/, ""))}</li>`).join("")}</ul>`;
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l)))
          return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
        if (lines.every((l) => /^&gt;\s?/.test(l)))
          return `<blockquote>${inline(lines.map((l) => l.replace(/^&gt;\s?/, "")).join("<br>"))}</blockquote>`;
        return `<p>${inline(block).replace(/\n/g, "<br>")}</p>`;
      }).join("");
      return html.replace(
        new RegExp(`${spanPrefix}(\\d+)@@`, "g"),
        (_, i) => spans[i]
      );
    }
    function normalizeCodeLanguageClass(code) {
      const lang = [...code.classList].find((c) => c.startsWith("language-"));
      const pre = code.closest("pre");
      if (lang && pre) pre.classList.add(lang);
    }
    function highlightCodeBlocks(root) {
      const highlighter = typeof window !== "undefined" && window.hljs || typeof hljs !== "undefined" && hljs || null;
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
    function renderIntroCard(col, intro) {
      const nativeCard = document.querySelector(".l-card");
      const card = nativeCard ? nativeCard.cloneNode(false) : document.createElement("div");
      card.className = "l-card luogusp-intro-card luogusp-mdstyle";
      card.removeAttribute("id");
      card.removeAttribute("style");
      card.style.setProperty("--l-card--padding", "20.8px");
      const header = document.createElement("div");
      header.className = "header";
      const title = document.createElement("h3");
      title.textContent = "个人介绍";
      title.style.margin = "0px";
      header.appendChild(title);
      const body = document.createElement("div");
      body.className = "lfe-marked-wrap introduction";
      body.style.cssText = "overflow-wrap:break-word;word-break:break-word;";
      const content = document.createElement("div");
      content.className = "lfe-marked";
      content.innerHTML = renderMarkdown(intro);
      highlightCodeBlocks(content);
      enhanceCodeBlocks(content);
      body.appendChild(content);
      card.append(header, body);
      col.appendChild(card);
    }
    const introWaiters = /* @__PURE__ */ new Set();
    async function showHiddenIntro(expectedRoute, lifecycleContext, signal) {
      const route = expectedRoute || currentUserRoute();
      if (!route.uid || !route.isHome) return;
      const uid = route.uid;
      const routeKey = route.key;
      const stillCurrent = () => {
        const current = currentUserRoute();
        return (!signal || !signal.aborted) && (!lifecycleContext || lifecycleContext.isCurrent()) && current.uid === uid && current.key === routeKey && current.isHome;
      };
      document.querySelectorAll(".luogusp-intro-card").forEach((e) => e.remove());
      if (document.querySelector(SELECTORS.nativeIntro)) return;
      const intro = await getIntroduction(uid, signal);
      if (!stillCurrent() || !intro || !intro.trim()) return;
      const place = () => {
        if (!stillCurrent()) return true;
        if (document.querySelector(".introduction:not(.luogusp-intro-card *)"))
          return true;
        if (document.querySelector(".luogusp-intro-card")) return true;
        const col = document.querySelector(SELECTORS.userIntroColumn);
        if (!col) return false;
        renderIntroCard(col, intro);
        return true;
      };
      if (place()) return;
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
      timer = setTimeout(cleanup, 8e3);
    }
    function currentUserRoute() {
      const m = location.pathname.match(/^\/(?:user|space)\/(\d+)/);
      const hash = location.hash || "";
      return {
        uid: m ? m[1] : "",
        key: m ? `${location.pathname}${location.search}${hash}` : "",
        isHome: !!m && (!hash || hash === "#" || hash === "#home" || hash === "#main")
      };
    }
    function watchHiddenIntro(lifecycleContext) {
      const controller = new AbortController();
      let requestedRouteKey = "";
      const check = () => {
        const route = currentUserRoute();
        const uid = route.uid;
        if (!uid || !route.isHome) {
          document.querySelectorAll(".luogusp-intro-card").forEach((e) => e.remove());
          requestedRouteKey = "";
          return;
        }
        if (document.querySelector(".introduction:not(.luogusp-intro-card *)")) {
          document.querySelectorAll(".luogusp-intro-card").forEach((e) => e.remove());
          requestedRouteKey = route.key;
          return;
        }
        if (document.querySelector(".luogusp-intro-card")) {
          requestedRouteKey = route.key;
          return;
        }
        if (route.key !== requestedRouteKey) {
          requestedRouteKey = route.key;
          showHiddenIntro(route, lifecycleContext, controller.signal).catch((e) => {
            if (!controller.signal.aborted)
              console.error("LuoguSP intro render:", e);
          });
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
        for (const cleanup of [...introWaiters]) cleanup();
        document.querySelectorAll(".luogusp-intro-card").forEach((card) => card.remove());
      };
    }
    return defineConfigurableFeature({
      id: "hidden-intro",
      key: "showIntro",
      label: "个人页显示个人介绍",
      storage,
      mount: (context) => {
        injectStyle();
        return watchHiddenIntro(context);
      }
    });
  }

  // src/features/ide-batch/runner.js
  function createIdeBatchRunner(config) {
    const {
      ideDriver,
      clock,
      createAbortController = () => new AbortController(),
      logError = () => {
      }
    } = config || {};
    if (!ideDriver || typeof ideDriver.prepare !== "function" || typeof ideDriver.runSample !== "function")
      throw new TypeError("IDE Batch Runner requires a browser driver");
    if (!clock || typeof clock.setTimeout !== "function" || typeof clock.clearTimeout !== "function")
      throw new TypeError("IDE Batch Runner requires a clock adapter");
    let state = "idle";
    let runId = 0;
    let mounted = false;
    let disposed = false;
    let driving = false;
    let stale = false;
    let results = null;
    let stopMount = null;
    let mountKey = null;
    let delay = null;
    let activeController = null;
    const cancelDelay = () => {
      if (!delay) return;
      clock.clearTimeout(delay.timer);
      const resolve = delay.resolve;
      delay = null;
      resolve(false);
    };
    const pause = (ms, taskRunId) => new Promise((resolve) => {
      const timer = clock.setTimeout(() => {
        if (delay && delay.timer === timer) delay = null;
        resolve(taskRunId === runId && !disposed);
      }, ms);
      delay = { timer, resolve };
    });
    const isCurrent = (taskRunId, context, signal) => taskRunId === runId && !disposed && !signal.aborted && (!ideDriver.isCurrent || ideDriver.isCurrent(context));
    const drive = (taskRunId, action) => {
      if (taskRunId !== runId || disposed) return;
      driving = true;
      try {
        return action();
      } finally {
        driving = false;
      }
    };
    const invalidate = () => {
      if (state === "idle") return;
      if (activeController) activeController.abort();
      activeController = null;
      runId++;
      state = "idle";
      driving = false;
      cancelDelay();
      if (typeof ideDriver.cancel === "function") ideDriver.cancel();
    };
    const stop = () => {
      if (state === "preparing" || state === "running") state = "stopping";
    };
    const markStale = () => {
      if (stale || state !== "idle" || !results) return;
      stale = true;
      if (typeof ideDriver.markStale === "function") ideDriver.markStale();
    };
    const start = async () => {
      if (disposed || state !== "idle") return;
      const taskRunId = ++runId;
      const controller = createAbortController();
      activeController = controller;
      let context = null;
      state = "preparing";
      try {
        context = await ideDriver.prepare({
          runId: taskRunId,
          signal: controller.signal
        });
        if (taskRunId !== runId || disposed) return;
        if (!context || context.kind !== "ready") {
          if (context && context.message && typeof ideDriver.hint === "function")
            ideDriver.hint(context.message);
          return;
        }
        if (state === "stopping") return;
        if (!isCurrent(taskRunId, context, controller.signal)) {
          if (typeof ideDriver.hint === "function")
            ideDriver.hint("页面已切换");
          return;
        }
        state = "running";
        stale = false;
        results = new Array(context.count).fill(null);
        if (typeof ideDriver.begin === "function")
          ideDriver.begin(context, results);
        for (let index = 0; index < context.count; index++) {
          if (state === "stopping" || !isCurrent(taskRunId, context, controller.signal))
            break;
          if (typeof ideDriver.setRunning === "function")
            ideDriver.setRunning(context, index);
          let result;
          try {
            result = await ideDriver.runSample(context, index, {
              runId: taskRunId,
              signal: controller.signal,
              drive: (action) => drive(taskRunId, action),
              isCurrent: () => isCurrent(taskRunId, context, controller.signal),
              wait: (ms) => pause(ms, taskRunId)
            });
          } catch (error) {
            if (controller.signal.aborted) break;
            logError(error);
            result = { verdict: "UKE", note: String(error) };
          }
          if (!isCurrent(taskRunId, context, controller.signal)) break;
          results[index] = result;
          if (typeof ideDriver.applyResult === "function")
            ideDriver.applyResult(context, index, result);
          if (result.verdict === "CE") {
            for (let rest = index + 1; rest < context.count; rest++) {
              results[rest] = {
                verdict: "CE",
                output: result.output || "",
                note: "编译错误"
              };
              if (typeof ideDriver.applyResult === "function")
                ideDriver.applyResult(context, rest, results[rest]);
            }
            break;
          }
          if (index < context.count - 1 && state !== "stopping") {
            const continued = await pause(500, taskRunId);
            if (!continued || !isCurrent(taskRunId, context, controller.signal))
              break;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) logError(error);
      } finally {
        if (activeController === controller) activeController = null;
        const shouldRestore = context && taskRunId === runId && !disposed && !controller.signal.aborted && (!ideDriver.isCurrent || ideDriver.isCurrent(context));
        if (shouldRestore && typeof ideDriver.restore === "function") {
          try {
            ideDriver.restore(context);
          } catch (error) {
            logError(error);
          }
        }
        if (taskRunId === runId) {
          state = "idle";
          driving = false;
          cancelDelay();
          if (context && context.kind === "ready" && ideDriver.finish)
            ideDriver.finish(context, results);
        }
      }
    };
    const mount = () => {
      if (disposed) return dispose;
      const nextMountKey = typeof ideDriver.mountKey === "function" ? ideDriver.mountKey() : ideDriver;
      if (mounted && mountKey === nextMountKey) return dispose;
      if (mounted) {
        invalidate();
        if (stopMount) stopMount();
        stopMount = null;
        mounted = false;
      }
      mounted = true;
      mountKey = nextMountKey;
      if (typeof ideDriver.mount === "function")
        stopMount = ideDriver.mount({
          start,
          stop,
          invalidate,
          markStale,
          isRunning: () => state === "running" || state === "stopping",
          isDriving: () => driving
        }) || null;
      return dispose;
    };
    const unmount = () => {
      if (!mounted) return;
      invalidate();
      if (stopMount) stopMount();
      stopMount = null;
      mountKey = null;
      mounted = false;
    };
    const dispose = () => {
      if (disposed) return;
      if (mounted) unmount();
      else invalidate();
      disposed = true;
    };
    const getState = () => Object.freeze({ state, runId, driving, stale, mounted, disposed });
    return Object.freeze({
      mount,
      unmount,
      start,
      stop,
      markStale,
      dispose,
      getState
    });
  }

  // src/features/ide-batch/style.js
  var IDE_BATCH_STYLE = `
  .luogusp-ide-tabbar{display:flex;gap:20px;padding:0 12px;border-bottom:1px solid #e8e8e8;flex:none;}
  .luogusp-ide-tab{font-size:13px;color:#606266;padding:7px 2px 5px;cursor:pointer;border-bottom:2px solid transparent;}
  .luogusp-ide-tab.on{color:#3498db;border-bottom-color:#3498db;font-weight:500;}
  .luogusp-ide-panel{overflow:auto;flex:1 1 0;min-height:0;padding:8px 12px 12px;font-size:13px;color:#333;}
  .luogusp-ide-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
  .luogusp-ide-title{font-weight:500;}
  .luogusp-ide-summary{font-size:12px;color:#888;}
  .luogusp-ide-headbtns{margin-left:auto;display:flex;gap:6px;}
  .luogusp-ide-row{border:1px solid #e8e8e8;border-radius:6px;margin:0 0 8px;background:#fff;overflow:hidden;}
  .luogusp-ide-rowhead{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;}
  .luogusp-ide-rowhead:hover{background:#f7fbfe;}
  .luogusp-ide-chev{color:#999;width:10px;transition:transform .2s;}
  .luogusp-ide-row.open .luogusp-ide-chev{transform:rotate(90deg);}
  .luogusp-ide-meta{font-size:12px;color:#999;margin-left:auto;}
  .luogusp-ide-pill{font-size:12px;padding:1px 10px;border-radius:10px;border:1px solid transparent;white-space:nowrap;}
  .luogusp-ide-detail{display:none;border-top:1px solid #eee;background:#fcfcfc;padding:10px 12px;}
  .luogusp-ide-row.open .luogusp-ide-detail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
  .luogusp-ide-row.open .luogusp-ide-detail.luogusp-ide-log{display:block;}
  @media (max-width:1500px){.luogusp-ide-row.open .luogusp-ide-detail{grid-template-columns:1fr;}}
  .luogusp-ide-pane h5{margin:0 0 4px;font-size:12px;font-weight:500;color:#888;}
  .luogusp-ide-pane .code-container{margin:0;}
  .luogusp-ide-pane pre{margin:0;border:1px solid #e6e6e6;border-radius:4px;background:#fff;padding:6px 8px;font-size:12px;line-height:1.55;color:#333;overflow-x:auto;min-height:40px;font-family:"Fira Code","Fira Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace;}
  .luogusp-ide-pane .luogusp-ide-diffline{background:#fcebeb;color:#a32d2d;display:block;margin:0 -8px;padding:0 8px;}
  .luogusp-ide-note{font-size:12px;color:#a32d2d;margin:0 0 8px;}
  .luogusp-ide-empty{color:#aaa;font-style:italic;}
  .luogusp-ide-panel .code-container:hover>.copy-button{opacity:1;}
  .luogusp-ide-panel .copy-button{position:absolute;top:.3em;right:.3em;padding:.45em;display:flex;align-items:center;justify-content:center;transition:opacity .2s;opacity:0;background:transparent;border:0;border-radius:4px;cursor:pointer;color:#555;}
  .luogusp-ide-panel .copy-button.copied{color:#52c41a;}
  .luogusp-ide-panel .copy-icon{width:1em;height:1em;}
`;

  // src/features/ide-batch/feature.js
  function createIdeBatchFeature({
    storage,
    idePreparationAdapter
  }) {
    const SELECTORS = {
      ideToolbar: ".ide-toolbar",
      ideToolbarText: ".title .text",
      ideToolbarActions: ".actions",
      ideRunResult: ".run-result",
      ideTextarea: "textarea.ide-textarea",
      ideSampleBlock: ".io-sample-block",
      cmContent: ".cm-content",
      lentilleContext: "script#lentille-context"
    };
    const injectStyle = () => {
      if (document.getElementById("luogusp-ide-style")) return;
      const style = document.createElement("style");
      style.id = "luogusp-ide-style";
      style.textContent = IDE_BATCH_STYLE;
      (document.head || document.documentElement).appendChild(style);
    };
    function ideToolbarByTitle(title) {
      for (const tb of document.querySelectorAll(SELECTORS.ideToolbar)) {
        const t = tb.querySelector(SELECTORS.ideToolbarText);
        if (t && t.textContent.trim() === title) return tb;
      }
      return null;
    }
    const IDE_VIEW = {
      activeTab: "custom",
      // custom=原生输入输出 / samples=样例面板
      tabBar: null,
      panel: null,
      ioLayout: null,
      // 原生 输入|输出 水平分栏（tab 切换时显隐）
      rowsEl: null,
      summaryEl: null,
      stopBtn: null
    };
    function ideModeActive() {
      return location.hash === "#ide" && !!document.querySelector(SELECTORS.ideToolbar);
    }
    function lentilleProblem() {
      try {
        const el = document.querySelector(SELECTORS.lentilleContext);
        if (!el) return null;
        const json = JSON.parse(el.textContent);
        return json && json.data && json.data.problem || null;
      } catch (e) {
        return null;
      }
    }
    function currentPid() {
      const m = location.pathname.match(/^\/problem\/([A-Za-z0-9_]+)/);
      return m ? m[1] : "";
    }
    async function getIdeSamples(signal) {
      const pid = currentPid();
      if (!pid) return null;
      const p = lentilleProblem();
      if (p && p.pid === pid && Array.isArray(p.samples)) return p.samples;
      try {
        const res = await fetch(`/problem/${pid}`, {
          headers: { "x-lentille-request": "content-only" },
          signal
        });
        const json = await res.json();
        const prob = json && json.data && json.data.problem;
        if (prob && Array.isArray(prob.samples)) return prob.samples;
      } catch (e) {
        if (!signal || !signal.aborted)
          console.error("LuoguSP ide samples:", e);
      }
      return null;
    }
    function sampleRunButtons() {
      const btns = [];
      for (const block of document.querySelectorAll(SELECTORS.ideSampleBlock)) {
        if (!/^(输入|Input)/i.test((block.textContent || "").trim())) continue;
        const run = [...block.querySelectorAll("a, button")].find(
          (b) => (b.textContent || "").trim() === "运行"
        );
        if (run) btns.push(run);
      }
      return btns;
    }
    function readIdeCode() {
      const content = document.querySelector(SELECTORS.cmContent);
      if (!content) return "";
      const view = content.cmTile && content.cmTile.view;
      if (view && view.state && view.state.doc) return view.state.doc.toString();
      return content.textContent || "";
    }
    let ideSubmitWaiter = null;
    let ideSubmitPatchDispose = null;
    function cancelIdeSubmitWaiter(runId) {
      if (!ideSubmitWaiter) return;
      if (runId != null && ideSubmitWaiter.runId !== runId) return;
      const waiter = ideSubmitWaiter;
      ideSubmitWaiter = null;
      waiter.resolve(null);
    }
    function installIdeSubmitObserver() {
      if (ideSubmitPatchDispose) return ideSubmitPatchDispose;
      const rawOpen = XMLHttpRequest.prototype.open;
      const rawSend = XMLHttpRequest.prototype.send;
      const submitRequests = /* @__PURE__ */ new WeakMap();
      let active = true;
      const open = function(method, url) {
        if (active)
          submitRequests.set(
            this,
            typeof url === "string" && url.indexOf("/api/ide_submit") !== -1
          );
        return rawOpen.apply(this, arguments);
      };
      const send = function() {
        if (active && submitRequests.get(this))
          this.addEventListener("loadend", () => {
            if (ideSubmitWaiter) {
              const w = ideSubmitWaiter;
              ideSubmitWaiter = null;
              w.resolve(this.status);
            }
          });
        return rawSend.apply(this, arguments);
      };
      XMLHttpRequest.prototype.open = open;
      XMLHttpRequest.prototype.send = send;
      const dispose = () => {
        active = false;
        cancelIdeSubmitWaiter();
        if (XMLHttpRequest.prototype.open === open)
          XMLHttpRequest.prototype.open = rawOpen;
        if (XMLHttpRequest.prototype.send === send)
          XMLHttpRequest.prototype.send = rawSend;
        if (ideSubmitPatchDispose === dispose) ideSubmitPatchDispose = null;
      };
      ideSubmitPatchDispose = dispose;
      return dispose;
    }
    function waitIdeSubmit(ms, runId) {
      cancelIdeSubmitWaiter();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (ideSubmitWaiter && ideSubmitWaiter.resolve === fn)
            ideSubmitWaiter = null;
          resolve(null);
        }, ms);
        const fn = (status) => {
          clearTimeout(timer);
          resolve(status);
        };
        ideSubmitWaiter = { runId, resolve: fn };
      });
    }
    function outputParts() {
      const tb = ideToolbarByTitle("输出");
      if (!tb) return null;
      const actions = tb.querySelector(SELECTORS.ideToolbarActions);
      const spans = actions ? [...actions.querySelectorAll("span")] : [];
      return {
        pill: spans.find((s) => !s.classList.contains("run-result")) || null,
        rr: actions ? actions.querySelector(SELECTORS.ideRunResult) : null,
        textarea: tb.parentElement ? tb.parentElement.querySelector(SELECTORS.ideTextarea) : null
      };
    }
    async function waitIdePill(present, timeoutMs, isCurrent = () => true, wait) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (!isCurrent()) return null;
        const parts = outputParts();
        if (!parts) return null;
        if (!!parts.pill === present) return parts.pill || true;
        if (!await wait(150)) return null;
      }
      return null;
    }
    async function runOneSample(runBtn, runId, drive, isCurrent, wait) {
      const before = outputParts();
      if (!before) return { verdict: "UKE", note: "IDE 面板不存在" };
      const hadPill = !!before.pill;
      let submitP = waitIdeSubmit(1e4, runId);
      drive(() => runBtn.click());
      let status = await submitP;
      if (status === 429) {
        if (!await wait(3e3)) return { verdict: "UKE", note: "页面已切换" };
        if (!isCurrent()) return { verdict: "UKE", note: "页面已切换" };
        submitP = waitIdeSubmit(1e4, runId);
        drive(() => runBtn.click());
        status = await submitP;
      }
      if (status == null || status < 200 || status >= 300)
        return {
          verdict: "UKE",
          note: status == null ? "未观测到提交请求" : `提交失败 HTTP ${status}`
        };
      if (hadPill && await waitIdePill(false, 5e3, isCurrent, wait) === null)
        return { verdict: "UKE", note: "旧结果未清空，疑似运行未开始" };
      const pill = await waitIdePill(true, 3e4, isCurrent, wait);
      if (!pill || pill === true)
        return { verdict: "UKE", note: "30s 未返回结果" };
      const parts = outputParts();
      return {
        verdict: (pill.textContent || "").trim() || "UKE",
        pillStyle: pill.getAttribute("style") || "",
        detail: parts.rr ? parts.rr.textContent.trim() : "",
        output: parts.textarea ? parts.textarea.value : ""
      };
    }
    let ideHintTimer = null;
    function ideBatchHint(msg, running = false) {
      const btn = document.querySelector(".luogusp-ide-batch-btn");
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = msg;
      btn.disabled = true;
      if (ideHintTimer !== null) clearTimeout(ideHintTimer);
      ideHintTimer = setTimeout(() => {
        ideHintTimer = null;
        btn.textContent = old;
        btn.disabled = running;
      }, 1500);
    }
    function normalizeIdeOut(s) {
      return String(s == null ? "" : s).replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n+$/, "");
    }
    function idePane(title, lines, badSet, emptyNote) {
      const pre = document.createElement("pre");
      if (!lines.length || lines.length === 1 && lines[0] === "") {
        if (emptyNote) {
          const span = document.createElement("span");
          span.className = "luogusp-ide-empty";
          span.textContent = emptyNote;
          pre.appendChild(span);
        }
      } else {
        lines.forEach((l, k) => {
          const span = document.createElement("span");
          if (badSet && badSet.has(k)) span.className = "luogusp-ide-diffline";
          span.textContent = l;
          pre.appendChild(span);
          if (k < lines.length - 1)
            pre.appendChild(document.createTextNode("\n"));
        });
      }
      const box = document.createElement("div");
      box.className = "code-container";
      box.append(pre, makeCopyButton(pre));
      const pane = document.createElement("div");
      pane.className = "luogusp-ide-pane";
      const h = document.createElement("h5");
      h.textContent = title;
      pane.append(h, box);
      return pane;
    }
    function applyIdeResult(i, r, sample) {
      const p = ideRowParts(i);
      if (!p) return;
      p.pill.textContent = r.verdict;
      p.pill.setAttribute(
        "style",
        r.pillStyle || "background-color:#3d3d3d;border-color:#333;color:#fff;"
      );
      p.detail.innerHTML = "";
      p.detail.classList.remove("luogusp-ide-log");
      if (r.verdict === "CE") {
        p.meta.textContent = "";
        p.detail.classList.add("luogusp-ide-log");
        p.detail.appendChild(
          idePane(
            "编译信息",
            String(r.output || "").split("\n"),
            null,
            "（无编译输出）"
          )
        );
        return;
      }
      p.meta.textContent = r.detail || "";
      if (r.note) {
        const note = document.createElement("p");
        note.className = "luogusp-ide-note";
        note.textContent = r.note;
        p.detail.appendChild(note);
        if (r.output == null) {
          p.detail.classList.add("luogusp-ide-log");
          return;
        }
      }
      if (r.verdict === "RE" && r.detail) {
        const note = document.createElement("p");
        note.className = "luogusp-ide-note";
        note.textContent = r.detail;
        p.detail.appendChild(note);
        p.meta.textContent = "";
      }
      const expLines = normalizeIdeOut(sample[1]).split("\n");
      const actLines = normalizeIdeOut(r.output).split("\n");
      const bad = /* @__PURE__ */ new Set();
      if (r.verdict !== "AC") {
        const m = Math.max(expLines.length, actLines.length);
        for (let k = 0; k < m; k++)
          if ((expLines[k] || "") !== (actLines[k] || "")) bad.add(k);
      }
      p.detail.append(
        idePane("输入", normalizeIdeOut(sample[0]).split("\n"), null, "（空）"),
        idePane("期望输出", expLines, bad, "（空）"),
        idePane(
          "实际输出",
          actLines,
          bad,
          r.verdict === "AC" ? "（空）" : "（未产生输出）"
        )
      );
    }
    function finishIdeSummary(results) {
      if (!IDE_VIEW.summaryEl || !results) return;
      const rs = results;
      const counts = {};
      let ac = 0, tested = 0;
      rs.forEach((r) => {
        if (!r) return;
        tested++;
        if (r.verdict === "AC") ac++;
        else counts[r.verdict] = (counts[r.verdict] || 0) + 1;
      });
      let text = `${ac}/${rs.length} 通过`;
      for (const k in counts) text += ` · ${counts[k]} ${k}`;
      if (tested < rs.length) {
        text += " · 已停止";
        rs.forEach((r, i) => {
          if (r) return;
          const p = ideRowParts(i);
          if (p) p.pill.textContent = "未测";
        });
      }
      IDE_VIEW.summaryEl.textContent = text;
      const firstBad = rs.findIndex((r) => r && r.verdict !== "AC");
      if (firstBad !== -1) expandIdeRow(firstBad);
      else if (IDE_VIEW.rowsEl)
        IDE_VIEW.rowsEl.querySelectorAll(".luogusp-ide-row.open").forEach((r) => r.classList.remove("open"));
    }
    function showIdeStale() {
      if (IDE_VIEW.summaryEl && document.contains(IDE_VIEW.summaryEl))
        IDE_VIEW.summaryEl.textContent += " · 结果可能已过期，建议重新测试";
    }
    function hookIdeStaleAndGuard(controls) {
      const stale = (e) => {
        if (e.target && e.target.closest && e.target.closest(SELECTORS.cmContent))
          controls.markStale();
      };
      document.addEventListener("input", stale, true);
      document.addEventListener("keydown", stale, true);
      const guard = (e) => {
        if (!controls.isRunning() || controls.isDriving()) return;
        const t = e.target && e.target.closest && e.target.closest(
          `${SELECTORS.ideSampleBlock} a, ${SELECTORS.ideToolbar} a.run`
        );
        if (t) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      document.addEventListener("click", guard, true);
      return () => {
        document.removeEventListener("input", stale, true);
        document.removeEventListener("keydown", stale, true);
        document.removeEventListener("click", guard, true);
      };
    }
    function mountIdeButton(controls) {
      const tb = ideToolbarByTitle("代码");
      if (!tb) return;
      const actions = tb.querySelector(SELECTORS.ideToolbarActions);
      if (!actions || actions.querySelector(".luogusp-ide-batch-btn")) return;
      const selfTest = [...actions.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === "自测"
      );
      if (!selfTest) return;
      const btn = selfTest.cloneNode(true);
      btn.textContent = "一键测试";
      btn.classList.add("luogusp-ide-batch-btn");
      btn.disabled = false;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        controls.start();
      });
      actions.insertBefore(btn, selfTest);
    }
    function mountIdeTabs(controls) {
      if (IDE_VIEW.tabBar && document.contains(IDE_VIEW.tabBar)) return;
      const inputTb = ideToolbarByTitle("输入");
      if (!inputTb) return;
      const ioLayout = inputTb.closest(".panel-layout");
      const host = ioLayout && ioLayout.parentElement;
      if (!host) return;
      host.querySelectorAll(".luogusp-ide-tabbar, .luogusp-ide-panel").forEach((e) => e.remove());
      const tabBar = document.createElement("div");
      tabBar.className = "luogusp-ide-tabbar";
      tabBar.innerHTML = '<span class="luogusp-ide-tab" data-tab="custom">自定义测试</span><span class="luogusp-ide-tab" data-tab="samples">样例测试</span>';
      tabBar.addEventListener("click", (e) => {
        const t = e.target.closest("[data-tab]");
        if (t) switchIdeTab(t.dataset.tab);
      });
      const panel = document.createElement("div");
      panel.className = "luogusp-ide-panel";
      panel.innerHTML = '<div class="luogusp-ide-head"><span class="luogusp-ide-title">样例测试</span><span class="luogusp-ide-summary">尚未运行</span><span class="luogusp-ide-headbtns"></span></div><div class="luogusp-ide-rows"></div>';
      const tpl = [
        ...document.querySelectorAll(`${SELECTORS.ideToolbar} button`)
      ].find(
        (b) => (b.textContent || "").trim() === "自测" || b.classList.contains("luogusp-ide-batch-btn")
      );
      const headBtns = panel.querySelector(".luogusp-ide-headbtns");
      const mkBtn = (text, cls, onClick) => {
        const b = tpl ? tpl.cloneNode(true) : document.createElement("button");
        b.textContent = text;
        b.className = (tpl ? tpl.className : "") + " " + cls;
        b.classList.remove("luogusp-ide-batch-btn");
        b.disabled = false;
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        });
        headBtns.appendChild(b);
        return b;
      };
      IDE_VIEW.stopBtn = mkBtn("停止", "luogusp-ide-stop", controls.stop);
      IDE_VIEW.stopBtn.style.display = "none";
      mkBtn("重新测试", "luogusp-ide-rerun", controls.start);
      host.insertBefore(tabBar, ioLayout);
      host.appendChild(panel);
      IDE_VIEW.tabBar = tabBar;
      IDE_VIEW.panel = panel;
      IDE_VIEW.ioLayout = ioLayout;
      IDE_VIEW.rowsEl = panel.querySelector(".luogusp-ide-rows");
      IDE_VIEW.summaryEl = panel.querySelector(".luogusp-ide-summary");
      syncIdeTabVisibility();
    }
    function switchIdeTab(tab) {
      IDE_VIEW.activeTab = tab;
      syncIdeTabVisibility();
    }
    function syncIdeTabVisibility() {
      const { tabBar, panel, ioLayout } = IDE_VIEW;
      if (!tabBar || !document.contains(tabBar) || !panel || !ioLayout) return;
      const samples = IDE_VIEW.activeTab === "samples";
      ioLayout.style.display = samples ? "none" : "";
      panel.style.display = samples ? "" : "none";
      tabBar.querySelectorAll(".luogusp-ide-tab").forEach((t) => {
        t.classList.toggle("on", t.dataset.tab === "samples" === samples);
      });
    }
    const IDE_PILL_WAIT = "background-color:#bfbfbf;border-color:#b3b3b3;color:#fff;";
    const IDE_PILL_RUN = "background-color:#3498db;border-color:#2f89c5;color:#fff;";
    function renderIdeRows(samples) {
      const rowsEl = IDE_VIEW.rowsEl;
      if (!rowsEl) return;
      rowsEl.innerHTML = samples.map(
        (s, i) => `
      <div class="luogusp-ide-row" data-idx="${i}">
        <div class="luogusp-ide-rowhead">
          <span class="luogusp-ide-chev">▶</span>样例 #${i + 1}
          <span class="luogusp-ide-meta"></span>
          <span class="luogusp-ide-pill" style="${IDE_PILL_WAIT}">等待</span>
        </div>
        <div class="luogusp-ide-detail"></div>
      </div>`
      ).join("");
      rowsEl.querySelectorAll(".luogusp-ide-rowhead").forEach((h) => {
        h.addEventListener("click", () => {
          const row = h.parentElement;
          const was = row.classList.contains("open");
          rowsEl.querySelectorAll(".luogusp-ide-row.open").forEach((r) => r.classList.remove("open"));
          if (!was) row.classList.add("open");
        });
      });
    }
    function ideRowParts(i) {
      const row = IDE_VIEW.rowsEl && IDE_VIEW.rowsEl.querySelector(`.luogusp-ide-row[data-idx="${i}"]`);
      if (!row) return null;
      return {
        row,
        pill: row.querySelector(".luogusp-ide-pill"),
        meta: row.querySelector(".luogusp-ide-meta"),
        detail: row.querySelector(".luogusp-ide-detail")
      };
    }
    function expandIdeRow(i) {
      if (!IDE_VIEW.rowsEl) return;
      IDE_VIEW.rowsEl.querySelectorAll(".luogusp-ide-row.open").forEach((r) => r.classList.remove("open"));
      const p = ideRowParts(i);
      if (p) p.row.classList.add("open");
    }
    function ensureIdeBatchUI(controls) {
      if (!ideModeActive()) {
        unmountIdeBatchUI();
        controls.invalidate();
        return;
      }
      mountIdeButton(controls);
      mountIdeTabs(controls);
      syncIdeTabVisibility();
    }
    function unmountIdeBatchUI() {
      IDE_VIEW.activeTab = "custom";
      IDE_VIEW.tabBar = IDE_VIEW.panel = IDE_VIEW.ioLayout = null;
      IDE_VIEW.rowsEl = IDE_VIEW.summaryEl = IDE_VIEW.stopBtn = null;
    }
    const ideBrowserDriver = {
      mountKey: () => document.body,
      prepare: async ({ runId, signal }) => {
        mountIdeTabs(ideBrowserDriver.controls);
        const pid = currentPid();
        const routeToken = `${location.pathname}${location.search}${location.hash}`;
        const samples = await getIdeSamples(signal);
        if (!pid || currentPid() !== pid || `${location.pathname}${location.search}${location.hash}` !== routeToken || !ideModeActive())
          return { kind: "hint", message: "页面已切换" };
        if (!samples || !samples.length)
          return { kind: "hint", message: "本题无样例" };
        if (!readIdeCode().trim())
          return { kind: "hint", message: "代码为空" };
        const runButtons = sampleRunButtons();
        if (!runButtons.length)
          return { kind: "hint", message: "找不到样例运行按钮" };
        const count = Math.min(samples.length, runButtons.length);
        if (runButtons.length !== samples.length)
          console.error(
            "LuoguSP ide batch: 样例数与运行按钮数不一致",
            samples.length,
            runButtons.length
          );
        const inputToolbar = ideToolbarByTitle("输入");
        const input = inputToolbar && inputToolbar.parentElement ? inputToolbar.parentElement.querySelector(SELECTORS.ideTextarea) : null;
        const codeToolbar = ideToolbarByTitle("代码");
        const actions = codeToolbar && codeToolbar.querySelector(SELECTORS.ideToolbarActions);
        const selfTest = actions ? [...actions.querySelectorAll("button")].find(
          (button) => (button.textContent || "").trim() === "自测"
        ) : null;
        return {
          kind: "ready",
          runId,
          pid,
          routeToken,
          samples,
          runButtons,
          count,
          input,
          inputSnapshot: input ? input.value : null,
          batchButton: document.querySelector(".luogusp-ide-batch-btn"),
          selfTest
        };
      },
      isCurrent: (context) => ideModeActive() && currentPid() === context.pid && `${location.pathname}${location.search}${location.hash}` === context.routeToken,
      hint: (message) => ideBatchHint(message),
      begin: (context) => {
        if (context.batchButton) context.batchButton.disabled = true;
        if (context.selfTest) context.selfTest.disabled = true;
        if (IDE_VIEW.stopBtn) IDE_VIEW.stopBtn.style.display = "";
        switchIdeTab("samples");
        renderIdeRows(context.samples);
        if (IDE_VIEW.summaryEl) IDE_VIEW.summaryEl.textContent = "测试中…";
      },
      setRunning: (_context, index) => {
        const parts = ideRowParts(index);
        if (parts) {
          parts.pill.setAttribute("style", IDE_PILL_RUN);
          parts.pill.textContent = "运行中";
        }
        expandIdeRow(index);
      },
      runSample: async (context, index, task) => {
        try {
          return await runOneSample(
            context.runButtons[index],
            task.runId,
            task.drive,
            task.isCurrent,
            task.wait
          );
        } catch (error) {
          cancelIdeSubmitWaiter(task.runId);
          throw error;
        }
      },
      applyResult: (context, index, result) => applyIdeResult(index, result, context.samples[index]),
      restore: (context) => {
        if (context.input && context.inputSnapshot != null) {
          context.input.value = context.inputSnapshot;
          context.input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      finish: (context, results) => {
        if (context.batchButton) context.batchButton.disabled = false;
        if (context.selfTest) context.selfTest.disabled = false;
        if (IDE_VIEW.stopBtn) IDE_VIEW.stopBtn.style.display = "none";
        finishIdeSummary(results);
      },
      cancel: () => cancelIdeSubmitWaiter(),
      markStale: showIdeStale,
      mount: (controls) => {
        ideBrowserDriver.controls = controls;
        const unpatchSubmit = installIdeSubmitObserver();
        const unhook = hookIdeStaleAndGuard(controls);
        let frame = null;
        const tick = () => {
          frame = null;
          try {
            ensureIdeBatchUI(controls);
          } catch (error) {
            console.error("LuoguSP ide batch:", error);
          }
        };
        const queue = () => {
          if (frame === null) frame = requestAnimationFrame(tick);
        };
        const observer = new MutationObserver(() => {
          if (location.hash === "#ide" || IDE_VIEW.tabBar || controls.isRunning())
            queue();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        ensureIdeBatchUI(controls);
        return () => {
          observer.disconnect();
          unpatchSubmit();
          unhook();
          if (ideHintTimer !== null) {
            clearTimeout(ideHintTimer);
            ideHintTimer = null;
          }
          if (frame !== null) cancelAnimationFrame(frame);
          cancelIdeSubmitWaiter();
          unmountIdeBatchUI();
        };
      }
    };
    const idePreparation = idePreparationAdapter;
    const ideDriver = idePreparation ? {
      prepare: async ({ signal }) => {
        idePreparation.mountTabs();
        const pid = idePreparation.currentPid();
        const samples = await idePreparation.loadSamples(signal);
        if (!pid || idePreparation.currentPid() !== pid || !idePreparation.isModeActive())
          return { kind: "hint", message: "页面已切换" };
        if (!samples || !samples.length)
          return { kind: "hint", message: "本题无样例" };
        return { kind: "ready", count: 0, pid, samples };
      },
      isCurrent: () => true,
      hint: (message) => idePreparation.hint(message),
      runSample: async () => ({ verdict: "UKE" })
    } : ideBrowserDriver;
    const ideBatchRunner = createIdeBatchRunner({
      ideDriver,
      clock: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id)
      },
      logError: (error) => console.error("LuoguSP ide batch:", error)
    });
    const startIdeBatch = () => ideBatchRunner.start();
    const descriptor = defineConfigurableFeature({
      id: "ide-batch",
      key: "ideBatchSampleTest",
      label: "IDE 模式一键测试所有样例",
      storage,
      mount: () => {
        injectStyle();
        ideBatchRunner.mount();
        return () => ideBatchRunner.unmount();
      }
    });
    return Object.freeze({
      ...descriptor,
      start: startIdeBatch,
      getState: () => ideBatchRunner.getState()
    });
  }

  // src/core/get-request-scheduler.js
  function createGetRequestScheduler(config) {
    const {
      fetch: fetchImpl,
      clock,
      launchGap = 300,
      concurrency = 3,
      timeoutMs = 15e3,
      maxRetries = 1,
      createAbortController = () => new AbortController()
    } = config || {};
    if (typeof fetchImpl !== "function")
      throw new TypeError("GET scheduler requires a fetch adapter");
    if (!clock || typeof clock.now !== "function" || typeof clock.setTimeout !== "function" || typeof clock.clearTimeout !== "function")
      throw new TypeError("GET scheduler requires a clock adapter");
    const queue = [];
    const inflight = /* @__PURE__ */ new Map();
    const controllers = /* @__PURE__ */ new Set();
    let active = 0;
    let nextAt = 0;
    let wakeTimer = null;
    let disposed = false;
    const abortError = () => {
      const error = new Error("GET scheduler disposed");
      error.name = "AbortError";
      return error;
    };
    const retryAfterMs = (raw) => {
      if (!raw) return 0;
      const seconds = Number(raw);
      if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
      const at = Date.parse(raw);
      return Number.isFinite(at) ? Math.max(0, at - clock.now()) : 0;
    };
    const defer = (ms) => {
      if (disposed || !(ms > 0)) return;
      const until = clock.now() + ms;
      if (until <= nextAt) return;
      nextAt = until;
      if (wakeTimer !== null) {
        clock.clearTimeout(wakeTimer);
        wakeTimer = null;
      }
      drain();
    };
    const drain = () => {
      if (disposed) return;
      while (active < concurrency && queue.length) {
        const wait = nextAt - clock.now();
        if (wait > 0) {
          if (wakeTimer === null) {
            wakeTimer = clock.setTimeout(() => {
              wakeTimer = null;
              drain();
            }, wait);
          }
          return;
        }
        nextAt = clock.now() + launchGap;
        const job = queue.shift();
        const controller = createAbortController();
        const timeout = clock.setTimeout(() => controller.abort(), timeoutMs);
        controllers.add(controller);
        active++;
        (async () => {
          try {
            const response = await fetchImpl(job.url, {
              signal: controller.signal
            });
            if (disposed) throw abortError();
            if (!response.ok) {
              const error = new Error(`HTTP ${response.status} ${job.url}`);
              error.status = response.status;
              if ((response.status === 429 || response.status === 503) && job.retries < maxRetries) {
                job.retries++;
                const retryAfter = response.headers && typeof response.headers.get === "function" && response.headers.get("retry-after");
                defer(retryAfterMs(retryAfter) || launchGap);
                queue.unshift(job);
                return;
              }
              throw error;
            }
            const text2 = await response.text();
            if (disposed) throw abortError();
            job.resolve(text2);
          } catch (error) {
            job.reject(error);
          } finally {
            clock.clearTimeout(timeout);
            controllers.delete(controller);
            active--;
            drain();
          }
        })();
      }
    };
    const attachSignal = (promise, signal) => {
      if (!signal) return promise;
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          cleanup();
          reject(abortError());
        };
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
          (value) => {
            cleanup();
            resolve(value);
          },
          (error) => {
            cleanup();
            reject(error);
          }
        );
      });
    };
    const text = (url, options) => {
      if (disposed) return Promise.reject(abortError());
      let promise = inflight.get(url);
      if (!promise) {
        promise = new Promise((resolve, reject) => {
          queue.push({ url, resolve, reject, retries: 0 });
          drain();
        }).finally(() => {
          if (inflight.get(url) === promise) inflight.delete(url);
        });
        inflight.set(url, promise);
      }
      return attachSignal(promise, options && options.signal);
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (wakeTimer !== null) clock.clearTimeout(wakeTimer);
      wakeTimer = null;
      const error = abortError();
      while (queue.length) queue.shift().reject(error);
      for (const controller of controllers) controller.abort();
    };
    return Object.freeze({ text, dispose });
  }

  // src/features/problem-color/identity.js
  function createProblemIdentityResolver(config) {
    const { getOrigin, voidAnchorSelector } = config || {};
    if (typeof getOrigin !== "function")
      throw new TypeError("Problem Identity requires an origin adapter");
    const isProblemId = (id) => {
      if (typeof id !== "string" || !id) return false;
      if (id.startsWith("AT_")) return true;
      return /[a-zA-Z]/.test(id) && /[0-9]/.test(id);
    };
    const anchorShowsPid = (anchor, pid) => {
      const first = anchor.firstElementChild;
      if (first && first.matches("span.pid") && (first.innerText || first.textContent || "").trim() === pid)
        return true;
      const text = (anchor.innerText || anchor.textContent || "").trimStart();
      if (!text.startsWith(pid)) return false;
      return !/[A-Za-z0-9_]/.test(text.charAt(pid.length));
    };
    const resolve = (anchor) => {
      if (!anchor || !anchor.matches) return null;
      if (voidAnchorSelector && anchor.matches(voidAnchorSelector)) {
        const pid2 = (anchor.innerText || anchor.textContent || "").trim().split(/\s+/)[0];
        return isProblemId(pid2) && anchorShowsPid(anchor, pid2) ? { pid: pid2, kind: "void", key: `void:${pid2}` } : null;
      }
      const origin = getOrigin();
      let url;
      try {
        url = new URL(anchor.href, origin);
      } catch (error) {
        return null;
      }
      if (url.origin !== origin) return null;
      const forumPid = url.searchParams.get("forum");
      if (forumPid)
        return isProblemId(forumPid) && anchorShowsPid(anchor, forumPid) ? { pid: forumPid, kind: "forum", key: `forum:${url.href}` } : null;
      const path = url.pathname.match(/^\/problem\/([A-Za-z0-9_]+)\/?$/);
      const pid = path && path[1];
      return isProblemId(pid) && anchorShowsPid(anchor, pid) ? { pid, kind: "problem", key: `problem:${url.href}` } : null;
    };
    return Object.freeze({ resolve });
  }
  function recordDifficultyForHarvest(difficulty) {
    return Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= 4 ? difficulty : null;
  }

  // src/features/problem-color/pipeline.js
  function createProblemPipeline(config) {
    const {
      identity,
      documentAdapter,
      routeAdapter,
      difficultySource,
      colorForDifficulty,
      cacheLimit = 1e3,
      createAbortController = () => new AbortController(),
      logError = () => {
      }
    } = config || {};
    if (!identity || typeof identity.resolve !== "function")
      throw new TypeError("Problem Pipeline requires a Problem Identity adapter");
    if (!documentAdapter || typeof documentAdapter.anchors !== "function" || typeof documentAdapter.observeAnchors !== "function" || typeof documentAdapter.applyColor !== "function")
      throw new TypeError("Problem Pipeline requires a document adapter");
    if (!difficultySource || typeof difficultySource.text !== "function")
      throw new TypeError("Problem Pipeline requires a difficulty source");
    if (typeof colorForDifficulty !== "function")
      throw new TypeError("Problem Pipeline requires a color adapter");
    const DIFFICULTY_RE = /"difficulty":\s*(\d+)/;
    const colors = /* @__PURE__ */ new Map();
    const harvestedLists = /* @__PURE__ */ new WeakSet();
    let coloringAnchors = /* @__PURE__ */ new WeakMap();
    let contentOnlySupport = null;
    let mounted = false;
    let generation = 0;
    let stopObserving = null;
    let activeController = null;
    const routeToken = () => routeAdapter && typeof routeAdapter.token === "function" ? routeAdapter.token() : "";
    const rememberColor = (pid, color) => {
      if (!pid || !color) return;
      if (colors.has(pid)) colors.delete(pid);
      colors.set(pid, color);
      if (colors.size > cacheLimit) colors.delete(colors.keys().next().value);
    };
    const rememberDifficulty = (pid, difficulty) => {
      if (pid && typeof difficulty === "number")
        rememberColor(pid, colorForDifficulty(difficulty));
    };
    const harvest = () => {
      if (typeof difficultySource.harvest !== "function") return;
      const batches = difficultySource.harvest() || [];
      for (const batch of batches) {
        if (!batch || !batch.source || typeof batch.source !== "object" && typeof batch.source !== "function" || harvestedLists.has(batch.source))
          continue;
        const problems = typeof batch.problems === "function" ? batch.problems() : batch.problems;
        for (const problem of problems || [])
          rememberDifficulty(problem && problem.pid, problem && problem.difficulty);
        harvestedLists.add(batch.source);
      }
    };
    const fetchDifficulty = async (pid, signal) => {
      if (contentOnlySupport !== false) {
        let text;
        try {
          text = await difficultySource.text(
            `/problem/${pid}?_contentOnly=1`,
            { signal }
          );
        } catch (error) {
          if (signal.aborted) return null;
          if (error && (error.status === 403 || error.status === 404)) return null;
        }
        if (text != null) {
          try {
            const difficulty = JSON.parse(text)?.currentData?.problem?.difficulty;
            if (typeof difficulty === "number") {
              contentOnlySupport = true;
              return difficulty;
            }
          } catch (error) {
            const htmlDifficulty = text.match(DIFFICULTY_RE);
            if (htmlDifficulty) {
              contentOnlySupport = false;
              return Number(htmlDifficulty[1]);
            }
          }
        }
      }
      if (signal.aborted) return null;
      try {
        const html = await difficultySource.text(`/problem/${pid}`, { signal });
        const match = html.match(DIFFICULTY_RE);
        return match ? Number(match[1]) : null;
      } catch (error) {
        if (!signal.aborted) logError(pid, error);
        return null;
      }
    };
    const getColor = async (pid, signal) => {
      harvest();
      if (colors.has(pid)) return colors.get(pid);
      const difficulty = await fetchDifficulty(pid, signal);
      if (signal.aborted || difficulty == null) return null;
      const color = colorForDifficulty(difficulty);
      rememberColor(pid, color);
      return color;
    };
    const colorAnchor = async (anchor) => {
      const controller = activeController;
      if (!controller) return;
      const taskGeneration = generation;
      const taskRoute = routeToken();
      const taskIdentity = identity.resolve(anchor);
      const appliedPid = typeof documentAdapter.appliedPid === "function" ? documentAdapter.appliedPid(anchor) : null;
      if (!taskIdentity) {
        if (appliedPid && typeof documentAdapter.clearColor === "function")
          documentAdapter.clearColor(anchor, appliedPid);
        return;
      }
      if (appliedPid === taskIdentity.pid) return;
      if (appliedPid && typeof documentAdapter.clearColor === "function")
        documentAdapter.clearColor(anchor, appliedPid);
      if (coloringAnchors.get(anchor) === taskIdentity.key) return;
      coloringAnchors.set(anchor, taskIdentity.key);
      try {
        const color = await getColor(taskIdentity.pid, controller.signal);
        const currentIdentity = identity.resolve(anchor);
        if (!mounted || generation !== taskGeneration || routeToken() !== taskRoute || !color || typeof documentAdapter.isConnected === "function" && !documentAdapter.isConnected(anchor) || !currentIdentity || currentIdentity.key !== taskIdentity.key)
          return;
        documentAdapter.applyColor(anchor, taskIdentity.pid, color);
      } finally {
        if (coloringAnchors.get(anchor) === taskIdentity.key)
          coloringAnchors.delete(anchor);
      }
    };
    const acceptAnchors = (anchors) => {
      for (const anchor of anchors || []) colorAnchor(anchor);
    };
    const scan = (root) => acceptAnchors(documentAdapter.anchors(root));
    const dispose = () => {
      if (!mounted) return;
      mounted = false;
      generation++;
      if (activeController) activeController.abort();
      activeController = null;
      if (stopObserving) stopObserving();
      stopObserving = null;
      coloringAnchors = /* @__PURE__ */ new WeakMap();
    };
    const mount = () => {
      if (mounted) return dispose;
      mounted = true;
      generation++;
      activeController = createAbortController();
      stopObserving = documentAdapter.observeAnchors(acceptAnchors) || null;
      scan(documentAdapter.root);
      return dispose;
    };
    return Object.freeze({ mount, dispose });
  }

  // src/features/problem-color/feature.js
  function createProblemColorFeature({ storage }) {
    const DIFFICULTY_COLORS = [
      "#bfbfbf",
      "#fe4c61",
      "#f39c11",
      "#ffc116",
      "#52c41a",
      "#14b8a6",
      "#3498db",
      "#9d3dcf",
      "#0f172a"
    ];
    const FALLBACK_COLOR = "#bfbfbf";
    const diffColor = (difficulty) => DIFFICULTY_COLORS[difficulty] || FALLBACK_COLOR;
    const SELECTORS = {
      voidAnchor: "a[data-v-bade3303][data-v-4842157a]"
    };
    const limiter = createGetRequestScheduler({
      fetch: (url, init) => fetch(url, init),
      clock: {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id)
      },
      launchGap: 300,
      concurrency: 3,
      timeoutMs: 15e3,
      maxRetries: 1
    });
    const PROBLEM_ANCHOR_SELECTOR = [
      'a[href*="/problem/"]',
      'a[href*="?forum="]',
      SELECTORS.voidAnchor
    ].join(",");
    const problemIdentity = createProblemIdentityResolver({
      getOrigin: () => location.origin,
      voidAnchorSelector: SELECTORS.voidAnchor
    });
    const problemAnchorIdentity = (anchor) => problemIdentity.resolve(anchor);
    function wrapPidText(root, pid, color) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        const idx = node.nodeValue.indexOf(pid);
        if (idx === -1) continue;
        const mid = node.splitText(idx);
        mid.splitText(pid.length);
        const b = document.createElement("b");
        b.style.color = color;
        b.textContent = pid;
        mid.parentNode.replaceChild(b, mid);
        return b;
      }
      return null;
    }
    const appliedProblemColors = /* @__PURE__ */ new WeakMap();
    const captureInlineProperty = (element, property) => Object.freeze({
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property)
    });
    const restoreInlineProperty = (element, property, original) => {
      if (original.value)
        element.style.setProperty(property, original.value, original.priority);
      else element.style.removeProperty(property);
    };
    const clearProblemColor = (anchor) => {
      const state = appliedProblemColors.get(anchor);
      if (state && state.node && anchor.contains(state.node)) {
        if (state.kind === "span") {
          restoreInlineProperty(state.node, "color", state.color);
          restoreInlineProperty(state.node, "font-weight", state.fontWeight);
        } else if (state.kind === "wrapper") {
          state.node.replaceWith(document.createTextNode(state.node.textContent || ""));
          anchor.normalize();
        }
      }
      appliedProblemColors.delete(anchor);
      delete anchor.dataset.luoguspPid;
    };
    const problemPipeline = typeof document === "undefined" ? null : createProblemPipeline({
      identity: problemIdentity,
      routeAdapter: {
        token: () => `${location.origin}${location.pathname}${location.search}`
      },
      difficultySource: {
        text: (path, options) => limiter.text(path, options),
        // 记录列表 / 练习页已把整批难度注入 _feInstance；返回来源对象与纯题目数据，
        // 去重和 LRU 均由 Problem Pipeline Module 持有，不污染洛谷原始数组。
        // 记录列表的高档难度值不可靠，映射为 null 后由 Pipeline 查询题目页当前值。
        harvest: () => {
          const cur = window._feInstance && window._feInstance.currentData;
          if (!cur) return [];
          const batches = [];
          const url = location.href;
          if (url.startsWith("https://www.luogu.com.cn/record/list")) {
            const list = cur.records && cur.records.result;
            if (list && typeof list === "object")
              batches.push({
                source: list,
                problems: () => [...list].map((item) => ({
                  pid: item.problem && item.problem.pid,
                  difficulty: recordDifficultyForHarvest(
                    item.problem && item.problem.difficulty
                  )
                }))
              });
          }
          if (/^https:\/\/www\.luogu\.com\.cn\/user\/\d+#practice$/.test(url)) {
            for (const key of ["submittedProblems", "passedProblems"]) {
              const list = cur[key];
              if (list && typeof list === "object")
                batches.push({ source: list, problems: () => [...list] });
            }
          }
          return batches;
        }
      },
      colorForDifficulty: (difficulty) => diffColor(difficulty),
      logError: (pid, error) => console.error("LuoguSP difficulty:", pid, error),
      documentAdapter: {
        root: document,
        anchors: (root) => {
          if (!root || !root.querySelectorAll) return [];
          const anchors = [];
          if (root.matches && root.matches(PROBLEM_ANCHOR_SELECTOR))
            anchors.push(root);
          root.querySelectorAll(PROBLEM_ANCHOR_SELECTOR).forEach((anchor) => anchors.push(anchor));
          return anchors;
        },
        observeAnchors: (accept) => {
          const observer = new MutationObserver((mutations) => {
            const anchors = /* @__PURE__ */ new Set();
            for (const mutation of mutations) {
              if (mutation.type === "childList") {
                for (const node of mutation.addedNodes) {
                  if (node.nodeType !== Node.ELEMENT_NODE) continue;
                  if (node.matches && node.matches(PROBLEM_ANCHOR_SELECTOR))
                    anchors.add(node);
                  if (node.querySelectorAll)
                    node.querySelectorAll(PROBLEM_ANCHOR_SELECTOR).forEach((anchor) => anchors.add(anchor));
                }
              } else if (mutation.type === "characterData") {
                const span = mutation.target.parentElement;
                const anchor = span && span.matches && span.matches("span.pid") && span.closest("a[href]");
                if (anchor) anchors.add(anchor);
              } else if (mutation.type === "attributes") {
                anchors.add(mutation.target);
              }
            }
            accept(anchors);
          });
          observer.observe(document, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["href"]
          });
          return () => observer.disconnect();
        },
        appliedPid: (anchor) => anchor.dataset.luoguspPid,
        isConnected: (anchor) => anchor.isConnected,
        clearColor: (anchor) => clearProblemColor(anchor),
        applyColor: (a, pid, color) => {
          clearProblemColor(a);
          const span = a.children[0];
          if (span && span.matches("span.pid") && (span.innerText || span.textContent || "").trim() === pid) {
            appliedProblemColors.set(a, {
              kind: "span",
              node: span,
              color: captureInlineProperty(span, "color"),
              fontWeight: captureInlineProperty(span, "font-weight")
            });
            span.style.color = color;
            span.style.fontWeight = "bold";
            a.dataset.luoguspPid = pid;
          } else {
            const wrapper = wrapPidText(a, pid, color);
            if (!wrapper) return;
            appliedProblemColors.set(a, {
              kind: "wrapper",
              node: wrapper
            });
            a.dataset.luoguspPid = pid;
          }
        }
      }
    });
    return defineConfigurableFeature({
      id: "problem-pipeline",
      key: "addProblemsColor",
      label: "题号显示难度颜色",
      storage,
      mount: (context) => {
        let disposePipeline = null;
        const timer = setTimeout(() => {
          if (!context.isCurrent()) return;
          try {
            disposePipeline = problemPipeline ? problemPipeline.mount() : () => {
            };
          } catch (error) {
            console.error("LuoguSP lifecycle problem-pipeline:", error);
          }
        }, 500);
        return () => {
          clearTimeout(timer);
          if (disposePipeline) disposePipeline();
        };
      }
    });
  }

  // src/features/restricted-content/document-boot.js
  function createRestrictedDocumentBoot(config) {
    const {
      pageAdapter,
      saverWorkflow,
      documentBuilder,
      documentCommitter,
      pageLifecycle,
      createAbortController = () => new AbortController(),
      logError = () => {
      }
    } = config || {};
    if (!pageAdapter || typeof pageAdapter.detect !== "function")
      throw new TypeError("Restricted Document Boot requires a page adapter");
    if (!saverWorkflow || typeof saverWorkflow.ensureArchived !== "function")
      throw new TypeError("Restricted Document Boot requires Saver Workflow");
    if (!documentBuilder || typeof documentBuilder.prepare !== "function")
      throw new TypeError("Restricted Document Boot requires a document builder");
    if (!documentCommitter || typeof documentCommitter.commit !== "function")
      throw new TypeError("Restricted Document Boot requires a document committer");
    if (!pageLifecycle || typeof pageLifecycle.replaceDocument !== "function")
      throw new TypeError("Restricted Document Boot requires Page Lifecycle");
    let taskId = 0;
    let activeController = null;
    let rebuiltPath = "";
    const isCancelled = (error) => error && (error.kind === "cancelled" || error.name === "AbortError" || error.category === "cancelled");
    const mount = (lifecycleContext) => {
      const currentTask = ++taskId;
      let info;
      try {
        info = pageAdapter.detect();
      } catch (error) {
        logError(error);
        if (typeof pageAdapter.hideLoader === "function")
          pageAdapter.hideLoader();
        return () => {
        };
      }
      if (!info) {
        if (typeof pageAdapter.hideLoader === "function")
          pageAdapter.hideLoader();
        return () => {
          if (typeof documentBuilder.dispose === "function")
            documentBuilder.dispose();
        };
      }
      const controller = createAbortController();
      activeController = controller;
      pageAdapter.showLoader();
      const current = () => currentTask === taskId && !controller.signal.aborted && (!lifecycleContext || lifecycleContext.isCurrent());
      (async () => {
        try {
          const archive = await saverWorkflow.ensureArchived(info.type, info.id, {
            signal: controller.signal,
            onAccepted: () => {
              if (current())
                pageAdapter.showLoader(
                  "该内容尚未被保存站收录，已自动发起收录…"
                );
            }
          });
          if (!current()) return;
          if (archive.kind !== "archived") {
            if (archive.category === "cancelled") return;
            if (archive.stage === "lookup")
              return pageAdapter.showUnavailable(
                info,
                `LuoguSP：${archive.reason}，未自动发起收录。`
              );
            return pageAdapter.showFailure(
              info,
              archive.kind === "unknown" ? "收录请求已发送，但保存站未在超时前确认结果，请稍后刷新页面查看。" : archive.stage === "create" ? "向保存站发起收录请求失败。" : archive.reason || "保存站在限定时间内未能完成收录。"
            );
          }
          const prepared = await documentBuilder.prepare(
            info,
            archive.data,
            controller.signal
          );
          if (!current()) return;
          const replaced = pageLifecycle.replaceDocument(() => {
            documentCommitter.commit(prepared);
            rebuiltPath = info.path || "";
            return () => {
              if (typeof prepared.afterReady === "function")
                prepared.afterReady();
            };
          });
          if (!replaced)
            pageAdapter.showFailure(
              info,
              "原生页面提交失败，请刷新页面后重试。"
            );
        } catch (error) {
          if (!current() || isCancelled(error)) return;
          logError(error);
          pageAdapter.showFailure(
            info,
            error && error.userMessage ? error.userMessage : `原生页面装配失败：${error}`
          );
        } finally {
          if (activeController === controller) activeController = null;
        }
      })();
      return () => {
        if (currentTask === taskId) {
          taskId++;
          controller.abort();
          if (activeController === controller) activeController = null;
        }
        if (typeof documentBuilder.dispose === "function")
          documentBuilder.dispose();
        if (typeof pageAdapter.hideLoader === "function")
          pageAdapter.hideLoader();
      };
    };
    const onRoute = () => {
      if (rebuiltPath && pageAdapter.currentPath() !== rebuiltPath && pageAdapter.isRestrictedRoute(pageAdapter.currentPath()))
        pageAdapter.reload();
    };
    const dispose = () => {
      taskId++;
      if (activeController) activeController.abort();
      activeController = null;
      rebuiltPath = "";
      if (typeof documentBuilder.dispose === "function")
        documentBuilder.dispose();
      if (typeof pageAdapter.hideLoader === "function")
        pageAdapter.hideLoader();
    };
    const getState = () => Object.freeze({ taskId, rebuiltPath, running: !!activeController });
    return Object.freeze({ mount, onRoute, dispose, getState });
  }

  // src/features/restricted-content/document-committer.js
  function serializeJsonForScript2(value) {
    return JSON.stringify(value).replace(/</g, "\\u003C");
  }
  function createRestrictedDocumentCommitter(config) {
    const { documentAdapter, resourcePolicy } = config || {};
    if (!documentAdapter || typeof documentAdapter.open !== "function" || typeof documentAdapter.write !== "function" || typeof documentAdapter.close !== "function")
      throw new TypeError("Document Committer requires a document adapter");
    if (!resourcePolicy || typeof resourcePolicy.isAllowed !== "function")
      throw new TypeError("Document Committer requires a resource policy");
    const committed = /* @__PURE__ */ new WeakSet();
    const commit = (prepared) => {
      if (!prepared || typeof prepared !== "object" || typeof prepared.html !== "string" || !prepared.html.startsWith("<!DOCTYPE html>") || !prepared.html.includes('<div id="app"') || committed.has(prepared))
        throw Object.assign(new Error("受限文档提交数据无效"), {
          kind: "invariant"
        });
      const resourceTags = prepared.html.match(
        /<(?:script|link)\b[^>]*(?:src|href)\s*=[^>]+>/gi
      ) || [];
      const resources = resourceTags.map((tag) => {
        const match = tag.match(/(?:src|href)\s*=\s*(["'])([^"']+)\1/i);
        if (!match)
          throw Object.assign(new Error("受限文档资源地址格式无效"), {
            kind: "invariant"
          });
        return match[2];
      });
      if (!resources.every(resourcePolicy.isAllowed))
        throw Object.assign(new Error("受限文档包含未授权资源"), {
          kind: "invariant"
        });
      committed.add(prepared);
      try {
        if (typeof prepared.install === "function") prepared.install();
        documentAdapter.open();
        documentAdapter.write(prepared.html);
        documentAdapter.close();
      } catch (error) {
        if (typeof prepared.rollback === "function") prepared.rollback();
        throw error;
      }
    };
    return Object.freeze({ commit });
  }

  // src/features/restricted-content/page-detector.js
  function createRestrictedPageDetector(config) {
    const { path, title, target, urlPolicy } = config || {};
    if (typeof path !== "function" || typeof title !== "function" || typeof target !== "function" || !urlPolicy || typeof urlPolicy.originalUrl !== "function")
      throw new TypeError("Restricted Page Detector configuration is invalid");
    const detect = () => {
      const pathname = path();
      const match = pathname.match(
        /^\/(article|paste)\/([A-Za-z0-9]+)\/?$/
      );
      if (!match || !title().includes("安全访问中心")) return null;
      const originalAnchor = String(target() || "").trim();
      if (!new RegExp(`/${match[1]}/${match[2]}(?:[/?#]|$)`).test(
        originalAnchor
      ))
        return null;
      return Object.freeze({
        type: match[1],
        id: match[2],
        path: pathname,
        origUrl: urlPolicy.originalUrl(match[1], match[2])
      });
    };
    return Object.freeze({ detect });
  }

  // src/features/restricted-content/paste-scaffold.js
  function parseRestrictedPasteScaffold(scaffold) {
    if (typeof scaffold !== "string") return null;
    const match = (pattern) => {
      const result = scaffold.match(pattern);
      return result ? result[1] : null;
    };
    const encodedInjection = match(
      /_feInjection\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/
    );
    const configVersionLiteral = match(
      /window\._feConfigVersion\s*=\s*((?:["']\d+["'])|\d+)\s*;/
    );
    const tagVersionLiteral = match(
      /window\._tagVersion\s*=\s*((?:["']\d+["'])|\d+)\s*;/
    );
    const csrf = match(/<meta name="csrf-token" content="([^"]+)"/);
    const loaderCss = match(
      /<link rel="stylesheet" href="(https:\/\/fecdn\.luogu\.com\.cn\/[^"]+loader\.css[^"]*)"/
    );
    const loaderJs = match(
      /<script src="(https:\/\/fecdn\.luogu\.com\.cn\/[^"]+loader\.js[^"]*)"/
    );
    if (!encodedInjection || !configVersionLiteral || !tagVersionLiteral || !loaderJs || !loaderCss)
      return null;
    let injection;
    try {
      injection = JSON.parse(decodeURIComponent(encodedInjection)) || {};
    } catch (error) {
      return null;
    }
    return Object.freeze({
      injection,
      configVersionLiteral,
      tagVersionLiteral,
      csrf: csrf || "",
      loaderCss,
      loaderJs
    });
  }

  // src/features/restricted-content/reply-fetch-adapter.js
  function createRestrictedReplyFetchAdapter(config) {
    const {
      fetch: realFetch,
      origin,
      Response: ResponseCtor,
      URL: URLCtor,
      lid,
      replies
    } = config || {};
    if (typeof realFetch !== "function")
      throw new TypeError("Reply fetch adapter requires fetch");
    if (typeof ResponseCtor !== "function" || typeof URLCtor !== "function" || typeof origin !== "string" || typeof lid !== "string" || !/^[A-Za-z0-9]+$/.test(lid) || !Array.isArray(replies))
      throw new TypeError("Reply fetch adapter configuration is invalid");
    const repliesPath = `/article/${lid}/replies`;
    const wrappedFetch = function(input, init) {
      const rawUrl = typeof input === "string" || input instanceof URLCtor ? String(input) : input && input.url || "";
      const method = String(
        init && init.method || input && input.method || "GET"
      ).toUpperCase();
      let requestUrl = null;
      try {
        requestUrl = new URLCtor(rawUrl, origin);
      } catch (error) {
      }
      if (method !== "GET" || !requestUrl || requestUrl.origin !== origin || requestUrl.pathname !== repliesPath)
        return realFetch(input, init);
      let list = replies;
      const query = requestUrl.searchParams;
      if (query.get("sort") === "time-d")
        list = [...replies].sort((left, right) => right.time - left.time);
      const after = Number(query.get("after"));
      let start = 0;
      if (after) {
        const index = list.findIndex((reply) => reply.id === after);
        start = index >= 0 ? index + 1 : list.length;
      }
      list = list.slice(start, start + 20);
      return Promise.resolve(
        new ResponseCtor(JSON.stringify({ replySlice: list }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    };
    return Object.freeze({ fetch: wrappedFetch });
  }

  // src/features/restricted-content/reply-fetch-installer.js
  function createRestrictedReplyFetchInstaller(config) {
    const {
      host,
      origin,
      Response: ResponseCtor,
      URL: URLCtor,
      brand = /* @__PURE__ */ Symbol("LuoguSP restricted replies")
    } = config || {};
    if (!host || typeof host.fetch !== "function")
      throw new TypeError("Reply fetch installer requires a host fetch");
    let currentDispose = null;
    const dispose = () => {
      if (currentDispose) currentDispose();
      currentDispose = null;
    };
    const install = (lid, replies) => {
      const installed = host.fetch && host.fetch[brand];
      if (installed && typeof installed.dispose === "function")
        installed.dispose();
      dispose();
      const realFetch = host.fetch;
      const adapter = createRestrictedReplyFetchAdapter({
        fetch: (input, init) => realFetch.call(host, input, init),
        origin,
        Response: ResponseCtor,
        URL: URLCtor,
        lid,
        replies
      });
      const interceptingFetch = adapter.fetch;
      let active = true;
      const wrapped = function(input, init) {
        return active ? interceptingFetch(input, init) : realFetch.call(host, input, init);
      };
      const release = () => {
        active = false;
        if (host.fetch === wrapped) host.fetch = realFetch;
        if (currentDispose === release) currentDispose = null;
      };
      Object.defineProperty(wrapped, brand, {
        value: Object.freeze({ dispose: release })
      });
      host.fetch = wrapped;
      currentDispose = release;
      return release;
    };
    return Object.freeze({ install, dispose });
  }

  // src/features/restricted-content/url-policy.js
  function createRestrictedUrlPolicy() {
    const validate = (type, id) => (type === "article" || type === "paste") && typeof id === "string" && /^[A-Za-z0-9]+$/.test(id);
    return Object.freeze({
      originalUrl: (type, id) => {
        if (!validate(type, id))
          throw new TypeError("Restricted original URL target is invalid");
        return `https://www.luogu.com/${type}/${id}`;
      }
    });
  }

  // src/features/restricted-content/saver-protocol.js
  function createSaverProtocol() {
    const isSuccess = (payload) => !!(payload && typeof payload.code === "number" && payload.code >= 200 && payload.code < 300);
    const failureMessage = (payload, fallback) => {
      const code = payload && typeof payload.code === "number" ? ` ${payload.code}` : "";
      const message = payload && typeof payload.message === "string" && payload.message.trim() ? `：${payload.message.trim()}` : "";
      return `${fallback}${code}${message}`;
    };
    const classifyLookup = (payload) => {
      if (payload && payload.code === 200 && payload.data)
        return { kind: "archived", data: payload.data };
      if (payload && payload.code === 404) return { kind: "missing" };
      return {
        kind: "unavailable",
        reason: failureMessage(payload, "保存站查询失败"),
        retryable: false,
        category: "business"
      };
    };
    const classifyAction = (payload, fallback = "保存站拒绝请求") => isSuccess(payload) ? { kind: "accepted" } : {
      kind: "unavailable",
      reason: failureMessage(payload, fallback),
      retryable: true,
      category: "business"
    };
    return Object.freeze({
      isSuccess,
      failureMessage,
      classifyLookup,
      classifyAction
    });
  }

  // src/features/restricted-content/saver-transport.js
  function createSaverTransport(config) {
    const {
      baseUrl,
      fetch: fetchImpl,
      clock,
      timeoutMs = 15e3,
      createAbortController = () => new AbortController()
    } = config || {};
    if (typeof fetchImpl !== "function")
      throw new TypeError("Saver transport requires a fetch adapter");
    if (!clock || typeof clock.setTimeout !== "function" || typeof clock.clearTimeout !== "function")
      throw new TypeError("Saver transport requires a clock adapter");
    const fail = (kind, message, extra) => Object.assign(new Error(message), { kind, ...extra || {} });
    const request = async (path, init, options) => {
      const controller = createAbortController();
      const externalSignal = options && options.signal;
      let timedOut = false;
      const abortFromCaller = () => controller.abort();
      if (externalSignal && externalSignal.aborted)
        throw fail("cancelled", "保存站请求已取消");
      if (externalSignal)
        externalSignal.addEventListener("abort", abortFromCaller, {
          once: true
        });
      const timer = clock.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(baseUrl + path, {
          ...init || {},
          signal: controller.signal
        });
        if (!response.ok)
          throw fail("transport", `保存站 HTTP ${response.status}`, {
            status: response.status
          });
        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          throw fail("malformed-response", "保存站响应不是有效 JSON");
        }
        if (!payload || typeof payload.code !== "number")
          throw fail("malformed-response", "保存站响应格式无效");
        return payload;
      } catch (error) {
        if (error && error.name === "AbortError")
          throw timedOut ? fail("timeout", `保存站请求超时（${timeoutMs / 1e3}s）`) : fail("cancelled", "保存站请求已取消");
        if (error && error.kind) throw error;
        throw fail("transport", String(error && error.message || error));
      } finally {
        clock.clearTimeout(timer);
        if (externalSignal)
          externalSignal.removeEventListener("abort", abortFromCaller);
      }
    };
    return Object.freeze({
      get: (path, options) => request(path, null, options),
      post: (path, body, options) => request(
        path,
        {
          method: "POST",
          headers: body ? { "content-type": "application/json" } : void 0,
          body: body ? JSON.stringify(body) : void 0
        },
        options
      )
    });
  }

  // src/features/restricted-content/saver-workflow.js
  function createSaverWorkflow(config, policy) {
    const {
      transport,
      protocol = createSaverProtocol(),
      clock,
      createAbortController = () => new AbortController()
    } = config || {};
    const {
      pollAttempts = 15,
      pollIntervalMs = 3e3
    } = policy || {};
    if (!transport || typeof transport.get !== "function" || typeof transport.post !== "function")
      throw new TypeError("Saver Workflow requires a transport adapter");
    if (!clock || typeof clock.setTimeout !== "function" || typeof clock.clearTimeout !== "function")
      throw new TypeError("Saver Workflow requires a clock adapter");
    let disposed = false;
    const controllers = /* @__PURE__ */ new Set();
    const timers = /* @__PURE__ */ new Map();
    const unavailableFromError = (error) => ({
      kind: "unavailable",
      reason: String(error && error.message || error || "保存站暂时不可用"),
      retryable: !!(error && (error.kind === "transport" || error.kind === "timeout")),
      category: error && error.kind || "transport"
    });
    const unknownFromPost = (error) => ({
      kind: "unknown",
      reason: String(error && error.message || error || "请求结果未知"),
      retryable: false,
      category: error && error.kind || "transport"
    });
    const validateTarget = (type, id) => (type === "article" || type === "paste") && typeof id === "string" && /^[A-Za-z0-9]+$/.test(id);
    const invalidTarget = () => ({
      kind: "unavailable",
      reason: "保存站目标无效",
      retryable: false,
      category: "invariant"
    });
    const withTask = async (externalSignal, task) => {
      if (disposed)
        return {
          kind: "unavailable",
          reason: "保存工作流已取消",
          retryable: true,
          category: "cancelled"
        };
      const controller = createAbortController();
      const abort = () => controller.abort();
      if (externalSignal && externalSignal.aborted) abort();
      else if (externalSignal)
        externalSignal.addEventListener("abort", abort, { once: true });
      controllers.add(controller);
      try {
        return await task(controller.signal);
      } finally {
        controllers.delete(controller);
        if (externalSignal)
          externalSignal.removeEventListener("abort", abort);
      }
    };
    const pause = (ms, signal) => new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      const finish = (value) => {
        if (!timers.has(timer)) return;
        clock.clearTimeout(timer);
        timers.delete(timer);
        signal.removeEventListener("abort", cancel);
        resolve(value);
      };
      const cancel = () => finish(false);
      const timer = clock.setTimeout(() => finish(true), ms);
      timers.set(timer, cancel);
      signal.addEventListener("abort", cancel, { once: true });
    });
    const lookupRaw = async (type, id, signal) => {
      try {
        const payload = await transport.get(`/${type}/query/${id}`, { signal });
        return protocol.classifyLookup(payload);
      } catch (error) {
        return unavailableFromError(error);
      }
    };
    const postRaw = async (path, body, signal, fallback) => {
      try {
        const payload = await transport.post(path, body, { signal });
        return protocol.classifyAction(payload, fallback);
      } catch (error) {
        if (error && error.kind === "cancelled")
          return unavailableFromError(error);
        return unknownFromPost(error);
      }
    };
    const lookup = (type, id, options) => {
      if (!validateTarget(type, id)) return Promise.resolve(invalidTarget());
      return withTask(
        options && options.signal,
        (signal) => lookupRaw(type, id, signal)
      );
    };
    const ensureArchived = (type, id, options) => {
      if (!validateTarget(type, id)) return Promise.resolve(invalidTarget());
      return withTask(options && options.signal, async (signal) => {
        const initial = await lookupRaw(type, id, signal);
        if (initial.kind !== "missing")
          return initial.kind === "unavailable" ? { ...initial, stage: "lookup" } : initial;
        const created = await postRaw(
          `/workflow/create/template/${type}-save-pipeline`,
          { targetId: id },
          signal,
          "保存站拒绝收录请求"
        );
        if (created.kind !== "accepted") return { ...created, stage: "create" };
        if (options && typeof options.onAccepted === "function")
          options.onAccepted();
        for (let attempt = 0; attempt < pollAttempts; attempt++) {
          if (!await pause(pollIntervalMs, signal))
            return {
              ...unavailableFromError({
                kind: "cancelled",
                message: "保存工作流已取消"
              }),
              stage: "poll"
            };
          const result = await lookupRaw(type, id, signal);
          if (result.kind === "archived") return result;
          if (result.kind === "missing") continue;
          if (result.kind === "unavailable" && result.retryable && (result.category === "transport" || result.category === "timeout"))
            continue;
          return { ...result, stage: "poll" };
        }
        return {
          kind: "unavailable",
          reason: "保存站在限定时间内未能完成收录。",
          retryable: true,
          category: "timeout",
          stage: "poll"
        };
      });
    };
    const requestRefresh = (type, id, options) => {
      if (!validateTarget(type, id)) return Promise.resolve(invalidTarget());
      return withTask(
        options && options.signal,
        (signal) => postRaw(
          `/workflow/create/template/${type}-save-pipeline`,
          { targetId: id },
          signal,
          "保存站拒绝更新请求"
        )
      );
    };
    const loadComments = (id, options) => withTask(options && options.signal, async (signal) => {
      try {
        const payload = await transport.get(`/article/comments/${id}`, {
          signal
        });
        if (protocol.isSuccess(payload))
          return { kind: "available", data: payload.data || {} };
        return {
          ...protocol.classifyAction(payload, "评论存档读取失败"),
          kind: "unavailable"
        };
      } catch (error) {
        return unavailableFromError(error);
      }
    });
    const refreshComments = (id, options) => withTask(
      options && options.signal,
      (signal) => postRaw(
        `/article/comments/${id}/refresh`,
        null,
        signal,
        "评论刷新请求失败"
      )
    );
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      for (const [timer, cancel] of timers) {
        clock.clearTimeout(timer);
        cancel();
      }
      timers.clear();
    };
    return Object.freeze({
      lookup,
      ensureArchived,
      requestRefresh,
      loadComments,
      refreshComments,
      dispose
    });
  }

  // src/features/restricted-content/feature.js
  function createRestrictedContentFeature({
    storage,
    restrictedLoadingGate: restrictedLoadingGate2,
    getPageLifecycle
  }) {
    const SELECTORS = {
      restrictedUrlPre: "pre#url"
    };
    const SAVER_API = "https://api.luogu.me";
    const saverClock = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    const saverTransport = createSaverTransport({
      baseUrl: SAVER_API,
      fetch: (url, init) => fetch(url, init),
      clock: saverClock,
      timeoutMs: 15e3
    });
    const saverProtocol = createSaverProtocol();
    const saverWorkflow = createSaverWorkflow({
      transport: saverTransport,
      protocol: saverProtocol,
      clock: saverClock
    });
    const restrictedUrlPolicy = createRestrictedUrlPolicy();
    const restrictedPageDetector = createRestrictedPageDetector({
      path: () => location.pathname,
      title: () => document.title,
      target: () => {
        const pre = document.querySelector(SELECTORS.restrictedUrlPre);
        return pre ? (pre.textContent || "").trim() : "";
      },
      urlPolicy: restrictedUrlPolicy
    });
    const RST_LOADER_CSS = '.luogusp-rst-loader{position:fixed;inset:0;z-index:2147483000;background:#f5f5f5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#595959;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;}.luogusp-rst-spinner{width:36px;height:36px;border:3px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;animation:luogusp-rst-spin .8s linear infinite;}@keyframes luogusp-rst-spin{to{transform:rotate(360deg);}}@media (prefers-reduced-motion:reduce){.luogusp-rst-spinner{animation-duration:1.8s;}}';
    const RST_LOADER_CONTENT_HTML = '<div class="luogusp-rst-spinner" aria-hidden="true"></div><div class="msg">加载中…</div>';
    const RST_LOADER_HTML = `<div id="luogusp-rst-loader" class="luogusp-rst-loader" role="status" aria-live="polite">${RST_LOADER_CONTENT_HTML}</div>`;
    function injectRstStyle() {
      if (document.getElementById("luogusp-rst-style")) return;
      const style = document.createElement("style");
      style.id = "luogusp-rst-style";
      style.textContent = `${RST_LOADER_CSS}
      .luogusp-rst-plain{margin:0;background:#f5f5f5;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#404040;}
      .luogusp-rst-plain a{color:#3498db;text-decoration:none;}
      .luogusp-rst-plaincard{max-width:640px;margin:15vh auto 0;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(26,26,26,.1);padding:1.5em;}
      .luogusp-rst-note{color:#999;font-size:12px;text-align:center;margin:24px 0;}
    `;
      (document.head || document.documentElement).appendChild(style);
    }
    const RST_EXTRA_CSS = RST_LOADER_CSS + ".luogusp-rst-abtn{display:flex;flex-direction:column;align-items:center;margin:0 1em;cursor:pointer;}.luogusp-rst-abtn .icon{font-size:1.25em;margin-bottom:.3em;}.luogusp-rst-abtn .text{text-align:center;font-size:.75em;}.luogusp-rst-abtn>*{color:#3498db !important;}.luogusp-rst-pactions{display:flex;align-items:center;}.luogusp-rst-pbtn{font-size:.875em;line-height:1.5;padding:.3125em 1em;margin-left:.5em;color:#fff;background:#3498db;border:1px solid #3498db;border-radius:3px;cursor:pointer;}.luogusp-rst-pbtn:hover{background:rgba(52,152,219,.9);}.luogusp-rst-off{opacity:.55;cursor:not-allowed;pointer-events:none;}div.luogusp-rst-updtime{margin-left:1em;}";
    const RST_BTN_ICONS = {
      refresh: {
        vb: "0 0 512 512",
        d: "M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160 352 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l111.5 0c0 0 0 0 0 0l.4 0c17.7 0 32-14.3 32-32l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 35.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1L16 432c0 17.7 14.3 32 32 32s32-14.3 32-32l0-35.1 17.6 17.5c0 0 0 0 0 0c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-.1-.1L125.6 352l34.4 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L48.4 288c-1.6 0-3.2 .1-4.8 .3s-3.1 .5-4.6 1z"
      },
      external: {
        vb: "0 0 512 512",
        d: "M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l82.7 0L201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3l0 82.7c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160c0-17.7-14.3-32-32-32L320 0zM80 32C35.8 32 0 67.8 0 112L0 432c0 44.2 35.8 80 80 80l320 0c44.2 0 80-35.8 80-80l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 112c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-320c0-8.8 7.2-16 16-16l112 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 32z"
      }
    };
    function rstAvatar(uid) {
      return `https://cdn.luogu.com.cn/upload/usericon/${uid}.png`;
    }
    function rstFmtTime(iso, withSec) {
      const ms = Date.parse(iso || "");
      if (!ms) return null;
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, "0");
      const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      return withSec ? `${base}:${p(d.getSeconds())}` : base;
    }
    const rstUserCache = /* @__PURE__ */ new Map();
    async function rstFetch(input, signal) {
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      if (signal && signal.aborted)
        throw Object.assign(new Error("受限文档准备已取消"), {
          kind: "cancelled"
        });
      if (signal) signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15e3);
      try {
        return await fetch(input, { signal: controller.signal });
      } catch (error) {
        if (error && error.name === "AbortError")
          throw Object.assign(
            new Error(timedOut ? "洛谷页面数据请求超时" : "受限文档准备已取消"),
            { kind: timedOut ? "timeout" : "cancelled" }
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
          signal
        );
        const json = await res.json();
        const list = json && json.users || [];
        user = list.find((u) => u && Number(u.uid) === Number(uid)) || null;
      } catch (e) {
        if (e && e.kind === "cancelled") throw e;
      }
      rstUserCache.set(uid, user);
      return user;
    }
    function rstUserSummary(cnUser, snapshot, uid) {
      if (cnUser) return cnUser;
      const s = snapshot || {};
      return {
        uid: Number(uid) || 0,
        avatar: rstAvatar(uid || 0),
        name: s.name || `用户 ${uid || "?"}`,
        slogan: "",
        badge: s.badge || null,
        isAdmin: false,
        isBanned: false,
        color: s.color || "Gray",
        ccfLevel: s.ccfLevel || 0,
        xcpcLevel: s.xcpcLevel || 0,
        background: ""
      };
    }
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
      if (restrictedLoadingGate2) restrictedLoadingGate2.release();
    }
    function rstHideLoader() {
      const el = document.getElementById("luogusp-rst-loader");
      if (el) el.remove();
      if (restrictedLoadingGate2) restrictedLoadingGate2.release();
    }
    function rstShowUnavailableTip(info, message) {
      rstBuildFailure(info, message);
    }
    function rstBuildFailure(info, reason) {
      rstHideLoader();
      document.title = (info.type === "article" ? "文章" : "云剪贴板") + " - 洛谷";
      document.body.className = "luogusp-rst-plain";
      document.body.innerHTML = `
      <div class="luogusp-rst-plaincard"><h1 style="font-size:20px;margin:0 0 10px;">未能获取内容</h1>
      <p></p>
      <p>可能原因：内容未公开、未通过审核，或保存站暂时不可用。</p>
      <p><a class="luogusp-rst-original" rel="noopener noreferrer">前往国际站查看原文 →</a></p>
      <p class="luogusp-rst-note">此页面由 LuoguSP 生成 · 数据来源：洛谷保存站</p></div>`;
      document.querySelector(".luogusp-rst-plaincard p").textContent = String(reason);
      document.querySelector(".luogusp-rst-original").href = info.origUrl;
    }
    async function rstHarvest(kind, signal) {
      const sources = kind === "columba" ? ["/ranking", "/discuss"] : ["/image", "/theme/list"];
      const marker = kind === "columba" ? "lentille-context" : "_feInjection";
      for (const src of sources) {
        try {
          const res = await rstFetch(src, signal);
          const html = await res.text();
          if (html.includes(marker)) return html;
        } catch (e) {
          if (e && e.kind === "cancelled") throw e;
        }
      }
      return null;
    }
    const rstPreparationError = (message) => Object.assign(new Error(message), {
      kind: "dom-drift",
      userMessage: message
    });
    function rstTrustedCdnUrl(value) {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.origin === "https://fecdn.luogu.com.cn";
      } catch (error) {
        return false;
      }
    }
    const rstSafeCsrf = (value) => typeof value === "string" && !/["'<>\s]/.test(value);
    const rstEscapeHtmlText = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const rstReplyFetchInstaller = typeof window === "undefined" ? null : createRestrictedReplyFetchInstaller({
      host: window,
      origin: location.origin,
      Response,
      URL
    });
    const rstDisposeReplyStub = () => {
      if (rstReplyFetchInstaller) rstReplyFetchInstaller.dispose();
    };
    function rstStubReplies(lid, comments) {
      const mapped = comments.map((c, i) => {
        const a = c.author || {};
        return {
          id: i + 1,
          author: rstUserSummary(null, a, a.id),
          time: Number(c.time) || 0,
          content: String(c.content || "")
        };
      });
      return rstReplyFetchInstaller ? rstReplyFetchInstaller.install(lid, mapped) : () => {
      };
    }
    async function rstBootArticle(info, data, signal) {
      const [scaffold, cnUser, commentsResult] = await Promise.all([
        rstHarvest("columba", signal),
        rstCnUser(data.authorId, signal),
        saverWorkflow.loadComments(info.id, { signal })
      ]);
      if (!scaffold)
        throw rstPreparationError("无法获取洛谷页面骨架，暂不能就地渲染。");
      const pick = (re) => {
        const m = scaffold.match(re);
        return m ? m[1] : null;
      };
      const ctxRaw = pick(
        /<script id="lentille-context" type="application\/json">([\s\S]*?)<\/script>/
      );
      const themeRaw = pick(
        /<script id="luogu-theme" type="application\/json">([\s\S]*?)<\/script>/
      ) || "";
      const csrf = pick(/<meta name="csrf-token" content="([^"]+)"/) || "";
      const globalsRaw = pick(/<script>\s*(window\.__feInitLocalTime[\s\S]*?)<\/script>/) || "";
      const scripts = [
        ...scaffold.matchAll(
          /<script src="(https:\/\/fecdn\.luogu\.com\.cn\/[^"]+)"[^>]*><\/script>/g
        )
      ].map((m) => m[1]);
      const cssLinks = [
        ...scaffold.matchAll(
          /<link rel="stylesheet" href="(https:\/\/fecdn\.luogu\.com\.cn\/[^"]+)"/g
        )
      ].map((m) => m[1]);
      if (!ctxRaw || !scripts.length || !scripts.every(rstTrustedCdnUrl) || !cssLinks.every(rstTrustedCdnUrl) || !rstSafeCsrf(csrf) || /<\/script/i.test(globalsRaw))
        throw rstPreparationError("洛谷页面骨架解析失败（结构可能已改版）。");
      let safeThemeRaw = "";
      if (themeRaw) {
        try {
          safeThemeRaw = serializeJsonForScript(JSON.parse(themeRaw));
        } catch (error) {
          throw rstPreparationError("洛谷主题数据解析失败（结构可能已改版）。");
        }
      }
      let viewer = null;
      try {
        viewer = JSON.parse(ctxRaw).user || null;
      } catch (e) {
      }
      const comments = commentsResult.kind === "available" && Array.isArray(commentsResult.data.comments) ? commentsResult.data.comments : [];
      const ctx = {
        instance: "main",
        template: "article.show",
        status: 200,
        locale: "zh-CN",
        data: {
          article: {
            lid: data.id,
            title: data.title || "",
            category: data.category != null ? data.category : 1,
            // ★保存站只有入档时间（无原文发布时间接口），此处为已知近似
            time: Math.floor(new Date(data.createdAt).getTime() / 1e3) || 0,
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
            adminNote: null
          },
          favored: false,
          voted: null,
          canReply: !!viewer,
          canEdit: false
        },
        user: viewer,
        time: Math.floor(Date.now() / 1e3)
      };
      const title = rstEscapeHtmlText(data.title || "文章");
      const html = `<!DOCTYPE html><html lang="zh-CN" class="no-js"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><meta name="csrf-token" content="${csrf}"><title>${title} - 洛谷专栏</title><link rel="icon" href="https://fecdn.luogu.com.cn/favicon.ico"><script>${globalsRaw}<\/script><script id="lentille-context" type="application/json">${serializeJsonForScript(ctx)}<\/script>` + scripts.map((s) => `<script src="${s}" charset="utf-8" defer><\/script>`).join("") + cssLinks.map((c) => `<link rel="stylesheet" href="${c}" />`).join("") + `<script id="luogu-theme" type="application/json">${safeThemeRaw}<\/script><style>${RST_EXTRA_CSS}</style></head><body><div id="app"></div>${RST_LOADER_HTML}</body></html>`;
      return {
        kind: "article",
        html,
        install: () => rstStubReplies(info.id, comments),
        rollback: rstDisposeReplyStub,
        afterReady: () => rstMountArticleButtons(info, data)
      };
    }
    async function rstBootPaste(info, data, signal) {
      const [scaffold, cnUser] = await Promise.all([
        rstHarvest("lfe", signal),
        rstCnUser(data.authorId, signal)
      ]);
      if (!scaffold)
        throw rstPreparationError("无法获取洛谷页面骨架，暂不能就地渲染。");
      const parsed = parseRestrictedPasteScaffold(scaffold);
      if (!parsed || !rstTrustedCdnUrl(parsed.loaderJs) || !rstTrustedCdnUrl(parsed.loaderCss) || !rstSafeCsrf(parsed.csrf))
        throw rstPreparationError("洛谷页面骨架解析失败（结构可能已改版）。");
      const scafInj = parsed.injection;
      const inj = {
        code: 200,
        currentTemplate: "PasteShow",
        currentData: {
          paste: {
            id: data.id,
            user: rstUserSummary(cnUser, data.author, data.authorId),
            // ★保存站只有入档时间（无原文发布时间接口），此处为已知近似
            time: Math.floor(new Date(data.createdAt).getTime() / 1e3) || 0,
            public: true,
            data: String(data.content || "")
          },
          canEdit: false
        },
        currentTitle: "云剪贴板",
        currentTheme: scafInj.currentTheme || null,
        currentUser: scafInj.currentUser || null,
        currentTime: Math.floor(Date.now() / 1e3)
      };
      const html = `<!DOCTYPE html><html class="no-js" lang="zh"><head><meta charset="utf-8"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><meta name="csrf-token" content="${parsed.csrf}"><meta name="renderer" content="webkit"><title>云剪贴板 - 洛谷 | 计算机科学教育新生态</title><link rel="shortcut icon" type="image/x-icon" href="https://fecdn.luogu.com.cn/favicon.ico" media="screen"/><link rel="stylesheet" href="${parsed.loaderCss}"><style>${RST_EXTRA_CSS}</style><script>window._feInjection = JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(inj))}"));window._feConfigVersion=${parsed.configVersionLiteral};window._tagVersion=${parsed.tagVersionLiteral};<\/script><script src="${parsed.loaderJs}" charset="utf-8" defer><\/script></head><body><div id="app"><noscript><h3>请<b style="color:#f00;">不要禁用</b>脚本，否则网页无法正常加载</h3></noscript></div>${RST_LOADER_HTML}</body></html>`;
      return {
        kind: "paste",
        html,
        afterReady: () => rstMountPasteButtons(info, data)
      };
    }
    const rstInjectionDisposers = /* @__PURE__ */ new Set();
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
      run();
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
    function rstMountArticleButtons(info, data) {
      const updText = rstFmtTime(data && data.updatedAt, true);
      const make = (icon, extraCls, text, onClick) => {
        const div = document.createElement("div");
        div.className = `button-2line luogusp-rst-abtn ${extraCls}`;
        div.innerHTML = `<svg class="svg-inline--fa icon" style="font-size:1.25em" viewBox="${icon.vb}" aria-hidden="true"><path fill="currentColor" d="${icon.d}"/></svg><span class="text">${text}</span>`;
        div.addEventListener("click", onClick);
        return div;
      };
      const inject = () => {
        const actionBars = [
          ...document.querySelectorAll(".article-content .actions")
        ].filter((bar) => !bar.classList.contains("left-mode"));
        actionBars.forEach((bar) => {
          if (bar.querySelector(".luogusp-rst-abtn")) return;
          bar.appendChild(
            make(
              RST_BTN_ICONS.refresh,
              "luogusp-rst-btn-refresh",
              "申请更新",
              () => rstManualRefresh(info)
            )
          );
          bar.appendChild(
            make(
              RST_BTN_ICONS.external,
              "",
              "国际站原文",
              () => window.open(info.origUrl, "_blank", "noopener")
            )
          );
        });
        const updateBars = [
          ...document.querySelectorAll(".article-content .update-info")
        ];
        updateBars.forEach((bar) => {
          bar.removeAttribute("title");
          bar.querySelectorAll("[title]").forEach((n) => n.removeAttribute("title"));
        });
        if (updText)
          updateBars.forEach((bar) => {
            if (bar.querySelector(".luogusp-rst-updtime")) return;
            const ref = [...bar.querySelectorAll("span")].find(
              (s) => /创建时间/.test(s.textContent || "")
            );
            const span = document.createElement("span");
            if (ref) {
              for (const at of ref.attributes)
                if (at.name.startsWith("data-v-"))
                  span.setAttribute(at.name, at.value);
            }
            span.classList.add("luogusp-rst-updtime");
            span.textContent = `更新时间：${updText}`;
            const sep = document.createTextNode("    ");
            if (ref) ref.after(sep, span);
            else bar.append(sep, span);
          });
        rstApplyRefreshBtns();
        if (actionBars.length && updateBars.length) rstHideLoader();
      };
      return rstObserveInjection(inject);
    }
    function rstMountPasteButtons(info, data) {
      const updText = rstFmtTime(data && data.updatedAt, false);
      const inject = () => {
        const top = document.querySelector(".card .content-card-top");
        if (!top) return;
        if (!top.querySelector(".luogusp-rst-pactions")) {
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
            mk(
              "luogusp-rst-btn-refresh",
              "申请更新",
              () => rstManualRefresh(info)
            ),
            mk(
              "",
              "国际站原文",
              () => window.open(info.origUrl, "_blank", "noopener")
            )
          );
          top.appendChild(box);
        }
        const author = top.querySelector(".author");
        const pubRow = author ? [...author.querySelectorAll("div.lfe-caption")].find(
          (d) => /发表时间/.test(d.textContent || "")
        ) : null;
        if (pubRow) {
          pubRow.removeAttribute("title");
          pubRow.querySelectorAll("[title]").forEach((n) => n.removeAttribute("title"));
        }
        if (updText && pubRow && !author.querySelector(".luogusp-rst-updtime")) {
          const row = pubRow.cloneNode(false);
          row.classList.add("luogusp-rst-updtime");
          const span = document.createElement("span");
          span.textContent = `更新时间: ${updText}`;
          row.appendChild(span);
          pubRow.after(row);
        }
        rstApplyRefreshBtns();
        if (author && pubRow) rstHideLoader();
      };
      return rstObserveInjection(inject);
    }
    let rstRefreshState = "idle";
    let rstRefreshText = "申请更新";
    let rstRefreshResetTimer = null;
    let rstRefreshController = null;
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
      }, 3e3);
    }
    async function rstManualRefresh(info) {
      if (rstRefreshState !== "idle") return;
      const controller = new AbortController();
      rstRefreshController = controller;
      const current = () => rstRefreshController === controller && !controller.signal.aborted;
      let commentsPending = false;
      rstSetRefresh("busy", "更新中…");
      try {
        const result = await saverWorkflow.requestRefresh(info.type, info.id, {
          signal: controller.signal
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
          void saverWorkflow.refreshComments(info.id, { signal: controller.signal }).then(finishComments, finishComments);
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
            kind: "cancelled"
          });
        const prepared = info.type === "article" ? await rstBootArticle(info, data, signal) : await rstBootPaste(info, data, signal);
        if (signal.aborted)
          throw Object.assign(new Error("受限文档准备已取消"), {
            kind: "cancelled"
          });
        return prepared;
      },
      dispose: () => {
        if (rstRefreshController) rstRefreshController.abort();
        rstRefreshController = null;
        rstDisposeReplyStub();
        for (const dispose of [...rstInjectionDisposers]) dispose();
        if (rstRefreshResetTimer !== null) {
          clearTimeout(rstRefreshResetTimer);
          rstRefreshResetTimer = null;
        }
        rstRefreshState = "idle";
        rstRefreshText = "申请更新";
        document.querySelectorAll(
          ".luogusp-rst-abtn,.luogusp-rst-pactions,.luogusp-rst-updtime"
        ).forEach((node) => node.remove());
      }
    };
    const restrictedDocumentCommitter = createRestrictedDocumentCommitter({
      documentAdapter: {
        open: () => document.open(),
        write: (html) => document.write(html),
        close: () => document.close()
      },
      resourcePolicy: { isAllowed: rstTrustedCdnUrl }
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
          isRestrictedRoute: (path) => /^\/(article|paste)\/[A-Za-z0-9]+\/?$/.test(path),
          reload: () => location.reload()
        },
        saverWorkflow,
        documentBuilder: restrictedDocumentBuilder,
        documentCommitter: restrictedDocumentCommitter,
        pageLifecycle,
        logError: (error) => console.error("LuoguSP restricted boot:", error)
      });
      return restrictedDocumentBoot;
    };
    return defineConfigurableFeature({
      id: "restricted-document",
      key: "showRestrictedContent",
      label: "显示受限文章与剪贴板",
      storage,
      mount: (context) => ensureDocumentBoot().mount(context),
      onRoute: () => {
        if (restrictedLoadingGate2) restrictedLoadingGate2.start();
        ensureDocumentBoot().onRoute();
      }
    });
  }

  // src/features/settings/style.js
  var SETTINGS_STYLE = `
  #luogusp-settings{position:fixed;inset:0;z-index:100000;font-size:14px;color:#222;}
  #luogusp-settings .luogusp-mask{position:absolute;inset:0;background:rgba(0,0,0,.35);}
  #luogusp-settings .luogusp-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#fff;border-radius:8px;padding:24px 30px;min-width:300px;box-shadow:0 8px 30px rgba(0,0,0,.2);}
  #luogusp-settings .luogusp-content{width:max-content;max-width:min(420px,calc(100vw - 88px));margin:0 auto;}
  #luogusp-settings h3{margin:0 0 12px;font-size:16px;}
  #luogusp-settings .luogusp-item{display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;}
  #luogusp-settings .luogusp-actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;}
  #luogusp-settings button{padding:5px 14px;border:1px solid #ccc;border-radius:5px;background:#f7f7f7;cursor:pointer;}
  #luogusp-settings button:not(.luogusp-primary):hover{background:#efefef;}
  #luogusp-settings .luogusp-primary{background:#0e88d3;border-color:#0e88d3;color:#fff;}
  #luogusp-settings .luogusp-primary:hover{background:#0879bd;border-color:#0879bd;color:#fff;}
  #luogusp-settings .luogusp-primary:active{background:#066ca9;border-color:#066ca9;color:#fff;}
  #luogusp-settings .luogusp-hint{margin:10px 0 0;color:#888;font-size:12px;}
  .luogusp-setting-entry{cursor:pointer;}
`;

  // src/features/settings/feature.js
  function createSettingsFeature({ storage, configurableFeatures }) {
    const SELECTORS = {
      navContainers: ["nav.lfe-body", "nav.sidebar"],
      navText: ".text, .title"
    };
    const featureLabels = new Map(
      configurableFeatures.map((feature) => [
        feature.storageKey,
        feature.label
      ])
    );
    function injectStyle() {
      if (document.getElementById("luogusp-style")) return;
      const style = document.createElement("style");
      style.id = "luogusp-style";
      style.textContent = SETTINGS_STYLE;
      (document.head || document.documentElement).appendChild(style);
    }
    let closeSettingsOverlay = null;
    function openSettings() {
      if (document.getElementById("luogusp-settings")) return;
      const overlay = document.createElement("div");
      overlay.id = "luogusp-settings";
      overlay.innerHTML = `
      <div class="luogusp-mask"></div>
      <div class="luogusp-panel" role="dialog" aria-modal="true">
        <div class="luogusp-content">
          <h3>LuoguSP 功能设置</h3>
          <div class="luogusp-list">
            ${[...featureLabels].map(
        ([key, label]) => `
              <label class="luogusp-item">
                <input type="checkbox" data-key="${key}" ${storage.get(key) ? "checked" : ""}>
                <span>${label}</span>
              </label>`
      ).join("")}
          </div>
          <div class="luogusp-actions">
            <button data-act="all">全选</button>
            <button data-act="none">全不选</button>
            <button data-act="save" class="luogusp-primary">保存</button>
            <button data-act="close">关闭</button>
          </div>
          <p class="luogusp-hint">保存后需刷新页面生效。</p>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const boxes = () => overlay.querySelectorAll('input[type="checkbox"]');
      let closed = false;
      function esc(e) {
        if (e.key === "Escape") close();
      }
      const close = () => {
        if (closed) return;
        closed = true;
        overlay.remove();
        document.removeEventListener("keydown", esc);
        if (closeSettingsOverlay === close) closeSettingsOverlay = null;
      };
      closeSettingsOverlay = close;
      overlay.addEventListener("click", (e) => {
        const t = e.target;
        if (t.classList.contains("luogusp-mask")) return close();
        const act = t.getAttribute && t.getAttribute("data-act");
        if (act === "close") return close();
        if (act === "all") boxes().forEach((b) => b.checked = true);
        if (act === "none") boxes().forEach((b) => b.checked = false);
        if (act === "save") {
          boxes().forEach((b) => storage.set(b.dataset.key, b.checked));
          close();
          if (confirm("设置已保存，是否立即刷新页面生效？")) location.reload();
        }
      });
      document.addEventListener("keydown", esc);
    }
    const GEAR_PATH = "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";
    function gearInto(svg) {
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "currentColor");
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", GEAR_PATH);
      svg.appendChild(path);
      return svg;
    }
    function newGear(templateIcon) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      if (templateIcon && templateIcon.getAttribute("class")) {
        svg.setAttribute("class", templateIcon.getAttribute("class"));
      } else {
        svg.style.width = "1.1em";
        svg.style.height = "1.1em";
        svg.style.marginRight = ".4em";
        svg.style.verticalAlign = "middle";
      }
      return gearInto(svg);
    }
    const navTextSpan = (a) => a.querySelector(SELECTORS.navText);
    function addSettingButton() {
      let nav = null, navSel = null;
      for (const sel of SELECTORS.navContainers) {
        const n = document.querySelector(sel);
        if (n) {
          nav = n;
          navSel = sel;
          break;
        }
      }
      if (!nav) return;
      if (nav.querySelector(".luogusp-setting-entry")) return;
      const cands = [...nav.querySelectorAll("a")].filter(
        (a) => a.querySelector("svg, img, .icon") && navTextSpan(a)
      );
      if (!cands.length) return;
      const template = cands[cands.length - 1];
      const li = template.closest("li");
      const unit = li && nav.contains(li) ? li : template;
      const clone = unit.cloneNode(true);
      const link = clone.matches("a") ? clone : clone.querySelector("a");
      if (!link) return;
      link.removeAttribute("href");
      link.removeAttribute("id");
      link.classList.remove(
        "router-link-active",
        "router-link-exact-active",
        "active"
      );
      link.classList.add("luogusp-setting-entry");
      link.setAttribute("role", "button");
      const textEl = navTextSpan(link);
      if (textEl) {
        if (navSel === "nav.lfe-body") {
          textEl.textContent = "";
          textEl.append("插件", document.createElement("br"), "设置");
        } else {
          textEl.textContent = "插件设置";
        }
      }
      const svg = link.querySelector("svg");
      if (svg) gearInto(svg);
      else {
        const other = link.querySelector("img, i");
        if (other) other.replaceWith(newGear(other));
      }
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettings();
      });
      unit.parentNode.insertBefore(clone, unit.nextSibling);
    }
    function watchSettingButton() {
      let frame = null;
      const tick = () => {
        frame = null;
        try {
          addSettingButton();
        } catch (e) {
          console.error("LuoguSP setting entry:", e);
        }
      };
      const observer = new MutationObserver(() => {
        if (frame === null) frame = requestAnimationFrame(tick);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      addSettingButton();
      return () => {
        observer.disconnect();
        if (frame !== null) cancelAnimationFrame(frame);
        document.querySelectorAll(".luogusp-setting-entry").forEach((entry) => (entry.closest("li") || entry).remove());
        if (closeSettingsOverlay) closeSettingsOverlay();
      };
    }
    return Object.freeze({
      id: "settings",
      mount: () => {
        injectStyle();
        return watchSettingButton();
      }
    });
  }

  // src/app/create-luogusp-app.js
  function createBrowserStorage() {
    return Object.freeze({
      get: (key) => localStorage.getItem(key) === "true",
      set: (key, value) => localStorage.setItem(key, String(value)),
      has: (key) => localStorage.getItem(key) !== null
    });
  }
  function createDefaultRouteAdapter() {
    if (typeof window === "undefined")
      return Object.freeze({
        token: () => "",
        subscribe: () => () => {
        }
      });
    return createBrowserRouteAdapter({
      history,
      eventTarget: window,
      token: () => `${location.pathname}${location.search}${location.hash}`,
      logError: (error) => console.error("LuoguSP route:", error)
    });
  }
  function createDocumentAdapter() {
    return Object.freeze({
      schedule: (callback) => {
        const frame = requestAnimationFrame(callback);
        return () => cancelAnimationFrame(frame);
      },
      whenReady: (callback) => {
        if (document.body) return callback();
        let active = true;
        const ready = () => {
          if (active) callback();
        };
        document.addEventListener("DOMContentLoaded", ready, {
          once: true
        });
        return () => {
          active = false;
          document.removeEventListener("DOMContentLoaded", ready);
        };
      }
    });
  }
  function createLuoguSPApp(options = {}) {
    const storage = options.storageAdapter || createBrowserStorage();
    const routeAdapter = options.routeAdapter || createDefaultRouteAdapter();
    const restrictedLoadingGate2 = options.restrictedLoadingGate || null;
    let pageLifecycle = null;
    const problemColorFeature = createProblemColorFeature({ storage });
    const chatShortcutFeature = createChatShortcutFeature({ storage });
    const hiddenIntroFeature = createHiddenIntroFeature({ storage });
    const ideBatchFeature = createIdeBatchFeature({
      storage,
      idePreparationAdapter: options.idePreparationAdapter
    });
    const restrictedContentFeature = createRestrictedContentFeature({
      storage,
      restrictedLoadingGate: restrictedLoadingGate2,
      getPageLifecycle: () => pageLifecycle
    });
    const configurableFeatures = Object.freeze([
      problemColorFeature,
      chatShortcutFeature,
      hiddenIntroFeature,
      ideBatchFeature,
      restrictedContentFeature
    ]);
    const settingsFeature = createSettingsFeature({
      storage,
      configurableFeatures
    });
    pageLifecycle = createPageLifecycle({
      routeAdapter,
      documentAdapter: createDocumentAdapter(),
      storage,
      logError: (id, error) => console.error(`LuoguSP lifecycle ${id}:`, error)
    });
    pageLifecycle.register(settingsFeature);
    configurableFeatures.forEach(
      (feature) => pageLifecycle.register(feature)
    );
    const initializeFeatureDefaults = () => {
      for (const feature of configurableFeatures) {
        if (!storage.has(feature.storageKey))
          storage.set(feature.storageKey, feature.defaultEnabled);
      }
    };
    let bootstrapped = false;
    const bootstrapAdapter = options.bootstrapAdapter || Object.freeze({
      initialize: initializeFeatureDefaults,
      start: () => pageLifecycle.start()
    });
    const bootstrapBrowser = () => {
      if (bootstrapped) return;
      bootstrapped = true;
      bootstrapAdapter.initialize();
      bootstrapAdapter.start();
    };
    const app = { bootstrapBrowser };
    if (options.exposeTestInterface) {
      app.test = Object.freeze({
        startIdeBatch: ideBatchFeature.start,
        ideState: ideBatchFeature.getState
      });
    }
    return Object.freeze(app);
  }

  // src/features/restricted-content/loading-gate.js
  function createRestrictedLoadingGate(config) {
    const { pageAdapter, overlayAdapter } = config || {};
    if (!pageAdapter || typeof pageAdapter.currentPath !== "function" || typeof pageAdapter.isEnabled !== "function" || typeof pageAdapter.isCandidateRoute !== "function" || !overlayAdapter || typeof overlayAdapter.mount !== "function")
      throw new TypeError("Restricted Loading Gate configuration is invalid");
    let active = false;
    let releaseOverlay = null;
    const start = () => {
      if (active) return true;
      if (!pageAdapter.isEnabled() || !pageAdapter.isCandidateRoute(pageAdapter.currentPath()))
        return false;
      const release2 = overlayAdapter.mount();
      releaseOverlay = typeof release2 === "function" ? release2 : null;
      active = true;
      return true;
    };
    const release = () => {
      if (!active) return;
      active = false;
      const dispose = releaseOverlay;
      releaseOverlay = null;
      if (dispose) dispose();
    };
    const getState = () => Object.freeze({ active });
    return Object.freeze({ start, release, getState });
  }

  // src/entry.js
  var restrictedLoadingGate = createRestrictedLoadingGate({
    pageAdapter: {
      currentPath: () => location.pathname,
      isEnabled: () => {
        try {
          const value = localStorage.getItem(
            "LuoguSP.showRestrictedContent"
          );
          return value === null || value === "true";
        } catch (error) {
          return false;
        }
      },
      isCandidateRoute: (path) => /^\/(article|paste)\/[A-Za-z0-9]+\/?$/.test(path)
    },
    overlayAdapter: {
      mount: () => {
        const className = "luogusp-rst-preparing";
        const styleId = "luogusp-rst-early-style";
        let observer = null;
        let mountedRoot = null;
        let previousBusy = null;
        const attach = () => {
          const root = document.documentElement;
          if (!root) return false;
          mountedRoot = root;
          previousBusy = root.getAttribute("aria-busy");
          root.setAttribute("aria-busy", "true");
          root.classList.add(className);
          if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
            html.${className},html.${className} body{overflow:hidden!important;background:#f5f5f5!important;}
            html.${className} body>*{visibility:hidden!important;}
            html.${className}::before{content:"";position:fixed;left:50%;top:50%;z-index:2147483646;width:36px;height:36px;margin:-31px 0 0 -21px;border:3px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;animation:luogusp-rst-early-spin .8s linear infinite;}
            html.${className}::after{content:"加载中…";position:fixed;left:0;right:0;top:calc(50% + 17px);z-index:2147483646;color:#595959;text-align:center;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;}
            @keyframes luogusp-rst-early-spin{to{transform:rotate(360deg);}}
            @media (prefers-reduced-motion:reduce){html.${className}::before{animation-duration:1.8s;}}
          `;
            (document.head || root).appendChild(style);
          }
          return true;
        };
        if (!attach()) {
          observer = new MutationObserver(() => {
            if (!attach()) return;
            observer.disconnect();
            observer = null;
          });
          observer.observe(document, { childList: true, subtree: true });
        }
        return () => {
          if (observer) observer.disconnect();
          observer = null;
          const root = mountedRoot || document.documentElement;
          if (root) {
            root.classList.remove(className);
            if (previousBusy === null) root.removeAttribute("aria-busy");
            else root.setAttribute("aria-busy", previousBusy);
          }
          const style = document.getElementById(styleId);
          if (style) style.remove();
        };
      }
    }
  });
  try {
    restrictedLoadingGate.start();
  } catch (error) {
    console.error("LuoguSP restricted early loader:", error);
  }
  var bootstrap = () => {
    try {
      createLuoguSPApp({ restrictedLoadingGate }).bootstrapBrowser();
    } catch (error) {
      restrictedLoadingGate.release();
      throw error;
    }
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  else bootstrap();
})();
