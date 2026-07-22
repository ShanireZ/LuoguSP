// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.10.0
// @description  LuoguSP：题目难度着色 / 私信 Ctrl+Click(用户名+头像) 跳转主页 / 显示隐藏的个人简介 / IDE 一键测试样例 / 受限文章剪贴板就地显示
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
// @run-at       document-end
// ==/UserScript==

"use strict";
(function () {
  // ============================================================
  // 配置区（日常维护改这里）
  // ============================================================

  const APP_NAME = "LuoguSP";
  const STORAGE_PREFIX = `${APP_NAME}.`;

  // 洛谷难度 → 颜色；下标 = practice/problem 接口返回的 difficulty 整数 (0..8)
  // 2026-07 洛谷把旧 8 档改为新 9 档：在「普及+/提高-」后插入「提高」，NOI 档色号微调。
  // 维护：色号有变时，对照 luogu.com.cn 难度统计页逐行改 hex 即可，无需动别处。
  const DIFFICULTY_COLORS = [
    "#bfbfbf", // 0 暂无评定
    "#fe4c61", // 1 入门
    "#f39c11", // 2 普及-
    "#ffc116", // 3 普及
    "#52c41a", // 4 普及+/提高-
    "#14b8a6", // 5 提高          ← 2026-07 新增
    "#3498db", // 6 提高+/省选-
    "#9d3dcf", // 7 省选/NOI-
    "#0f172a", // 8 NOI/NOI+/CTSC
  ];
  const FALLBACK_COLOR = "#bfbfbf";
  const diffColor = (d) => DIFFICULTY_COLORS[d] || FALLBACK_COLOR; // 未知档兜底成灰，不再越界崩溃

  // 依赖洛谷 DOM 的易变选择器（data-v-* 哈希会随洛谷构建变化）：改版排查时优先来这里改。
  const SELECTORS = {
    // 洛谷有两套导航：首页竖排 nav.lfe-body（条目用 .text）/ 内容页左侧栏 nav.sidebar（条目用 .title）
    navContainers: ["nav.lfe-body", "nav.sidebar"], // 设置入口挂载点（按序取第一个存在的）
    navText: ".text, .title", // 导航条目里的文字 span
    chatTrigger: '[slot="trigger"]', // 私信用户名触发点（旧 data-v 选择器已失效，用语义属性）
    userIntroColumn: ".sidebar-container .main", // 用户主页右侧内容列（补显简介的挂载点）
    nativeIntro: ".introduction", // 洛谷原生简介元素（存在=已显示，脚本不重复补）
    voidAnchor: "a[data-v-bade3303][data-v-4842157a]", // 题号着色里特殊的 javascript:void 0 链接
    // —— IDE 模式（2026-07 columba 前端；侦察实录 docs/superpowers/specs/2026-07-22-ide-mode-recon-notes.md）——
    ideToolbar: ".ide-toolbar", // IDE 三个分区（代码/输入/输出）各一条工具栏
    ideToolbarText: ".title .text", // 工具栏标题文字（代码/输入/输出）
    ideToolbarActions: ".actions", // 工具栏右侧按钮容器
    ideRunResult: ".run-result", // 输出工具栏里的 时间+内存 / RE 原因
    ideTextarea: "textarea.ide-textarea", // 输入/输出面板的文本域
    ideSampleBlock: ".io-sample-block", // 题面样例块（输入 #N / 输出 #N 各一块）
    cmContent: ".cm-content", // CodeMirror 6 内容层
    lentilleContext: "script#lentille-context", // 新版页面数据（JSON，含 problem.samples）
    // —— 安全访问中心拦截页（侦察实录 docs/superpowers/specs/2026-07-22-saver-api-recon-notes.md）——
    restrictedUrlPre: "pre#url", // 拦截页里的目标链接文本
    restrictedGoButton: "button#go", // 拦截页「继续访问」按钮
  };

  // 功能开关：key → 显示名。新增功能只需在此登记 + 在底部 FEATURES 注册启动器。
  const FEATURE_LABELS = new Map([
    [`${STORAGE_PREFIX}addProblemsColor`, "显示题目颜色"],
    [`${STORAGE_PREFIX}addMessageLink`, "私信界面 Ctrl+Click 打开用户主页"],
    [`${STORAGE_PREFIX}showIntro`, "显示隐藏的个人简介"],
    [`${STORAGE_PREFIX}ideBatchSampleTest`, "IDE 一键测试样例"],
    [`${STORAGE_PREFIX}showRestrictedContent`, "受限文章/剪贴板就地显示"],
  ]);

  const storage = {
    get: (k) => localStorage.getItem(k) === "true",
    set: (k, v) => localStorage.setItem(k, String(v)),
    has: (k) => localStorage.getItem(k) !== null,
  };
  // 首次运行：所有功能默认开启
  for (const k of FEATURE_LABELS.keys())
    if (!storage.has(k)) storage.set(k, true);

  // ============================================================
  // 设置面板（页内浮层，替代原来的 window.open + document.write）
  // ============================================================
  function injectStyle() {
    if (document.getElementById("luogusp-style")) return;
    const style = document.createElement("style");
    style.id = "luogusp-style";
    style.textContent = `
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
    (document.head || document.documentElement).appendChild(style);
  }

  function openSettings() {
    if (document.getElementById("luogusp-settings")) return; // 避免重复打开
    const overlay = document.createElement("div");
    overlay.id = "luogusp-settings";
    overlay.innerHTML = `
			<div class="luogusp-mask"></div>
			<div class="luogusp-panel" role="dialog" aria-modal="true">
				<div class="luogusp-content">
					<h3>LuoguSP 功能设置</h3>
					<div class="luogusp-list">
						${[...FEATURE_LABELS]
              .map(
                ([key, label]) => `
							<label class="luogusp-item">
								<input type="checkbox" data-key="${key}" ${storage.get(key) ? "checked" : ""}>
								<span>${label}</span>
							</label>`,
              )
              .join("")}
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
    const close = () => overlay.remove();

    overlay.addEventListener("click", (e) => {
      const t = e.target;
      if (t.classList.contains("luogusp-mask")) return close();
      const act = t.getAttribute && t.getAttribute("data-act");
      if (act === "close") return close();
      if (act === "all") boxes().forEach((b) => (b.checked = true));
      if (act === "none") boxes().forEach((b) => (b.checked = false));
      if (act === "save") {
        boxes().forEach((b) => storage.set(b.dataset.key, b.checked));
        close();
        if (confirm("设置已保存，是否立即刷新页面生效？")) location.reload();
      }
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", esc);
      }
    });
  }

  // 齿轮图标（24×24 Material settings，fill=currentColor 跟随导航文字色）
  const GEAR_PATH =
    "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";
  // 把一个已存在的 <svg> 原地改成齿轮（保留它的 class/data-v/尺寸，只换 viewBox+内容，从而继承洛谷图标样式）
  function gearInto(svg) {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", GEAR_PATH);
    svg.appendChild(path);
    return svg;
  }
  // 新建一个齿轮 svg（用于原条目没有 svg 图标时）；templateIcon 存在则复用其 class 拿尺寸。
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
    // 两套导航都试：首页竖排 nav.lfe-body / 内容页侧栏 nav.sidebar
    let nav = null,
      navSel = null;
    for (const sel of SELECTORS.navContainers) {
      const n = document.querySelector(sel);
      if (n) {
        nav = n;
        navSel = sel;
        break;
      }
    }
    if (!nav) return; // 该页无可识别导航，跳过
    if (nav.querySelector(".luogusp-setting-entry")) return; // 已存在

    // 选一个既有图标又有文字的原生条目当模板（取靠后的，落在工具/杂项区），克隆继承洛谷当前样式与间距。
    const cands = [...nav.querySelectorAll("a")].filter(
      (a) => a.querySelector("svg, img, .icon") && navTextSpan(a),
    );
    if (!cands.length) return;
    const template = cands[cands.length - 1];
    const li = template.closest("li");
    const unit = li && nav.contains(li) ? li : template; // 侧栏条目外套 <li>，连 li 一起克隆才对齐

    const clone = unit.cloneNode(true);
    const link = clone.matches("a") ? clone : clone.querySelector("a");
    if (!link) return;
    link.removeAttribute("href");
    link.removeAttribute("id");
    link.classList.remove(
      "router-link-active",
      "router-link-exact-active",
      "active",
    );
    link.classList.add("luogusp-setting-entry");
    link.setAttribute("role", "button");
    const textEl = navTextSpan(link);
    if (textEl) {
      if (navSel === "nav.lfe-body") {
        // 首页竖排栏窄：强制「插件」「设置」两字两行，避免默认 3+1 难看折行
        textEl.textContent = "";
        textEl.append("插件", document.createElement("br"), "设置");
      } else {
        textEl.textContent = "插件设置";
      }
    }
    const svg = link.querySelector("svg"); // 原地把图标 svg 改成齿轮，保留其 class/data-v 尺寸
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

  // 洛谷是 SPA：首页顶栏↔内容页侧栏随路由切换而重挂，入口须在导航变化时补上（rAF 节流，加了就早退）。
  function watchSettingButton() {
    let scheduled = false;
    const tick = () => {
      scheduled = false;
      try {
        addSettingButton();
      } catch (e) {
        console.error("LuoguSP setting entry:", e);
      }
    };
    new MutationObserver(() => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(tick);
      }
    }).observe(document.body, { childList: true, subtree: true });
    addSettingButton();
  }

  // ============================================================
  // 私信界面 Ctrl+Click 打开用户主页（用户名 + 头像）
  // ============================================================
  function addMessageLink() {
    const bound = new WeakSet(); // 去重，避免重复绑定
    const uidCache = new Map(); // username -> uid 缓存

    const openUser = (uid) => {
      if (uid) window.open(`/user/${uid}`, "_blank");
    };
    // 已在用户链接里的元素，浏览器原生 Ctrl+Click 即可新标签打开，跳过避免重复触发。
    const inUserLink = (el) =>
      el.closest('a[href*="/user/"], a[href*="/space/"]');

    async function getUidByName(username) {
      if (uidCache.has(username)) return uidCache.get(username);
      try {
        const res = await fetch(
          `/api/user/search?keyword=${encodeURIComponent(username)}`,
        );
        const data = await res.json();
        const uid = data && data.users && data.users[0] && data.users[0].uid;
        uidCache.set(username, uid);
        return uid;
      } catch (e) {
        console.error("LuoguSP getUid:", e);
      }
    }
    // 用户名触发点：Ctrl+Click → 按用户名查 uid
    function bindName(trigger) {
      if (bound.has(trigger) || inUserLink(trigger)) return;
      bound.add(trigger);
      trigger.addEventListener("click", async (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation(); // Ctrl 时才拦，普通点击不影响洛谷原有行为
        const name = (trigger.textContent || "").trim();
        if (name) openUser(await getUidByName(name));
      });
    }
    // 头像：Ctrl+Click → 直接从 src（usericon/{uid}）取 uid，无需查接口
    const AVATAR_RE = /\/usericon\/(\d+)/;
    function bindAvatar(img) {
      if (bound.has(img) || inUserLink(img) || !AVATAR_RE.test(img.src || ""))
        return;
      bound.add(img);
      img.style.cursor = "pointer";
      img.addEventListener("click", (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        const m = (img.src || "").match(AVATAR_RE); // 点击时再读，兼容虚拟滚动换头像
        if (m) openUser(m[1]);
      });
    }
    const scan = (root) => {
      if (!root.querySelectorAll) return;
      root.querySelectorAll(SELECTORS.chatTrigger).forEach(bindName);
      root.querySelectorAll("img").forEach(bindAvatar);
    };
    scan(document);
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes)
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (n.matches && n.matches(SELECTORS.chatTrigger)) bindName(n);
            if (n.matches && n.matches("img")) bindAvatar(n);
            scan(n);
          }
    }).observe(document, { childList: true, subtree: true });
  }

  // ============================================================
  // 显示隐藏的个人简介
  // 洛谷把个人简介改为「仅国际站可见」，但境内站服务器仍把 introduction 下发到页面同源数据里
  // （SSR 脚本 / _contentOnly 接口），只是前端不渲染。这里读同源数据自行补显，无需跨域。
  // ============================================================
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
  async function getIntroduction(uid) {
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
    // 2) SPA 换页等：同源 _contentOnly 接口
    try {
      const r = await fetch(`/user/${uid}?_contentOnly=1`);
      const intro = digIntro(await r.json(), uid);
      if (intro != null) return intro;
    } catch (e) {
      console.error("LuoguSP intro fetch:", e);
    }
    return null;
  }
  // 主渲染：优先用 @require 的 marked（真 GFM 解析器：表格+对齐/任务列表/嵌套列表/删除线/自动链接/裸 HTML 全支持）
  // + DOMPurify 消毒（marked 放行的裸 HTML 在此清理，XSS 安全）。数学公式仍走 KaTeX（先抽出占位，避免 marked 破坏 $ 内的 _ *）。
  // marked/DOMPurify 未加载时回退内置轻量渲染器 renderMarkdownLite。样式统一蹭洛谷 .lfe-marked-wrap。
  function renderMarkdown(md) {
    const mk = window.marked,
      dp = window.DOMPurify;
    if (!mk || !dp) return renderMarkdownLite(md); // 库未加载 → 回退轻量渲染器（本身 XSS 安全）
    const kx =
      (typeof window !== "undefined" && window.katex) ||
      (typeof katex !== "undefined" && katex) ||
      null;
    const tt = (f, d) => {
      if (!kx) return null;
      try {
        return kx.renderToString(f, { throwOnError: false, displayMode: d });
      } catch (e) {
        return null;
      }
    };
    const math = [];
    const hold = (h) => `%%LGMATH${math.push(h) - 1}%%`; // 数学占位：纯文本，过 marked/DOMPurify 不变，最后回填
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
      return renderMarkdownLite(md);
    }
    html = dp.sanitize(html, { ADD_ATTR: ["target"] }); // 消毒：剥离 script/on*/javascript: 等
    return html
      .replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer" ') // 链接新标签打开
      .replace(/<img /gi, '<img style="max-width:100%" ') // 图片限宽防溢出
      .replace(/%%LGMATH(\d+)%%/g, (_, i) => math[i]); // 回填 KaTeX（可信，消毒后再插）
  }

  // 内置轻量 Markdown → HTML（marked 未加载时的回退；XSS 安全：转义 HTML 实体防注入；URL 仅允许 http(s)/相对，挡 javascript:；
  // 洛谷允许的少量裸 HTML 走白名单消毒：img/a 校验 URL、安全内联标签去所有属性防 on* 注入、其余标签转义成文本）。
  // 覆盖：段落/换行、ATX+setext 标题、加粗/斜体、删除线、行内与围栏代码、链接、图片、无序/有序列表、引用、分割线、表格、
  //       KaTeX 公式（$..$ / $$..$$）、白名单裸 HTML。不覆盖：任务列表、表格对齐、裸 URL 自动链接、嵌套列表。
  function renderMarkdownLite(md) {
    const esc = (s) =>
      s.replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
      );
    const url = (u) => (/^(https?:)?\/\//i.test(u) || /^\//.test(u) ? u : "");
    const codeLanguageClass = (raw) => {
      const lang = (raw || "").trim().split(/\s+/)[0].toLowerCase();
      return /^[a-z0-9_+-]+$/.test(lang)
        ? ` class="language-${esc(lang)}"`
        : "";
    };
    const kx =
      (typeof window !== "undefined" && window.katex) ||
      (typeof katex !== "undefined" && katex) ||
      null;
    const tex = (f, display) => {
      if (!kx) return null;
      try {
        return kx.renderToString(f, {
          throwOnError: false,
          displayMode: display,
        });
      } catch (e) {
        return null;
      }
    };
    const spans = []; // 抽出的「原样片段」（代码/公式/白名单裸 HTML），最后回填
    const stash = (html) => `@@LGB${spans.push(html) - 1}@@`; // 占位符：printable、不含 esc 目标字符、正常文本不会出现
    const ga = (t, re) => (t.match(re) || [])[1] || ""; // 取标签属性值
    const inline = (s) =>
      s
        .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
        .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, a, u) => {
          const x = url(u);
          return x ? `<img src="${x}" alt="${a}" style="max-width:100%">` : m;
        })
        .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, t, u) => {
          const x = url(u);
          return x
            ? `<a href="${x}" target="_blank" rel="noopener noreferrer">${t}</a>`
            : m;
        })
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    const cells = (row) =>
      row
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
    const table = (lines) =>
      `<table><thead><tr>${cells(lines[0])
        .map((c) => `<th>${inline(c)}</th>`)
        .join("")}</tr></thead><tbody>${lines
        .slice(2)
        .map(
          (l) =>
            `<tr>${cells(l)
              .map((c) => `<td>${inline(c)}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</tbody></table>`;
    const SAFE =
      /^(b|strong|i|em|u|s|del|ins|mark|sub|sup|br|hr|code|kbd|small)$/i; // 允许原样的安全内联标签
    // esc 前抽出原样片段：① 围栏代码 ② 白名单裸 HTML（洛谷允许少量 HTML）③ 数学公式（含 <>&\ 会被 esc 破坏）
    let src = md
      .replace(/```([^\n]*)\n?([\s\S]*?)```/g, (_, rawLang, c) => {
        const cls = codeLanguageClass(rawLang);
        return stash(
          `<pre${cls}><code${cls}>${esc(c.replace(/\n$/, ""))}</code></pre>`,
        );
      })
      .replace(/<img\b[^>]*>/gi, (t) => {
        const x = url(ga(t, /\bsrc\s*=\s*["']?([^"'\s>]+)/i));
        return x
          ? stash(
              `<img src="${esc(x)}" alt="${esc(ga(t, /\balt\s*=\s*["']([^"']*)["']/i))}" style="max-width:100%">`,
            )
          : "";
      })
      .replace(/<a\b[^>]*>/gi, (t) => {
        const x = url(ga(t, /\bhref\s*=\s*["']?([^"'\s>]+)/i));
        return stash(
          x
            ? `<a href="${esc(x)}" target="_blank" rel="noopener noreferrer">`
            : "<span>",
        );
      })
      .replace(/<\/a>/gi, () => stash("</a>"))
      .replace(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi, (t, sl, nm) =>
        SAFE.test(nm) ? stash(`<${sl}${nm.toLowerCase()}>`) : t,
      ) // 白名单标签去所有属性防 on*；其余留原样→后面 esc 成文本
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, f) => {
        const h = tex(f.trim(), true);
        return h ? stash(h) : m;
      })
      .replace(/(?<!\\)\$([^\n$]+?)\$/g, (m, f) => {
        const h = tex(f, false);
        return h ? stash(h) : m;
      });
    src = esc(src) // 其余内容转义（占位符无 esc 目标字符，存活）
      .replace(/^([^\n]+)\n=+[ \t]*$/gm, "# $1") // setext h1（文本下一行 ===）
      .replace(/^([^\n]+)\n-{2,}[ \t]*$/gm, "## $1") // setext h2（文本下一行 ---）
      .replace(/^(#{1,6}[ \t]+.+)$/gm, "\n\n$1\n\n") // ATX 标题是行级构造，补空行独立成块（否则和正文粘一块被漏）
      .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "\n\n$1$1$1\n\n"); // hr 独立成块
    const html = src
      .split(/\n{2,}/)
      .map((block) => {
        const b = block.trim();
        if (/^@@LGB\d+@@$/.test(b)) return b; // 独占一段的占位（代码块 / 行间公式）
        const lines = block.split("\n");
        if (
          lines.length >= 2 &&
          /^\s*\|.*\|\s*$/.test(lines[0]) &&
          /^\s*\|[\s:|-]+\|\s*$/.test(lines[1])
        )
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
          return `<blockquote>${inline(lines.map((l) => l.replace(/^&gt;\s?/, "")).join("<br>"))}</blockquote>`; // > 已被 esc 转成 &gt;
        return `<p>${inline(block).replace(/\n/g, "<br>")}</p>`;
      })
      .join("");
    return html.replace(/@@LGB(\d+)@@/g, (_, i) => spans[i]); // 回填占位（inline 公式也在此步）
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
  const COPY_ICON_PATH =
    "M192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-200.6c0-17.4-7.1-34.1-19.7-46.2L370.6 17.8C358.7 6.4 342.8 0 326.3 0L192 0zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-64 0 0 16-192 0 0-256 16 0 0-64-16 0z";
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext)
      return navigator.clipboard.writeText(text);
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      return Promise.resolve();
    } finally {
      ta.remove();
    }
  }
  function makeCopyButton(code) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.setAttribute("aria-label", "复制代码");
    button.title = "复制代码";
    button.innerHTML = `<svg class="svg-inline--fa fa-copy copy-icon" data-prefix="fas" data-icon="copy" role="img" viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="${COPY_ICON_PATH}"></path></svg>`;
    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await copyText(code.textContent || "");
        button.classList.add("copied");
        button.title = "已复制";
        setTimeout(() => {
          button.classList.remove("copied");
          button.title = "复制代码";
        }, 900);
      } catch (err) {
        console.error("LuoguSP copy code:", err);
      }
    });
    return button;
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
  async function showHiddenIntro() {
    const m = location.pathname.match(/^\/(?:user|space)\/(\d+)/);
    if (!m) return;
    const route = currentUserRoute();
    if (!route.isHome) return;
    const uid = m[1];
    document.querySelectorAll(".luogusp-intro-card").forEach((e) => e.remove()); // 清换页残留
    if (document.querySelector(SELECTORS.nativeIntro)) return; // 原生已显示，不重复补
    const intro = await getIntroduction(uid);
    if (!intro || !intro.trim()) return;
    const place = () => {
      if (document.querySelector(".introduction:not(.luogusp-intro-card *)"))
        return true; // 原生简介已出现（管理员等）→ 别补
      if (document.querySelector(".luogusp-intro-card")) return true;
      const col = document.querySelector(SELECTORS.userIntroColumn); // 只挂内层内容列，绝不回退外层全宽（否则内容顶到最左被裁）
      if (!col) return false;
      renderIntroCard(col, intro);
      return true;
    };
    if (place()) return;
    // 内容列尚未渲染（SPA 换页）：等它出现再补，8s 后放弃
    const obs = new MutationObserver(() => {
      if (place()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 8000);
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
  function watchUrlChange(onChange) {
    if (!history.pushState._luoguspWrapped) {
      for (const method of ["pushState", "replaceState"]) {
        const raw = history[method];
        const wrapped = function (...args) {
          const ret = raw.apply(this, args);
          window.dispatchEvent(new Event("luogusp:urlchange"));
          return ret;
        };
        wrapped._luoguspWrapped = true;
        history[method] = wrapped;
      }
    }
    window.addEventListener("popstate", onChange);
    window.addEventListener("hashchange", onChange);
    window.addEventListener("luogusp:urlchange", onChange);
  }
  function watchHiddenIntro() {
    let requestedRouteKey = "";
    const check = () => {
      const route = currentUserRoute();
      const uid = route.uid;
      // 原生简介出现（管理员等原生可见）→ 移除我的卡，避免重复渲染
      if (document.querySelector(".introduction:not(.luogusp-intro-card *)")) {
        document
          .querySelectorAll(".luogusp-intro-card")
          .forEach((e) => e.remove());
        requestedRouteKey = route.key;
        return;
      }
      if (!uid || !route.isHome) {
        document
          .querySelectorAll(".luogusp-intro-card")
          .forEach((e) => e.remove());
        requestedRouteKey = "";
        return;
      }
      if (document.querySelector(".luogusp-intro-card")) {
        requestedRouteKey = route.key;
        return;
      }
      if (route.key !== requestedRouteKey) {
        requestedRouteKey = route.key;
        showHiddenIntro();
      }
    };
    check();
    let scheduled = false;
    const queueCheck = () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          check();
        });
      }
    };
    new MutationObserver(queueCheck).observe(document.body, {
      childList: true,
      subtree: true,
    });
    watchUrlChange(queueCheck);
  }

  // ============================================================
  // 题目难度着色
  // ============================================================
  class FetchRateLimiter {
    // launchGap：相邻两次发起 fetch 的最小间隔（越小越快，但过快可能被洛谷限流）
    // concurrency：最大同时在飞请求数（并发上限，网络慢时防堆积）
    // 单队列 FIFO：按入队顺序处理 = 页面 DOM 顺序（主列表在前先染，讨论标签最后）。
    constructor(launchGap, concurrency) {
      this.launchGap = launchGap;
      this.concurrency = concurrency;
      this.queue = [];
      this.active = 0;
      this.nextAt = 0;
      this.cache = new Map();
    }
    _drain() {
      while (this.active < this.concurrency && this.queue.length) {
        const wait = this.nextAt - Date.now();
        if (wait > 0) {
          setTimeout(() => this._drain(), wait);
          return;
        } // 距上次发起未满 launchGap
        this.nextAt = Date.now() + this.launchGap;
        const job = this.queue.shift();
        this.active++;
        fetch(job.url)
          .then(job.resolve, job.reject)
          .finally(() => {
            this.active--;
            this._drain();
          });
      }
    }
    fetchText(url) {
      if (this.cache.has(url)) return this.cache.get(url);
      const p = new Promise((resolve, reject) => {
        this.queue.push({ url, resolve, reject });
        this._drain();
      }).then((res) => res.text());
      this.cache.set(url, p);
      return p;
    }
  }
  const limiter = new FetchRateLimiter(200, 3); // 200ms 发起间隔、最多 3 并发（原为 300ms 串行）

  const colorCache = new Map(); // pid -> css 颜色
  const DIFF_RE = /"difficulty":\s*(\d+)/; // HTML 回退用
  let contentOnlyOk = null; // null 未知 / true 支持 / false 不支持

  // 优先走 _contentOnly JSON 接口（轻量、结构稳定），失败回退整页 HTML 正则。
  async function fetchDifficulty(pid) {
    if (contentOnlyOk !== false) {
      let text;
      try {
        text = await limiter.fetchText(`/problem/${pid}?_contentOnly=1`);
      } catch (e) {
        /* 网络错误，别据此判定接口不支持 */
      }
      if (text != null) {
        try {
          const d = JSON.parse(text)?.currentData?.problem?.difficulty;
          if (typeof d === "number") {
            contentOnlyOk = true;
            return d;
          }
        } catch (e) {
          if (contentOnlyOk === null) contentOnlyOk = false; // 拿到的是整页 HTML，判定不支持
        }
      }
    }
    try {
      const html = await limiter.fetchText(`/problem/${pid}`);
      const m = html.match(DIFF_RE);
      if (m) return Number(m[1]);
    } catch (e) {
      console.error("LuoguSP difficulty:", pid, e);
    }
    return null;
  }

  // 记录列表 / 练习页：洛谷已把整批题目难度注入 _feInstance，直接批量取，省去逐题抓取。
  function cacheDifficulty(pid, difficulty) {
    if (pid && typeof difficulty === "number")
      colorCache.set(pid, diffColor(difficulty));
  }
  function harvestFromFeInstance() {
    const cur = window._feInstance && window._feInstance.currentData;
    if (!cur) return;
    const url = location.href;
    if (url.startsWith("https://www.luogu.com.cn/record/list")) {
      const list = cur.records && cur.records.result;
      if (list && !list._luogusp) {
        for (const it of list)
          cacheDifficulty(
            it.problem && it.problem.pid,
            it.problem && it.problem.difficulty,
          );
        list._luogusp = true;
      }
    }
    if (/^https:\/\/www\.luogu\.com\.cn\/user\/\d+#practice$/.test(url)) {
      for (const key of ["submittedProblems", "passedProblems"]) {
        const list = cur[key];
        if (list && !list._luogusp) {
          for (const it of list) cacheDifficulty(it.pid, it.difficulty);
          list._luogusp = true;
        }
      }
    }
  }

  async function getProblemColor(pid) {
    harvestFromFeInstance();
    if (colorCache.has(pid)) return colorCache.get(pid);
    const d = await fetchDifficulty(pid);
    if (d == null) return null;
    const color = diffColor(d);
    colorCache.set(pid, color);
    return color;
  }

  function isProblemId(id) {
    if (id.startsWith("AT_")) return true;
    return /[a-zA-Z]/.test(id) && /[0-9]/.test(id);
  }

  // 把子树中第一处 pid 文本包成 <b>（纯 DOM，避免 innerHTML.replace 误伤属性内同名子串、
  // 重建整个锚点子树、抖掉已绑定的监听）。返回是否成功包裹。
  function wrapPidText(root, pid, color) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(pid);
      if (idx === -1) continue;
      const mid = node.splitText(idx); // mid 以 pid 开头
      mid.splitText(pid.length); // 把 pid 之后的部分切走，mid 现在正好等于 pid
      const b = document.createElement("b");
      b.style.color = color;
      b.textContent = pid;
      mid.parentNode.replaceChild(b, mid);
      return true;
    }
    return false;
  }

  async function colorAnchor(a) {
    let pid = a.href.split("/").pop();
    let isForum = false;
    if (pid.includes("?forum=")) {
      pid = pid.split("=").pop();
      isForum = true;
    }
    pid = pid.split("?")[0].split("=").pop();
    let isVoid = false;
    if (a.matches(SELECTORS.voidAnchor) && pid === "javascript:void 0") {
      pid = a.innerText.split(" ")[0];
      isVoid = true;
    }
    if (!isProblemId(pid)) return;
    // 只处理确属题目的锚点——/problem/ 链接、讨论区 ?forum= 标签、void 特链。
    // 避免把 /paste/xxx、/user/xxx 等「字母+数字」尾段误判成题号而空跑请求。
    if (!isForum && !isVoid && !a.href.includes("/problem/")) return;
    if (!a.innerText.startsWith(pid)) return;
    if (a.dataset.luoguspPid === pid) return; // 已着色，跳过（防重复处理/嵌套 <b>）

    const span = a.children[0];
    if (span && span.matches("span.pid") && span.innerText === pid) {
      const color = await getProblemColor(pid);
      if (color) {
        span.style.color = color;
        span.style.fontWeight = "bold";
        a.dataset.luoguspPid = pid;
      }
    } else {
      const color = await getProblemColor(pid);
      if (color && wrapPidText(a, pid, color)) a.dataset.luoguspPid = pid;
    }
  }

  function addProblemsColor() {
    new MutationObserver(async (muts) => {
      for (const m of muts) {
        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            if (n.nodeType !== Node.ELEMENT_NODE) continue;
            if (n.matches && n.matches("a[href]")) colorAnchor(n);
            if (n.querySelectorAll)
              n.querySelectorAll("a[href]").forEach(colorAnchor);
          }
        } else if (m.type === "characterData") {
          const span = m.target.parentElement;
          if (span && span.matches && span.matches("span.pid")) {
            const color = await getProblemColor(span.textContent);
            if (color) {
              span.style.color = color;
              span.style.fontWeight = "bold";
            }
          }
        }
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    document.querySelectorAll("a[href]").forEach(colorAnchor);
  }

  // ============================================================
  // IDE 一键测试样例
  // 洛谷新版题目页（columba）IDE 模式（#ide）下，逐组驱动题面样例的原生「运行」，
  // 结果从输出面板 DOM 捕获（结果经页面常驻 WS 推送，网络层拿不到——勿改走拦截）。
  // 锚点与配色的事实来源：docs/superpowers/specs/2026-07-22-ide-mode-recon-notes.md
  // ============================================================
  function ideToolbarByTitle(title) {
    for (const tb of document.querySelectorAll(SELECTORS.ideToolbar)) {
      const t = tb.querySelector(SELECTORS.ideToolbarText);
      if (t && t.textContent.trim() === title) return tb;
    }
    return null;
  }

  const IDE_BATCH = {
    running: false, // 批测进行中（防重入）
    stopReq: false, // 「停止」请求：当前组跑完即停
    driving: false, // 程序化点击原生按钮的瞬间为 true（区分用户手点）
    activeTab: "custom", // custom=原生输入输出 / samples=样例面板
    tabBar: null,
    panel: null,
    ioLayout: null, // 原生 输入|输出 水平分栏（tab 切换时显隐）
    rowsEl: null,
    summaryEl: null,
    stopBtn: null,
    results: null, // 本轮各组结果（过期标注用）
    stale: false,
    inputSnapshot: null, // 批测前用户自定义输入快照
  };

  function ideModeActive() {
    return (
      location.hash === "#ide" && !!document.querySelector(SELECTORS.ideToolbar)
    );
  }

  function lentilleProblem() {
    try {
      const el = document.querySelector(SELECTORS.lentilleContext);
      if (!el) return null;
      const json = JSON.parse(el.textContent);
      return (json && json.data && json.data.problem) || null;
    } catch (e) {
      return null;
    }
  }
  function currentPid() {
    const m = location.pathname.match(/^\/problem\/([A-Za-z0-9_]+)/);
    return m ? m[1] : "";
  }
  async function getIdeSamples() {
    const pid = currentPid();
    if (!pid) return null;
    const p = lentilleProblem();
    if (p && p.pid === pid && Array.isArray(p.samples)) return p.samples;
    // SPA 换题后 lentille-context 滞留旧题（真机实测）→ 新版内容接口兜底。
    // 注意：旧 `?_contentOnly=1` 在 columba 页面已死（返回整页 HTML），
    // 正确姿势是带 x-lentille-request 头（真机实测 2026-07-22）。
    try {
      const res = await fetch(`/problem/${pid}`, {
        headers: { "x-lentille-request": "content-only" },
      });
      const json = await res.json();
      const prob = json && json.data && json.data.problem;
      if (prob && Array.isArray(prob.samples)) return prob.samples;
    } catch (e) {
      console.error("LuoguSP ide samples:", e);
    }
    return null;
  }
  function sampleRunButtons() {
    // 「输入 #N」「输出 #N」各一块都带「运行」；只取输入块的，按 DOM 序=样例序
    const btns = [];
    for (const block of document.querySelectorAll(SELECTORS.ideSampleBlock)) {
      if (!/^(输入|Input)/i.test((block.textContent || "").trim())) continue;
      const run = [...block.querySelectorAll("a, button")].find(
        (b) => (b.textContent || "").trim() === "运行",
      );
      if (run) btns.push(run);
    }
    return btns;
  }
  function readIdeCode() {
    const content = document.querySelector(SELECTORS.cmContent);
    if (!content) return "";
    // 洛谷构建把 CM6 的 cmView 命名为 cmTile；拿不到就退化为可见文本（空代码检测够用）
    const view = content.cmTile && content.cmTile.view;
    if (view && view.state && view.state.doc) return view.state.doc.toString();
    return content.textContent || "";
  }

  let ideSubmitWaiter = null;
  function installIdeSubmitObserver() {
    if (XMLHttpRequest.prototype.open.__luoguspIde) return;
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    const open = function (method, url) {
      this.__luoguspIdeSubmit =
        typeof url === "string" && url.indexOf("/api/ide_submit") !== -1;
      return rawOpen.apply(this, arguments);
    };
    const send = function () {
      if (this.__luoguspIdeSubmit)
        this.addEventListener("loadend", () => {
          if (ideSubmitWaiter) {
            const w = ideSubmitWaiter;
            ideSubmitWaiter = null;
            w(this.status);
          }
        });
      return rawSend.apply(this, arguments);
    };
    open.__luoguspIde = true;
    XMLHttpRequest.prototype.open = open;
    XMLHttpRequest.prototype.send = send;
  }
  function waitIdeSubmit(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (ideSubmitWaiter === fn) ideSubmitWaiter = null;
        resolve(null);
      }, ms);
      const fn = (status) => {
        clearTimeout(timer);
        resolve(status);
      };
      ideSubmitWaiter = fn;
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function outputParts() {
    const tb = ideToolbarByTitle("输出");
    if (!tb) return null;
    const actions = tb.querySelector(SELECTORS.ideToolbarActions);
    const spans = actions ? [...actions.querySelectorAll("span")] : [];
    return {
      pill: spans.find((s) => !s.classList.contains("run-result")) || null,
      rr: actions ? actions.querySelector(SELECTORS.ideRunResult) : null,
      textarea: tb.parentElement
        ? tb.parentElement.querySelector(SELECTORS.ideTextarea)
        : null,
    };
  }
  // 完成锚点：胶囊 存在→消失→重现（实测清空 300~560ms、结果 1~3.5s；详见侦察实录）
  // 注意：此处不看 stopReq——设计口径是「当前组跑完即停」，停止只在组间生效
  async function waitIdePill(present, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const parts = outputParts();
      if (!parts) return null; // IDE 已卸载
      if (!!parts.pill === present) return parts.pill || true;
      await sleep(150);
    }
    return null;
  }

  async function runOneSample(runBtn) {
    const before = outputParts();
    if (!before) return { verdict: "UKE", note: "IDE 面板不存在" };
    const hadPill = !!before.pill;
    let submitP = waitIdeSubmit(10000);
    IDE_BATCH.driving = true;
    runBtn.click();
    IDE_BATCH.driving = false;
    let status = await submitP;
    if (status === 429) {
      await sleep(3000); // 限流：等 3s 原地重试一次
      submitP = waitIdeSubmit(10000);
      IDE_BATCH.driving = true;
      runBtn.click();
      IDE_BATCH.driving = false;
      status = await submitP;
    }
    if (status == null || status < 200 || status >= 300)
      return {
        verdict: "UKE",
        note: status == null ? "未观测到提交请求" : `提交失败 HTTP ${status}`,
      };
    if (hadPill && (await waitIdePill(false, 5000)) === null)
      return { verdict: "UKE", note: "旧结果未清空，疑似运行未开始" };
    const pill = await waitIdePill(true, 30000);
    if (!pill || pill === true)
      return { verdict: "UKE", note: "30s 未返回结果" };
    const parts = outputParts();
    return {
      verdict: (pill.textContent || "").trim() || "UKE",
      pillStyle: pill.getAttribute("style") || "",
      detail: parts.rr ? parts.rr.textContent.trim() : "",
      output: parts.textarea ? parts.textarea.value : "",
    };
  }

  function ideBatchHint(msg) {
    const btn = document.querySelector(".luogusp-ide-batch-btn");
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = msg;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = old;
      btn.disabled = IDE_BATCH.running;
    }, 1500);
  }
  async function startIdeBatch() {
    if (IDE_BATCH.running) return;
    mountIdeTabs();
    const samples = await getIdeSamples();
    if (!samples || !samples.length) return ideBatchHint("本题无样例");
    if (!readIdeCode().trim()) return ideBatchHint("代码为空");
    const runBtns = sampleRunButtons();
    if (!runBtns.length) return ideBatchHint("找不到样例运行按钮");
    const n = Math.min(samples.length, runBtns.length);
    if (runBtns.length !== samples.length)
      console.error(
        "LuoguSP ide batch: 样例数与运行按钮数不一致",
        samples.length,
        runBtns.length,
      );
    IDE_BATCH.running = true;
    IDE_BATCH.stopReq = false;
    IDE_BATCH.stale = false;
    IDE_BATCH.results = new Array(n).fill(null);
    const inputTa = (() => {
      const tb = ideToolbarByTitle("输入");
      return tb && tb.parentElement
        ? tb.parentElement.querySelector(SELECTORS.ideTextarea)
        : null;
    })();
    IDE_BATCH.inputSnapshot = inputTa ? inputTa.value : null;
    const batchBtn = document.querySelector(".luogusp-ide-batch-btn");
    const selfTest = (() => {
      const tb = ideToolbarByTitle("代码");
      const actions = tb && tb.querySelector(SELECTORS.ideToolbarActions);
      return actions
        ? [...actions.querySelectorAll("button")].find(
            (b) => (b.textContent || "").trim() === "自测",
          )
        : null;
    })();
    if (batchBtn) batchBtn.disabled = true;
    if (selfTest) selfTest.disabled = true; // 批测中禁原生自测防互相干扰
    if (IDE_BATCH.stopBtn) IDE_BATCH.stopBtn.style.display = "";
    switchIdeTab("samples");
    renderIdeRows(samples);
    if (IDE_BATCH.summaryEl) IDE_BATCH.summaryEl.textContent = "测试中…";
    let ceLog = null;
    for (let i = 0; i < n; i++) {
      if (IDE_BATCH.stopReq) break;
      const p = ideRowParts(i);
      if (p) {
        p.pill.setAttribute("style", IDE_PILL_RUN);
        p.pill.textContent = "运行中";
      }
      expandIdeRow(i);
      let r;
      try {
        r = await runOneSample(runBtns[i]);
      } catch (e) {
        console.error("LuoguSP ide batch:", e);
        r = { verdict: "UKE", note: String(e) };
      }
      IDE_BATCH.results[i] = r;
      applyIdeResult(i, r, samples[i]);
      if (r.verdict === "CE") {
        ceLog = r.output || "";
        for (let j = i + 1; j < n; j++) {
          IDE_BATCH.results[j] = {
            verdict: "CE",
            output: ceLog,
            note: "编译错误",
          };
          applyIdeResult(j, IDE_BATCH.results[j], samples[j]);
        }
        break;
      }
      if (i < n - 1 && !IDE_BATCH.stopReq) await sleep(500); // 组间限速
    }
    if (inputTa && IDE_BATCH.inputSnapshot != null) {
      inputTa.value = IDE_BATCH.inputSnapshot; // 还原用户自定义输入
      inputTa.dispatchEvent(new Event("input", { bubbles: true })); // 同步 Vue 绑定
    }
    IDE_BATCH.running = false;
    if (batchBtn) batchBtn.disabled = false;
    if (selfTest) selfTest.disabled = false;
    if (IDE_BATCH.stopBtn) IDE_BATCH.stopBtn.style.display = "none";
    finishIdeSummary();
  }

  // 判定口径同洛谷：CRLF 归一、去行尾空格、去末尾空行。仅用于 diff 渲染与交叉校验，
  // 最终判定以原生胶囊为准（AC/WA 由洛谷前端本地比较，侦察实录 §6）。
  function normalizeIdeOut(s) {
    return String(s == null ? "" : s)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/\n+$/, "");
  }
  function idePane(title, lines, badSet, emptyNote) {
    const pre = document.createElement("pre");
    if (!lines.length || (lines.length === 1 && lines[0] === "")) {
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
      r.pillStyle || "background-color:#3d3d3d;border-color:#333;color:#fff;",
    );
    p.detail.innerHTML = "";
    p.detail.classList.remove("luogusp-ide-log");
    if (r.verdict === "CE") {
      // CE：不显示三栏，直接展示编译日志（输出框捕获；侦察实录 §5）
      p.meta.textContent = "";
      p.detail.classList.add("luogusp-ide-log");
      p.detail.appendChild(
        idePane(
          "编译信息",
          String(r.output || "").split("\n"),
          null,
          "（无编译输出）",
        ),
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
        p.detail.classList.add("luogusp-ide-log"); // UKE 无产物，只留说明
        return;
      }
    }
    if (r.verdict === "RE" && r.detail) {
      const note = document.createElement("p");
      note.className = "luogusp-ide-note";
      note.textContent = r.detail; // RE 原因在 run-result 位置（侦察实录 §5）
      p.detail.appendChild(note);
      p.meta.textContent = "";
    }
    const expLines = normalizeIdeOut(sample[1]).split("\n");
    const actLines = normalizeIdeOut(r.output).split("\n");
    const bad = new Set();
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
        r.verdict === "AC" ? "（空）" : "（未产生输出）",
      ),
    );
  }

  function finishIdeSummary() {
    if (!IDE_BATCH.summaryEl || !IDE_BATCH.results) return;
    const rs = IDE_BATCH.results;
    const counts = {};
    let ac = 0,
      tested = 0;
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
    IDE_BATCH.summaryEl.textContent = text;
    const firstBad = rs.findIndex((r) => r && r.verdict !== "AC");
    if (firstBad !== -1) expandIdeRow(firstBad);
    else if (IDE_BATCH.rowsEl)
      IDE_BATCH.rowsEl
        .querySelectorAll(".luogusp-ide-row.open")
        .forEach((r) => r.classList.remove("open"));
  }

  function markIdeStale() {
    if (IDE_BATCH.stale || IDE_BATCH.running || !IDE_BATCH.results) return;
    IDE_BATCH.stale = true;
    if (IDE_BATCH.summaryEl && document.contains(IDE_BATCH.summaryEl))
      IDE_BATCH.summaryEl.textContent += " · 结果可能已过期，建议重新测试";
  }
  function hookIdeStaleAndGuard() {
    // 代码变更 → 过期标注（CM6 是 contenteditable，input/keydown 均会冒泡）
    const stale = (e) => {
      if (e.target && e.target.closest && e.target.closest(SELECTORS.cmContent))
        markIdeStale();
    };
    document.addEventListener("input", stale, true);
    document.addEventListener("keydown", stale, true);
    // 批测中拦掉用户手点原生 运行/自测（程序化点击带 driving 标记放行）
    document.addEventListener(
      "click",
      (e) => {
        if (!IDE_BATCH.running || IDE_BATCH.driving) return;
        const t =
          e.target &&
          e.target.closest &&
          e.target.closest(
            `${SELECTORS.ideSampleBlock} a, ${SELECTORS.ideToolbar} a.run`,
          );
        if (t) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
  }

  function mountIdeButton() {
    const tb = ideToolbarByTitle("代码");
    if (!tb) return;
    const actions = tb.querySelector(SELECTORS.ideToolbarActions);
    if (!actions || actions.querySelector(".luogusp-ide-batch-btn")) return;
    const selfTest = [...actions.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "自测",
    );
    if (!selfTest) return;
    // 克隆原生「自测」按钮继承洛谷样式（含 data-v 作用域），只换文字
    const btn = selfTest.cloneNode(true);
    btn.textContent = "一键测试";
    btn.classList.add("luogusp-ide-batch-btn");
    btn.disabled = false;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startIdeBatch();
    });
    actions.insertBefore(btn, selfTest);
  }

  function mountIdeTabs() {
    if (IDE_BATCH.tabBar && document.contains(IDE_BATCH.tabBar)) return;
    const inputTb = ideToolbarByTitle("输入");
    if (!inputTb) return;
    const ioLayout = inputTb.closest(".panel-layout"); // 底部 输入|输出 水平分栏
    const host = ioLayout && ioLayout.parentElement;
    if (!host) return;
    host
      .querySelectorAll(".luogusp-ide-tabbar, .luogusp-ide-panel")
      .forEach((e) => e.remove());
    const tabBar = document.createElement("div");
    tabBar.className = "luogusp-ide-tabbar";
    tabBar.innerHTML =
      '<span class="luogusp-ide-tab" data-tab="custom">自定义测试</span>' +
      '<span class="luogusp-ide-tab" data-tab="samples">样例测试</span>';
    tabBar.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) switchIdeTab(t.dataset.tab);
    });
    const panel = document.createElement("div");
    panel.className = "luogusp-ide-panel";
    panel.innerHTML =
      '<div class="luogusp-ide-head">' +
      '<span class="luogusp-ide-title">样例测试</span>' +
      '<span class="luogusp-ide-summary">尚未运行</span>' +
      '<span class="luogusp-ide-headbtns"></span>' +
      "</div>" +
      '<div class="luogusp-ide-rows"></div>';
    // 停止/重新测试：同样克隆原生「自测」继承样式
    const tpl = [
      ...document.querySelectorAll(`${SELECTORS.ideToolbar} button`),
    ].find(
      (b) =>
        (b.textContent || "").trim() === "自测" ||
        b.classList.contains("luogusp-ide-batch-btn"),
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
    IDE_BATCH.stopBtn = mkBtn("停止", "luogusp-ide-stop", () => {
      IDE_BATCH.stopReq = true;
    });
    IDE_BATCH.stopBtn.style.display = "none";
    mkBtn("重新测试", "luogusp-ide-rerun", () => startIdeBatch());
    host.insertBefore(tabBar, ioLayout);
    host.appendChild(panel);
    IDE_BATCH.tabBar = tabBar;
    IDE_BATCH.panel = panel;
    IDE_BATCH.ioLayout = ioLayout;
    IDE_BATCH.rowsEl = panel.querySelector(".luogusp-ide-rows");
    IDE_BATCH.summaryEl = panel.querySelector(".luogusp-ide-summary");
    syncIdeTabVisibility();
  }
  function switchIdeTab(tab) {
    IDE_BATCH.activeTab = tab;
    syncIdeTabVisibility();
  }
  function syncIdeTabVisibility() {
    const { tabBar, panel, ioLayout } = IDE_BATCH;
    if (!tabBar || !document.contains(tabBar) || !panel || !ioLayout) return;
    const samples = IDE_BATCH.activeTab === "samples";
    ioLayout.style.display = samples ? "none" : "";
    panel.style.display = samples ? "" : "none";
    tabBar.querySelectorAll(".luogusp-ide-tab").forEach((t) => {
      t.classList.toggle("on", (t.dataset.tab === "samples") === samples);
    });
  }

  const IDE_PILL_WAIT =
    "background-color:#bfbfbf;border-color:#b3b3b3;color:#fff;";
  const IDE_PILL_RUN =
    "background-color:#3498db;border-color:#2f89c5;color:#fff;";
  function renderIdeRows(samples) {
    const rowsEl = IDE_BATCH.rowsEl;
    if (!rowsEl) return;
    rowsEl.innerHTML = samples
      .map(
        (s, i) => `
      <div class="luogusp-ide-row" data-idx="${i}">
        <div class="luogusp-ide-rowhead">
          <span class="luogusp-ide-chev">▶</span>样例 #${i + 1}
          <span class="luogusp-ide-meta"></span>
          <span class="luogusp-ide-pill" style="${IDE_PILL_WAIT}">等待</span>
        </div>
        <div class="luogusp-ide-detail"></div>
      </div>`,
      )
      .join("");
    rowsEl.querySelectorAll(".luogusp-ide-rowhead").forEach((h) => {
      h.addEventListener("click", () => {
        const row = h.parentElement;
        const was = row.classList.contains("open");
        rowsEl
          .querySelectorAll(".luogusp-ide-row.open")
          .forEach((r) => r.classList.remove("open"));
        if (!was) row.classList.add("open");
      });
    });
  }
  function ideRowParts(i) {
    const row =
      IDE_BATCH.rowsEl &&
      IDE_BATCH.rowsEl.querySelector(`.luogusp-ide-row[data-idx="${i}"]`);
    if (!row) return null;
    return {
      row,
      pill: row.querySelector(".luogusp-ide-pill"),
      meta: row.querySelector(".luogusp-ide-meta"),
      detail: row.querySelector(".luogusp-ide-detail"),
    };
  }
  function expandIdeRow(i) {
    if (!IDE_BATCH.rowsEl) return;
    IDE_BATCH.rowsEl
      .querySelectorAll(".luogusp-ide-row.open")
      .forEach((r) => r.classList.remove("open"));
    const p = ideRowParts(i);
    if (p) p.row.classList.add("open");
  }

  function ensureIdeBatchUI() {
    if (!ideModeActive()) {
      unmountIdeBatchUI();
      return;
    }
    mountIdeButton();
    mountIdeTabs();
    syncIdeTabVisibility();
  }

  function unmountIdeBatchUI() {
    if (IDE_BATCH.running) IDE_BATCH.stopReq = true; // 退出 IDE/换题：请求停止
    IDE_BATCH.activeTab = "custom"; // 复位，防再次进入时默认落在空面板
    IDE_BATCH.tabBar = IDE_BATCH.panel = IDE_BATCH.ioLayout = null;
    IDE_BATCH.rowsEl = IDE_BATCH.summaryEl = IDE_BATCH.stopBtn = null;
  }

  // SPA：进出 IDE 模式/换题时补挂与清理（rAF 节流，同既有 watchSettingButton 模式）
  function watchIdeBatch() {
    installIdeSubmitObserver();
    hookIdeStaleAndGuard();
    let scheduled = false;
    const tick = () => {
      scheduled = false;
      try {
        ensureIdeBatchUI();
      } catch (e) {
        console.error("LuoguSP ide batch:", e);
      }
    };
    const queue = () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(tick);
      }
    };
    new MutationObserver(queue).observe(document.body, {
      childList: true,
      subtree: true,
    });
    watchUrlChange(queue);
    ensureIdeBatchUI();
  }

  // ============================================================
  // 受限文章/剪贴板就地显示
  // 国内站访问非本人/未审核的 /article、/paste 会落在「安全访问中心」拦截页
  // （独立静态页、零全站样式）。本功能就地接管整页，数据来自洛谷保存站
  // （api.luogu.me，CORS 开放、匿名），markdown 走脚本自有渲染链路。
  // 事实来源：docs/superpowers/specs/2026-07-22-saver-api-recon-notes.md
  // ============================================================
  const SAVER_API = "https://api.luogu.me";
  async function saverGet(path) {
    const res = await fetch(SAVER_API + path);
    return res.json(); // 统一壳 {code,message,data}；业务码 404=未收录
  }
  async function saverPost(path, body) {
    const res = await fetch(SAVER_API + path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  // 拦截页判定：URL 形态 + 标题 + pre#url 内容三重锚点；不满足=正常页面，绝不接管
  function restrictedPageInfo() {
    const m = location.pathname.match(/^\/(article|paste)\/([A-Za-z0-9]+)\/?$/);
    if (!m) return null;
    if (document.title.indexOf("安全访问中心") === -1) return null;
    const pre = document.querySelector(SELECTORS.restrictedUrlPre);
    const target = pre ? (pre.textContent || "").trim() : "";
    if (target.indexOf(`/${m[1]}/${m[2]}`) === -1) return null;
    return {
      type: m[1],
      id: m[2],
      origUrl: target || `https://www.luogu.com/${m[1]}/${m[2]}`,
    };
  }

  function injectRstStyle() {
    if (document.getElementById("luogusp-rst-style")) return;
    const style = document.createElement("style");
    style.id = "luogusp-rst-style";
    style.textContent = `
			body.luogusp-rst{margin:0;background:#f4f5f8;color:#333;font:14px/1.7 "Helvetica Neue",Helvetica,"PingFang SC","Microsoft YaHei",Arial,sans-serif;}
			.luogusp-rst a{color:#0e90d2;text-decoration:none;}
			.luogusp-rst-topbar{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:0 24px;height:50px;display:flex;align-items:center;gap:12px;}
			.luogusp-rst-topbar .crumb{color:#999;}
			.luogusp-rst-topbar .right{margin-left:auto;font-size:13px;}
			.luogusp-rst-wrap{max-width:820px;margin:0 auto;padding:24px 16px 60px;}
			.luogusp-rst-banner h1{margin:0 0 12px;font-size:26px;font-weight:600;color:#222;}
			.luogusp-rst-meta{display:flex;align-items:center;gap:18px;flex-wrap:wrap;color:#999;font-size:13px;margin-bottom:18px;}
			.luogusp-rst-meta .who{display:flex;align-items:center;gap:8px;}
			.luogusp-rst-meta img{width:28px;height:28px;border-radius:50%;}
			.luogusp-rst-meta .uname{font-weight:600;}
			.luogusp-rst-tag{display:inline-block;background:#eef7fd;color:#0e90d2;border-radius:3px;padding:0 8px;margin-right:6px;font-size:12px;}
			.luogusp-rst-card{background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:24px 28px;margin-bottom:16px;overflow-wrap:break-word;}
			.luogusp-rst-md h1,.luogusp-rst-md h2{border-bottom:1px solid #eee;padding-bottom:.3em;margin:1.2em 0 .7em;font-weight:600;}
			.luogusp-rst-md h1{font-size:1.6em;}.luogusp-rst-md h2{font-size:1.35em;}
			.luogusp-rst-md h3{font-size:1.15em;margin:1em 0 .5em;}
			.luogusp-rst-md p{margin:.6em 0;}
			.luogusp-rst-md blockquote{margin:.8em 0;padding:2px 12px;border-left:4px solid #dfe2e5;color:#666;background:#fafbfc;}
			.luogusp-rst-md table{border-collapse:collapse;margin:.8em 0;}
			.luogusp-rst-md th,.luogusp-rst-md td{border:1px solid #dfe2e5;padding:4px 12px;}
			.luogusp-rst-md code{background:#f2f3f5;border-radius:3px;padding:.1em .35em;font-family:"Fira Code","Fira Mono",Menlo,Consolas,monospace;font-size:.92em;}
			.luogusp-rst-md pre code{background:transparent;padding:0;}
			.luogusp-rst-md img{max-width:100%;}
			.luogusp-rst-caption{color:#999;font-size:12px;margin:6px 2px 14px;display:flex;gap:16px;}
			.luogusp-rst-actions{display:flex;gap:26px;padding:6px 2px 2px;color:#bbb;}
			.luogusp-rst-actions .act{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:12px;cursor:not-allowed;}
			.luogusp-rst-actions svg{width:22px;height:22px;fill:currentColor;}
			.luogusp-rst-toc{position:fixed;top:80px;right:calc(50% - 410px - 260px);width:220px;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:12px 0;font-size:13px;max-height:70vh;overflow:auto;}
			@media (max-width:1350px){.luogusp-rst-toc{display:none;}}
			.luogusp-rst-toc a{display:block;padding:3px 16px;color:#555;border-left:2px solid transparent;}
			.luogusp-rst-toc a:hover{color:#0e90d2;}
			.luogusp-rst-toc a[data-lv="2"]{padding-left:30px;}
			.luogusp-rst-toc a[data-lv="3"]{padding-left:44px;}
			.luogusp-rst-status{font-size:12px;color:#999;margin:0 0 10px;}
			.luogusp-rst-status.ok{color:#52c41a;}
			.luogusp-rst-comment-row{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid #f0f0f0;}
			.luogusp-rst-comment-row img{width:36px;height:36px;border-radius:50%;}
			.luogusp-rst-comment-row .chead{font-size:13px;color:#999;display:flex;gap:10px;align-items:baseline;}
			.luogusp-rst-comment-row .cbody{margin-top:2px;}
			.luogusp-rst-comment-row .cbody p{margin:.2em 0;}
			.luogusp-rst-note{color:#999;font-size:12px;text-align:center;margin-top:28px;}
			.luogusp-rst-skel{height:16px;border-radius:3px;background:linear-gradient(90deg,#eee 25%,#f6f6f6 50%,#eee 75%);background-size:200% 100%;animation:luogusp-rst-sh 1.2s infinite;margin:12px 0;}
			@keyframes luogusp-rst-sh{to{background-position:-200% 0;}}
		`;
    (document.head || document.documentElement).appendChild(style);
  }

  // 洛谷用户名色（未知色兜底灰）
  const RST_COLORS = {
    Gray: "#bfbfbf",
    Blue: "#0e90d2",
    Green: "#52c41a",
    Orange: "#f39c11",
    Red: "#fe4c61",
    Purple: "#9d3dcf",
    Cheater: "#ad8b00",
  };
  const rstUserColor = (c) => RST_COLORS[c] || RST_COLORS.Gray;
  // 分类枚举：以已收录样本对照国际站实测钉死；未验证值显示「分类 #N」
  const RST_CATEGORIES = { 1: "个人记录", 2: "题解", 3: "科技·工程" };
  const rstCategoryText = (c) => RST_CATEGORIES[c] || `分类 #${c}`;
  function rstFmtTime(v) {
    const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function rstSetStatus(text, ok) {
    const el = document.querySelector(".luogusp-rst-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
  }
  // markdown → 容器（renderMarkdown 已消毒；容器须挂 luogusp-mdstyle 继承代码块/hljs/复制按钮样式。
  // ★勿用 luogusp-intro-card：那是简介补显功能的所有权标记，其观察器会在非用户主页删除该类节点）
  function rstRenderMd(container, md) {
    container.innerHTML = renderMarkdown(String(md || ""));
    highlightCodeBlocks(container);
    enhanceCodeBlocks(container);
  }
  function rstAvatar(uid) {
    return `https://cdn.luogu.com.cn/upload/usericon/${uid}.png`;
  }

  const RST_ICONS = {
    up: "M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66-.23-.45-.52-.86-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84C7 18.95 8.05 20 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z",
    star: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
    down: "M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.45.52.86.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34C17 5.05 15.95 4 14.66 4H6.56c-.71 0-1.36.37-1.73.97l-2.66 6.15z",
  };
  function rstShell(info, bodyHtml) {
    document.title =
      (info.type === "article" ? "文章" : "云剪贴板") + " - 洛谷";
    document.documentElement.scrollTop = 0;
    document.body.className = "luogusp-rst";
    document.body.innerHTML = `
			<div class="luogusp-rst-topbar">
				<a href="/">洛谷</a><span class="crumb">/</span>
				<span>${info.type === "article" ? "专栏" : "云剪贴板"}</span>
				<span class="right"><a href="${info.origUrl}" rel="noopener noreferrer">国际站原文</a></span>
			</div>
			<div class="luogusp-rst-wrap">${bodyHtml}</div>`;
  }
  function rstBuildLoading(info) {
    rstShell(
      info,
      `<div class="luogusp-rst-card"><p class="luogusp-rst-status">该内容尚未被保存站收录，已自动发起收录，请稍候…</p>
			<div class="luogusp-rst-skel" style="width:60%"></div><div class="luogusp-rst-skel"></div>
			<div class="luogusp-rst-skel"></div><div class="luogusp-rst-skel" style="width:80%"></div></div>`,
    );
  }
  function rstBuildFailure(info, reason) {
    rstShell(
      info,
      `<div class="luogusp-rst-card"><h1 style="font-size:20px;margin:0 0 10px;">未能获取内容</h1>
			<p>${reason}</p>
			<p>可能原因：内容未公开、未通过审核，或保存站暂时不可用。</p>
			<p><a href="${info.origUrl}" rel="noopener noreferrer">前往国际站查看原文 →</a></p>
			<p class="luogusp-rst-note">此页面由 LuoguSP 生成 · 数据来源：洛谷保存站</p></div>`,
    );
  }
  function rstActionsHtml(isArticle) {
    if (!isArticle) return "";
    return `<div class="luogusp-rst-actions">
			<span class="act" title="点赞（仅国际站可用）"><svg viewBox="0 0 24 24"><path d="${RST_ICONS.up}"/></svg>-</span>
			<span class="act" title="收藏（仅国际站可用）"><svg viewBox="0 0 24 24"><path d="${RST_ICONS.star}"/></svg>-</span>
			<span class="act" title="不推荐（仅国际站可用）"><svg viewBox="0 0 24 24"><path d="${RST_ICONS.down}"/></svg>-</span>
		</div>`;
  }
  function rstBuildPage(info, data) {
    const isArticle = info.type === "article";
    const author = data.author || {};
    const metaBits = [];
    if (data.createdAt) metaBits.push(`发布于 ${rstFmtTime(data.createdAt)}`);
    if (isArticle && data.category != null)
      metaBits.push(rstCategoryText(data.category));
    rstShell(
      info,
      `<div class="luogusp-rst-banner">
				<h1></h1>
				<div class="luogusp-rst-meta">
					<span class="who"><img alt=""><span class="uname"></span></span>
					${metaBits.map((b) => `<span>${b}</span>`).join("")}
					<span class="tags"></span>
				</div>
			</div>
			<p class="luogusp-rst-status"></p>
			<div class="luogusp-rst-card luogusp-mdstyle">
				<div class="luogusp-rst-md lfe-marked"></div>
				<div class="luogusp-rst-caption">
					<span>存档更新于 ${rstFmtTime(data.updatedAt)}</span>
					<span><a class="luogusp-rst-refresh" href="javascript:void 0">申请更新</a></span>
				</div>
				${rstActionsHtml(isArticle)}
			</div>
			${isArticle ? '<div class="luogusp-rst-card luogusp-rst-comments"><h3 style="margin:0 0 6px;">评论区 <a class="luogusp-rst-crefresh" style="font-size:12px;font-weight:400;" href="javascript:void 0">更新评论</a></h3><div class="luogusp-rst-clist"><p class="luogusp-rst-note">评论加载中…</p></div></div>' : ""}
			<p class="luogusp-rst-note">内容来自洛谷保存站存档，互动功能仅国际站可用 · <a href="${info.origUrl}" rel="noopener noreferrer">查看国际站原文</a></p>`,
    );
    // 文本一律走 textContent，杜绝二次注入
    document.querySelector(".luogusp-rst-banner h1").textContent = isArticle
      ? data.title || "(无标题)"
      : `云剪贴板 ${data.id}`;
    const img = document.querySelector(".luogusp-rst-meta img");
    img.src = rstAvatar(data.authorId || author.id || 0);
    const uname = document.querySelector(".luogusp-rst-meta .uname");
    uname.textContent = author.name || `用户 ${data.authorId || "?"}`;
    uname.style.color = rstUserColor(author.color);
    const tagWrap = document.querySelector(".luogusp-rst-meta .tags");
    (isArticle && Array.isArray(data.tags) ? data.tags : []).forEach((t) => {
      const s = document.createElement("span");
      s.className = "luogusp-rst-tag";
      s.textContent = t;
      tagWrap.appendChild(s);
    });
    rstRenderMd(document.querySelector(".luogusp-rst-md"), data.content);
    if (isArticle) rstBuildToc();
    const refresh = document.querySelector(".luogusp-rst-refresh");
    if (refresh)
      refresh.addEventListener("click", () => rstManualRefresh(info));
  }
  function rstBuildToc() {
    const md = document.querySelector(".luogusp-rst-md");
    const heads = [...md.querySelectorAll("h1, h2, h3")];
    if (heads.length < 2) return;
    const toc = document.createElement("div");
    toc.className = "luogusp-rst-toc";
    heads.forEach((h, i) => {
      h.id = `luogusp-toc-${i}`;
      const a = document.createElement("a");
      a.dataset.lv = h.tagName[1];
      a.textContent = h.textContent;
      a.href = `#luogusp-toc-${i}`;
      toc.appendChild(a);
    });
    document.body.appendChild(toc);
  }

  function rstRenderComments(comments) {
    const wrap = document.querySelector(".luogusp-rst-clist");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!comments || !comments.length) {
      wrap.innerHTML = '<p class="luogusp-rst-note">暂无评论存档</p>';
      return;
    }
    for (const c of comments) {
      const a = c.author || {};
      const row = document.createElement("div");
      row.className = "luogusp-rst-comment-row";
      const img = document.createElement("img");
      img.src = rstAvatar(a.id || 0);
      img.alt = "";
      const main = document.createElement("div");
      const head = document.createElement("div");
      head.className = "chead";
      const name = document.createElement("span");
      name.textContent = a.name || "?";
      name.style.color = rstUserColor(a.color);
      name.style.fontWeight = "600";
      const time = document.createElement("span");
      time.textContent = rstFmtTime(Number(c.time));
      head.append(name, time);
      const body = document.createElement("div");
      body.className = "cbody luogusp-mdstyle";
      body.innerHTML = renderMarkdown(String(c.content || "")); // renderMarkdown 已消毒
      main.append(head, body);
      row.append(img, main);
      wrap.appendChild(row);
    }
  }
  async function rstLoadComments(info) {
    const wrap = document.querySelector(".luogusp-rst-clist");
    if (!wrap) return;
    try {
      const q = await saverGet(`/article/comments/${info.id}`);
      rstRenderComments(q && q.data ? q.data.comments : null);
    } catch (e) {
      console.error("LuoguSP restricted comments:", e);
      wrap.innerHTML = '<p class="luogusp-rst-note">评论加载失败</p>';
    }
    const btn = document.querySelector(".luogusp-rst-crefresh");
    if (btn && !btn.__luoguspBound) {
      btn.__luoguspBound = true;
      btn.addEventListener("click", async () => {
        btn.textContent = "更新中…";
        try {
          await saverPost(`/article/comments/${info.id}/refresh`);
          await sleep(4000);
          const q = await saverGet(`/article/comments/${info.id}`);
          rstRenderComments(q && q.data ? q.data.comments : null);
          btn.textContent = "更新评论";
        } catch (e) {
          console.error("LuoguSP restricted comment refresh:", e);
          btn.textContent = "更新失败，点击重试";
        }
      });
    }
  }

  function rstQuery(info) {
    return saverGet(`/${info.type}/query/${info.id}`);
  }
  function rstTriggerSave(info) {
    return saverPost(`/workflow/create/template/${info.type}-save-pipeline`, {
      targetId: info.id,
    });
  }
  // 就地刷新正文（保滚动位置，不整页重建）
  function rstApplyFresh(info, data) {
    rstRenderMd(document.querySelector(".luogusp-rst-md"), data.content);
    const toc = document.querySelector(".luogusp-rst-toc");
    if (toc) toc.remove();
    if (info.type === "article") rstBuildToc();
    rstSetStatus(`已更新（存档时间 ${rstFmtTime(data.updatedAt)}）`, true);
  }
  async function rstPollFresh(info, oldHash, times, gapMs) {
    for (let i = 0; i < times; i++) {
      await sleep(gapMs);
      let q;
      try {
        q = await rstQuery(info);
      } catch (e) {
        continue; // 网络抖动，下轮再试
      }
      if (q && q.code === 200 && q.data && q.data.contentHash !== oldHash)
        return q.data;
    }
    return null;
  }
  async function rstManualRefresh(info) {
    rstSetStatus("正在申请保存站更新…");
    try {
      await rstTriggerSave(info);
      const cur = await rstQuery(info);
      const fresh = await rstPollFresh(
        info,
        cur && cur.data ? cur.data.contentHash : "",
        10,
        3000,
      );
      if (fresh) rstApplyFresh(info, fresh);
      else rstSetStatus("存档已是最新（或更新未完成）");
    } catch (e) {
      console.error("LuoguSP restricted refresh:", e);
      rstSetStatus("更新请求失败，请稍后再试");
    }
  }
  async function rstRun() {
    const info = restrictedPageInfo();
    if (!info) return;
    let q;
    try {
      q = await rstQuery(info);
    } catch (e) {
      // 保存站不可达：不动拦截页，仅置顶提示，保留原生跳转能力
      console.error("LuoguSP restricted:", e);
      const tip = document.createElement("p");
      tip.style.cssText =
        "margin:12px auto;max-width:640px;color:#e74c3c;font-size:13px;text-align:center;";
      tip.textContent =
        "LuoguSP：保存站(api.luogu.me)不可达，无法就地显示该内容。";
      document.body.insertBefore(tip, document.body.firstChild);
      return;
    }
    injectRstStyle();
    if (q && q.code === 200 && q.data) {
      rstBuildPage(info, q.data);
      if (info.type === "article") rstLoadComments(info);
      // 每访问必申请更新（owner 拍板）；存档很新鲜（<10 分钟）时跳过，减轻保存站压力
      const ageMs = Date.now() - Date.parse(q.data.updatedAt || 0);
      if (!(ageMs >= 0 && ageMs < 10 * 60 * 1000)) {
        try {
          await rstTriggerSave(info);
          rstSetStatus("已显示存档，正在后台检查更新…");
          const fresh = await rstPollFresh(info, q.data.contentHash, 8, 3000);
          if (fresh) rstApplyFresh(info, fresh);
          else
            rstSetStatus(
              `存档更新于 ${rstFmtTime(q.data.updatedAt)}，已是最新`,
            );
        } catch (e) {
          console.error("LuoguSP restricted freshen:", e);
          rstSetStatus("后台更新请求失败（不影响当前存档显示）");
        }
      }
      return;
    }
    // 未收录：发起保存并等待入库
    rstBuildLoading(info);
    try {
      await rstTriggerSave(info);
    } catch (e) {
      console.error("LuoguSP restricted save:", e);
      return rstBuildFailure(info, "向保存站发起收录请求失败。");
    }
    for (let i = 0; i < 15; i++) {
      await sleep(3000);
      let poll;
      try {
        poll = await rstQuery(info);
      } catch (e) {
        continue;
      }
      if (poll && poll.code === 200 && poll.data) {
        rstBuildPage(info, poll.data);
        if (info.type === "article") rstLoadComments(info);
        rstSetStatus("已完成首次收录", true);
        return;
      }
    }
    rstBuildFailure(info, "保存站在限定时间内未能完成收录。");
  }

  function watchRestrictedPage() {
    // 拦截页是独立静态页，无 SPA，一次性执行即可
    rstRun().catch((e) => console.error("LuoguSP restricted:", e));
  }

  // ============================================================
  // 启动
  // ============================================================
  const isChatPage = location.href.startsWith("https://www.luogu.com.cn/chat");

  const FEATURES = [
    { always: true, run: watchSettingButton },
    {
      key: `${STORAGE_PREFIX}addProblemsColor`,
      run: () => setTimeout(addProblemsColor, 500),
    },
    {
      key: `${STORAGE_PREFIX}addMessageLink`,
      run: () => {
        if (isChatPage) setTimeout(addMessageLink, 500);
      },
    },
    { key: `${STORAGE_PREFIX}showIntro`, run: watchHiddenIntro },
    { key: `${STORAGE_PREFIX}ideBatchSampleTest`, run: watchIdeBatch },
    { key: `${STORAGE_PREFIX}showRestrictedContent`, run: watchRestrictedPage },
  ];

  injectStyle();
  for (const f of FEATURES) {
    if (!f.always && !storage.get(f.key)) continue;
    try {
      f.run();
    } catch (e) {
      console.error("LuoguSP feature failed:", e);
    }
  }
})();
