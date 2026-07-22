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

  // 样式为洛谷原生规则的烘焙拷贝（2026-07-22 第四轮：以 www.luogu.com 参照页逐元素重测，勿凭感觉改）。
  // 文章页=columba 现行版式（白顶栏+汉堡钉栏/抽屉双模式+白色通栏正文带+内联互动条+滚动左浮条；
  //   规则源=fecdn columba loader.20260712-2050.css + MOD2589~b75e9625.css + 登录/匿名双态实测 computed）。
  // 剪贴板页=旧版 lfe 默认主题（#34495e 左导航+#3498db logo 块+90° 深灰渐变头部+展开源码卡；
  //   规则源=fecdn luogu loader.css?ver=20260422 + module.185 + 实测 computed）。作用域
  //   body.luogusp-rst-article / body.luogusp-rst-paste。
  // 已知取舍（悬浮层默认不可见，未复刻）：用户名/头像悬浮卡、旧版「应用」弹层、专栏笔按钮下拉。
  function injectRstStyle() {
    if (document.getElementById("luogusp-rst-style")) return;
    const style = document.createElement("style");
    style.id = "luogusp-rst-style";
    style.textContent = `
			.luogusp-rst-status{font-size:.875em;color:gray;margin-left:.75em;}
			.luogusp-rst-status.ok{color:#52c41a;}
			.luogusp-rst-note{color:#999;font-size:12px;text-align:center;margin:24px 0;}
			.luogusp-rst-loader{position:fixed;inset:0;z-index:2147483000;background:#f5f5f5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#595959;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;}
			.luogusp-rst-spinner{width:36px;height:36px;border:3px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;animation:luogusp-rst-spin .8s linear infinite;}
			@keyframes luogusp-rst-spin{to{transform:rotate(360deg);}}
			.luogusp-rst-fadein{animation:luogusp-rst-fade .25s ease-out;}
			@keyframes luogusp-rst-fade{from{opacity:0;}to{opacity:1;}}
			.luogusp-rst-plain{margin:0;background:#f5f5f5;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#404040;}
			.luogusp-rst-plain a{color:#3498db;text-decoration:none;}
			.luogusp-rst-plaincard{max-width:640px;margin:15vh auto 0;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(26,26,26,.1);padding:1.5em;}
			.luogusp-rstpage .code-container{margin:1rem 0;position:relative;}
			.luogusp-rstpage .code-container:hover>.copy-button{opacity:1;}
			.luogusp-rstpage .copy-button{position:absolute;top:.5em;right:.5em;padding:.6em;display:flex;align-items:center;justify-content:center;transition:opacity .2s;opacity:0;background:transparent;border:0;border-radius:4px;cursor:pointer;color:#555;}
			.luogusp-rstpage .copy-button.copied{color:#52c41a;}
			.luogusp-rstpage .copy-icon{width:1em;height:1em;}
			.luogusp-rstpage .code-container>pre{margin:0;}
			.luogusp-rstpage .hljs{background:transparent;color:#4d4d4c;padding:0;}
			.luogusp-rstpage .hljs-comment,.luogusp-rstpage .hljs-quote{color:#8e908c;}
			.luogusp-rstpage .hljs-variable,.luogusp-rstpage .hljs-template-variable,.luogusp-rstpage .hljs-tag,.luogusp-rstpage .hljs-name,.luogusp-rstpage .hljs-selector-id,.luogusp-rstpage .hljs-selector-class,.luogusp-rstpage .hljs-regexp,.luogusp-rstpage .hljs-deletion{color:#c82829;}
			.luogusp-rstpage .hljs-number,.luogusp-rstpage .hljs-built_in,.luogusp-rstpage .hljs-builtin-name,.luogusp-rstpage .hljs-literal,.luogusp-rstpage .hljs-type,.luogusp-rstpage .hljs-params,.luogusp-rstpage .hljs-meta,.luogusp-rstpage .hljs-link{color:#f5871f;}
			.luogusp-rstpage .hljs-attribute{color:#eab700;}
			.luogusp-rstpage .hljs-string,.luogusp-rstpage .hljs-symbol,.luogusp-rstpage .hljs-bullet,.luogusp-rstpage .hljs-addition{color:#718c00;}
			.luogusp-rstpage .hljs-title,.luogusp-rstpage .hljs-section{color:#4271ae;}
			.luogusp-rstpage .hljs-keyword,.luogusp-rstpage .hljs-selector-tag{color:#8959a8;}
			.luogusp-rstpage .hljs-emphasis{font-style:italic;}
			.luogusp-rstpage .hljs-strong{font-weight:bold;}
			body.luogusp-rst-article{margin:0;background:#f5f5f5;font-size:16px;line-height:1.5;color:#404040;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans","Noto Sans SC","Source Sans Pro","Source Han Sans","Segoe UI",Arial,"Microsoft YaHei","WenQuanYi Micro Hei",sans-serif;--lcolor--primary:52,152,219;}
			.luogusp-rst-article a{color:inherit;text-decoration:none;cursor:pointer;}
			.luogusp-rst-article .top-bar{position:fixed;top:0;left:0;right:0;box-sizing:border-box;height:3.5rem;max-height:3.5rem;z-index:100;display:flex;flex-flow:row nowrap;align-items:center;padding:.75rem;line-height:1.1;color:#262626;background:#fff;box-shadow:0 1px 3px rgba(26,26,26,.1);}
			.luogusp-rst-article .top-bar .left{display:flex;align-items:center;flex:1;min-width:0;gap:1em;}
			.luogusp-rst-article .top-bar .right{flex-shrink:0;}
			.luogusp-rst-article .top-bar .side-toggle{cursor:pointer;padding:.5rem;border-radius:.5rem;}
			.luogusp-rst-article .top-bar .side-toggle:hover,.luogusp-rst-article .top-bar .side-toggle.active{background-color:rgba(38,38,38,.1);}
			.luogusp-rst-article .top-bar .side-toggle svg{width:16px;height:16px;fill:currentColor;vertical-align:-2px;}
			.luogusp-rst-article .top-bar .header-logo{height:2rem;width:calc(64px - 1.5rem);vertical-align:middle;-webkit-user-select:none;user-select:none;}
			.luogusp-rst-article .breadcrumb{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
			.luogusp-rst-article .breadcrumb>*{padding:.25em;margin:0 .1em;border-radius:3px;color:inherit;}
			.luogusp-rst-article .breadcrumb a:hover{background-color:rgba(0,0,0,.05);}
			.luogusp-rst-article .top-bar .user-nav{display:flex;align-items:center;}
			.luogusp-rst-article .top-bar .user-nav>*{margin:0 .25em;vertical-align:middle;}
			.luogusp-rst-article .top-bar .user-nav .link{display:inline-flex;padding:.25em;border-radius:3px;color:inherit;}
			.luogusp-rst-article .top-bar .user-nav .link:hover{background-color:rgba(0,0,0,.05);}
			.luogusp-rst-article .top-bar .user-nav .link svg{width:16px;height:16px;fill:currentColor;}
			.luogusp-rst-article .top-bar .user-nav .text{margin:0 .2em;font-size:.8em;color:inherit;}
			.luogusp-rst-article .top-bar .user-nav .avatar{margin:0 1em;}
			.luogusp-rst-article .top-bar .user-nav .avatar img{width:35px;height:35px;border-radius:50%;vertical-align:middle;cursor:pointer;}
			.luogusp-rst-article .nav-search{position:relative;display:flex;align-items:center;}
			.luogusp-rst-article .nav-search .search-wrap{position:absolute;right:100%;top:0;width:0;opacity:0;overflow:hidden;margin-right:.4em;transition:all .25s ease;}
			.luogusp-rst-article .nav-search .search-wrap.show{width:10em;opacity:1;}
			.luogusp-rst-article .nav-search input{width:100%;box-sizing:border-box;font-size:.875em;line-height:1.5;padding:.25em .5em;border:1px solid #bfbfbf;border-radius:3px;}
			.luogusp-rst-article nav.lside{position:fixed;top:3.5rem;left:0;bottom:0;z-index:101;box-sizing:border-box;max-width:240px;width:240px;line-height:1.2;overflow:hidden auto;transition:left .3s ease,box-shadow .5s ease;color:#262626;background:#fff;padding:1.25em .75em;}
			.luogusp-rst-article nav.lside.drawer.hide{left:-240px;}
			.luogusp-rst-article nav.lside.drawer.show{border-radius:0 .75em .75em 0;box-shadow:0 0 1px 0 rgba(0,0,0,.5) inset,2px 0 5px 2px rgba(0,0,0,.15);}
			.luogusp-rst-article nav.lside.bar{width:64px;box-shadow:1px 0 3px rgba(26,26,26,.1);z-index:99;transition:all .25s ease-out;}
			.luogusp-rst-article nav.lside.bar:hover{width:180px;}
			.luogusp-rst-article nav.lside::-webkit-scrollbar{width:8px;height:8px;}
			.luogusp-rst-article nav.lside::-webkit-scrollbar-thumb{border-radius:8px;background:#bbb;}
			.luogusp-rst-article .nav-group{margin:.25em 0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;}
			.luogusp-rst-article .nav-group::after{content:"";display:block;margin:1em 0;border-bottom:1px solid rgba(38,38,38,.18);}
			.luogusp-rst-article .nav-group:last-child::after{display:none;}
			.luogusp-rst-article .nav-group .group-title{display:flex;align-items:center;justify-content:space-between;font-size:.875em;font-weight:700;padding:0 .67em .5em;}
			.luogusp-rst-article .nav-group ul{margin:0;padding:0;list-style:none;}
			.luogusp-rst-article .nav-group li{margin:.5em 0;cursor:pointer;color:inherit;}
			.luogusp-rst-article .nav-group li:hover{background-color:rgba(38,38,38,.1);}
			.luogusp-rst-article .nav-group li a{display:inline-block;width:100%;box-sizing:border-box;color:inherit;padding:.25em .5em;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;}
			.luogusp-rst-article .nav-group li .icon{text-align:center;margin-right:.75em;display:inline-block;width:1.5em;vertical-align:middle;}
			.luogusp-rst-article .nav-group li .icon svg{height:1.25em;width:auto;fill:currentColor;vertical-align:middle;}
			.luogusp-rst-article .nav-group li .title{vertical-align:middle;}
			.luogusp-rst-article .nav-group li .title.minor{font-size:.875em;}
			.luogusp-rst-article nav.sidebar:not(:hover) li .title{display:none;}
			.luogusp-rst-article nav.sidebar:not(:hover) li .icon{margin:0;}
			.luogusp-rst-article nav.sidebar:not(:hover) .on-expand{display:none;}
			.luogusp-rst-article .main-container{display:flex;flex-flow:column nowrap;box-sizing:content-box;padding:0;margin-top:3.5rem;min-height:calc(100vh - 3.5rem);}
			.luogusp-rst-article .main-container.lside-nav{margin-left:64px;width:calc(100% - 64px);}
			.luogusp-rst-article .main-container main{display:flex;flex-direction:column;flex:1;background:#f5f5f5;}
			.luogusp-rst-article .content-band{background:#fff;}
			@media screen and (max-width:576px){.luogusp-rst-article .main-container.lside-nav{margin-left:0;width:100%;}.luogusp-rst-article nav.lside{display:none;}.luogusp-rst-article .columba-content-wrap{min-width:unset !important;max-width:unset !important;padding-left:.5rem;padding-right:.5rem;}.luogusp-rst-article .toc-wrapper{display:none;}.luogusp-rst-article .banner-content .meta{flex-wrap:wrap;}.luogusp-rst-article .banner-content .meta>.metas{margin-top:.5em;}}
			.luogusp-rst-article .columba-content-wrap{box-sizing:border-box;width:100%;min-width:448px;max-width:1200px;margin-left:auto;margin-right:auto;padding-left:1rem;padding-right:1rem;}
			.luogusp-rst-article .wrapper{max-width:768px;}
			.luogusp-rst-article .lfe-h3{margin-top:0;margin-bottom:.5em;font-weight:700;line-height:1.2;color:#262626;font-size:1.125em;}
			.luogusp-rst-article .lfe-h4{margin-top:0;margin-bottom:.5em;font-weight:700;line-height:1.2;color:#262626;font-size:1em;}
			.luogusp-rst-article .lfe-caption{color:gray;font-size:.875em;}
			.luogusp-rst-article .banner-content{margin:.875em 0;}
			.luogusp-rst-article .banner-content .title{font-size:2.125rem;margin:.67em 0;font-weight:700;line-height:1.5;color:inherit;}
			.luogusp-rst-article .banner-content .meta{display:flex;justify-content:space-between;margin-top:.5em;}
			.luogusp-rst-article .banner-content .meta .label{color:rgba(0,0,0,.5);font-size:.875em;}
			.luogusp-rst-article .banner-content .meta>.author{display:flex;align-items:center;}
			.luogusp-rst-article .banner-content .meta>.author .avatar{width:38px;height:38px;border-radius:50%;margin-right:.75em;}
			.luogusp-rst-article .banner-content .meta>.metas{display:flex;}
			.luogusp-rst-article .banner-content .meta>.metas>*:first-child{margin-right:1.5em;}
			.luogusp-rstpage .luogu-username{display:inline-flex;align-items:center;min-width:0;}
			.luogusp-rstpage .luogu-username>*{vertical-align:baseline;}
			.luogusp-rstpage .luogu-username>*:not(:first-child){margin-left:2px;}
			.luogusp-rstpage .luogu-username>*:not(:last-child){margin-right:2px;}
			.luogusp-rstpage .luogu-username .name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.5;}
			.luogusp-rstpage .luogu-username .user-badge{font-size:.875em;}
			.luogusp-rstpage .luogu-username .user-badge span{display:inline-block;padding:0 .5em;border:1px solid;border-radius:2px;line-height:1.5;color:#fff;}
			.luogusp-rstpage .luogu-username .ccf-check svg{width:.875em;height:.875em;vertical-align:-.125em;}
			.luogusp-rst-article .article-content{position:relative;box-sizing:border-box;padding:1.5em;}
			.luogusp-rst-article .lfe-marked-wrap{display:block;overflow:hidden;box-sizing:border-box;padding:0;margin:0;}
			.luogusp-rst-article .article-content .update-info{margin:1em 0;text-align:right;color:rgba(0,0,0,.5);}
			.luogusp-rst-article .article-content .actions{box-sizing:border-box;display:flex;flex-flow:row nowrap;align-items:center;justify-content:center;}
			.luogusp-rst-article .article-content .actions.left-mode{flex-direction:column;position:fixed;top:calc(50vh - 120px);left:calc(50vw - 444px);background-color:#fff;box-shadow:0 2px 4px 0 rgba(0,0,0,.15),0 0 1px 0 rgba(0,0,0,.5) inset;border-radius:.5em;width:60px;}
			.luogusp-rst-article .main-container.lside-nav .article-content .actions.left-mode{left:calc(50vw - 412px);}
			.luogusp-rst-article .article-content .actions.left-mode>*{margin:1em 0;}
			.luogusp-rst-article .article-content .actions.left-mode.hidden{display:none;}
			.luogusp-rst-article .button-2line{display:flex;flex-direction:column;margin:0 1em;cursor:pointer;}
			.luogusp-rst-article .button-2line svg{height:20px;width:auto;fill:currentColor;display:block;margin:0 auto 6px;}
			.luogusp-rst-article .button-2line>.text{text-align:center;font-size:.75em;}
			.luogusp-rst-article .button-2line>*{color:#595959;transition:color ease .3s;}
			.luogusp-rst-article .button-2line:hover>*{color:#3498db;}
			.luogusp-rst-article .toc-wrapper{position:absolute;top:0;bottom:0;width:188px;right:-188px;}
			.luogusp-rst-article .toc{box-sizing:border-box;position:sticky;top:3.5rem;right:0;margin:0;padding:0;max-height:calc(100vh - 3.5rem);overflow:hidden auto;scrollbar-width:none;}
			.luogusp-rst-article .toc>ul{list-style:none;margin:0;padding:0;}
			.luogusp-rst-article .toc>ul>li{cursor:pointer;--indicator-margin:6px;}
			.luogusp-rst-article .toc>ul>li.title-0{--indicator-width:28px;}
			.luogusp-rst-article .toc>ul>li.title-1{--indicator-width:22px;}
			.luogusp-rst-article .toc>ul>li.title-2{--indicator-width:16px;}
			.luogusp-rst-article .toc>ul>li.title-3{--indicator-width:10px;}
			.luogusp-rst-article .toc>ul>li::before{content:"";width:var(--indicator-width);display:inline-block;height:6px;margin-right:var(--indicator-margin);border-radius:6px;box-sizing:border-box;background-color:#e8e8e8;vertical-align:middle;}
			.luogusp-rst-article .toc>ul>li>span{display:inline-block;width:calc(100% - var(--indicator-margin) - var(--indicator-width));box-sizing:border-box;font-size:.75em;vertical-align:middle;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#404040;}
			.luogusp-rst-article .toc>ul>li:hover::before,.luogusp-rst-article .toc>ul>li.active::before{background-color:#bfbfbf;}
			.luogusp-rst-article .article-comment{margin-top:30px;margin-bottom:30px;}
			.luogusp-rst-article .article-comment .section-title{margin:20px 0;font-size:18px;}
			.luogusp-rst-article .comment-filter-line{display:flex;flex-flow:row nowrap;justify-content:space-between;align-items:center;}
			.luogusp-rst-article .comment-filter-line>span:first-child{flex:1;}
			.luogusp-rst-article .combo-wrapper{position:relative;display:flex;align-items:baseline;flex:0 1 128px;cursor:pointer;}
			.luogusp-rst-article .combo-wrapper .combo-text{font-size:.875em;line-height:1.5;box-sizing:border-box;flex:1;padding:.3125em 1.5em .3125em 1em;background:#fff;border:1px solid #bfbfbf;border-radius:3px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}
			.luogusp-rst-article .combo-wrapper .arrow{display:block;margin-left:-1.3em;margin-right:1.3em;}
			.luogusp-rst-article .combo-wrapper .arrow svg{width:12px;height:16px;fill:#404040;vertical-align:-2px;}
			.luogusp-rst-article .combo-dropdown{position:absolute;top:calc(100% + 2px);left:0;right:0;z-index:1000;background:#fff;border:1px solid #eee;border-radius:2px;box-shadow:0 0 16px 1.6px rgba(0,0,0,.15);color:#333;display:none;}
			.luogusp-rst-article .combo-dropdown.show{display:block;}
			.luogusp-rst-article .combo-dropdown ul{list-style:none;margin:0;padding:0;overflow:auto;}
			.luogusp-rst-article .combo-dropdown li{padding:.4em .5em;cursor:pointer;}
			.luogusp-rst-article .combo-dropdown li:hover{background:#eee;}
			.luogusp-rst-article .l-card{display:block;background-color:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(26,26,26,.1);box-sizing:border-box;margin-bottom:20.8px;min-width:0;padding:1.3em;}
			.luogusp-rst-article .commentbox textarea{width:100%;box-sizing:border-box;height:70px;resize:vertical;font-size:14px;line-height:1.5;font-family:inherit;color:#000;padding:.3125em 1em;border:1px solid #bfbfbf;border-radius:3px;background:#fff;}
			.luogusp-rst-article .commentbox p{margin:5px 0 0;text-align:right;}
			.luogusp-rst-article .commentbox button{font-size:14px;line-height:1.5;padding:.3125em 1em;border-radius:3px;border:1px solid #3498db;vertical-align:middle;}
			.luogusp-rst-article .commentbox button.solid{color:#fff;background:#3498db;cursor:pointer;}
			.luogusp-rst-article .commentbox button.solid:hover{background:rgba(52,152,219,.9);}
			.luogusp-rst-article .commentbox button.need-login{color:#3498db;background:rgba(52,152,219,0);opacity:.65;cursor:not-allowed;}
			.luogusp-rst-article .reply-item{margin:.75em 0;padding:0;}
			.luogusp-rst-article .reply-item>.meta{display:flex;justify-content:space-between;align-items:center;font-size:.875em;padding:.75em 1.5em;background-color:#fafafa;border-radius:4px;}
			.luogusp-rst-article .reply-item>.meta .avatar{width:28px;height:28px;border-radius:50%;margin-right:.5em;}
			.luogusp-rst-article .reply-item>.meta .username{margin-right:.25em;}
			.luogusp-rst-article .reply-item>.meta .time{margin-left:.5em;color:rgba(0,0,0,.5);}
			.luogusp-rst-article .reply-item>.meta .left{display:flex;align-items:center;}
			.luogusp-rst-article .reply-item>.content{margin:.75em 0;padding:1px 1.5em;word-wrap:break-word;overflow:hidden;white-space:pre-line;}
			.luogusp-rst-article .loadmore{text-align:center;}
			.luogusp-rst-article .loadmore a{color:#3498db;}
			.luogusp-rst-article .lfe-marked{overflow-wrap:break-word;}
			.luogusp-rst-article .lfe-marked a{color:#3498db;}
			.luogusp-rst-article .lfe-marked h1{margin:1.5rem 0 1rem;font-size:2em;padding-bottom:.1em;border-bottom:solid 1px #d8d8d8;}
			.luogusp-rst-article .lfe-marked h2{margin:1.2rem 0 1rem;font-size:1.5em;padding-bottom:.1em;border-bottom:solid 1px #d8d8d8;}
			.luogusp-rst-article .lfe-marked h3{margin:1.2rem 0 1rem;font-size:1.2em;}
			.luogusp-rst-article .lfe-marked h4{margin:1rem 0;font-size:1.1em;}
			.luogusp-rst-article .lfe-marked h5{margin:1rem 0;font-size:1em;}
			.luogusp-rst-article .lfe-marked h6{margin:1rem 0;font-size:1em;color:#666;}
			.luogusp-rst-article .lfe-marked p{margin:1rem 0;}
			.luogusp-rst-article .lfe-marked img{max-width:100%;}
			.luogusp-rst-article .lfe-marked ul,.luogusp-rst-article .lfe-marked ol{padding-left:2em;}
			.luogusp-rst-article .lfe-marked li+li{margin-top:.2em;}
			.luogusp-rst-article .lfe-marked li.task-list-item{list-style-type:none;}
			.luogusp-rst-article .lfe-marked li.task-list-item>input:first-child{margin:0 .35em 0 -1.5em;padding:0;vertical-align:-.125em;}
			.luogusp-rst-article .lfe-marked hr{margin:1em 0;height:0;border:none;border-bottom:solid 1px #eee;}
			.luogusp-rst-article .lfe-marked .katex-display{overflow:auto hidden;padding:2px 0;}
			.luogusp-rst-article .lfe-marked blockquote{margin:0 0 1em;padding:.5em 1em;border-left:4px solid #d8d8d8;background:#fafafa;}
			.luogusp-rst-article .lfe-marked blockquote>:first-child{margin-top:0;}
			.luogusp-rst-article .lfe-marked blockquote>:last-child{margin-bottom:0;}
			.luogusp-rst-article .lfe-marked :not(pre)>code{display:inline;font-size:.875em;background-color:#8080801f;border-radius:6px;padding:.1em .2em;margin:0 .2em;overflow-wrap:break-word;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace;}
			.luogusp-rst-article .lfe-marked pre{background:#fafafa;border-radius:6px;padding:1em;overflow:auto;font-size:.875em;font-family:ui-monospace,Menlo,Consolas,monospace;}
			.luogusp-rst-article .lfe-marked table{width:auto;border-collapse:collapse;margin:.5em auto;}
			.luogusp-rst-article .lfe-marked th,.luogusp-rst-article .lfe-marked td{border:1px solid #d8d8d8;padding:.3em .7em;}
			.luogusp-rst-article .lfe-marked details{padding:.5em 1em;margin:1em 0 1em .2em;border-left-width:5px;border-left-style:solid;overflow:hidden;border-left-color:rgb(var(--lcolor--primary));background:#fafafa;}
			.luogusp-rst-article .lfe-marked details>summary{min-height:1em;font-weight:700;cursor:pointer;color:rgb(var(--lcolor--primary));}
			.luogusp-rst-article .lfe-marked details[open]>summary{margin-bottom:.5em;}
			.luogusp-rst-article footer{box-sizing:border-box;padding:.5em 1em;padding-top:2.5em;text-align:center;color:#595959;background:#f5f5f5;}
			.luogusp-rst-article footer>*{margin:.5em 0;}
			.luogusp-rst-article footer a{color:inherit;}
			.luogusp-rst-article footer .copyright{font-size:.875em;}
			body.luogusp-rst-paste{margin:0;background:#fff;font-size:16px;line-height:1.5;color:rgba(0,0,0,.75);font-family:-apple-system,BlinkMacSystemFont,"San Francisco","Helvetica Neue","Noto Sans","Noto Sans CJK SC","Noto Sans CJK","Source Han Sans","PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;}
			.luogusp-rst-paste a{color:#3498db;text-decoration:none;cursor:pointer;}
			.luogusp-rst-paste .lgnav{position:fixed;left:0;top:0;bottom:0;width:3.7em;background:#34495e;color:#ddd;z-index:5;display:flex;flex-direction:column;text-align:center;line-height:1.2;}
			.luogusp-rst-paste .lgnav .logo-block{background:#3498db;}
			.luogusp-rst-paste .lgnav .logo-wrap{display:block;box-sizing:border-box;padding:1em;width:3.7em;height:4em;text-align:center;overflow:hidden;}
			.luogusp-rst-paste .lgnav .logo-wrap img{max-width:100%;max-height:100%;}
			.luogusp-rst-paste .lgnav .popup-button{font-size:.8em;line-height:2em;margin-top:.2em;cursor:pointer;}
			.luogusp-rst-paste .lgnav .popup-button svg{width:1em;height:1em;fill:currentColor;vertical-align:-.125em;}
			.luogusp-rst-paste .lgnav>a{display:block;padding:.5em;color:inherit;}
			.luogusp-rst-paste .lgnav>a .icon{text-align:center;margin:0 .3em;font-size:1.1em;display:inline-block;width:1.5em;vertical-align:middle;}
			.luogusp-rst-paste .lgnav>a .icon svg{height:1em;width:auto;fill:currentColor;vertical-align:-.125em;}
			.luogusp-rst-paste .lgnav>a .text{font-size:.8em;vertical-align:middle;}
			.luogusp-rst-paste .main-container{display:flex;flex:1;flex-direction:column;min-height:100vh;margin-left:3.7em;}
			@media (max-width:576px){.luogusp-rst-paste .main-container{margin-left:0;width:100%;}.luogusp-rst-paste .lgnav{display:none;}.luogusp-rst-paste .user-nav{display:none;}.luogusp-rst-paste .bread-crumb{font-size:.875em;}}
			.luogusp-rst-paste .wrapped{padding-left:1em;padding-right:1em;}
			.luogusp-rst-paste .wrapped>*{max-width:1200px;margin-left:auto;margin-right:auto;}
			.luogusp-rst-paste .header-layout{position:relative;}
			.luogusp-rst-paste .header-layout.narrow{height:8em;}
			@media (max-width:576px){.luogusp-rst-paste .header-layout{height:auto !important;}}
			.luogusp-rst-paste .header-layout .background{position:absolute;left:0;right:0;top:0;display:block;width:100%;height:100%;z-index:0;background:linear-gradient(90deg,#232526,#414345);}
			.luogusp-rst-paste .header-layout .header{position:relative;z-index:1;color:#fff;}
			.luogusp-rst-paste .user-nav{position:absolute;right:4em;top:0;padding:.5em 1em;color:#333;background-color:rgba(255,255,255,.5);border-bottom-left-radius:5px;border-bottom-right-radius:5px;}
			.luogusp-rst-paste .user-nav nav{position:relative;}
			.luogusp-rst-paste .user-nav .search-wrap{display:inline-block;margin-right:.4em;font-size:.9em;width:0;vertical-align:middle;overflow:hidden;transition:width .15s ease;}
			.luogusp-rst-paste .user-nav .search-wrap.show{width:10em;}
			.luogusp-rst-paste .user-nav .search-wrap input{width:100%;box-sizing:border-box;padding:.2em .5em;background:rgba(255,255,255,.3);border:1px solid #ccc;border-radius:5px;line-height:1.15;font-size:inherit;}
			.luogusp-rst-paste .user-nav .icon,.luogusp-rst-paste .user-nav .icon-btn{color:#333;}
			.luogusp-rst-paste .user-nav .icon svg,.luogusp-rst-paste .user-nav .icon-btn svg{width:16px;height:16px;fill:currentColor;vertical-align:-2px;}
			.luogusp-rst-paste .user-nav .icon-btn{margin-left:.7em;}
			.luogusp-rst-paste .user-nav .login{color:#333;text-decoration:none;}
			.luogusp-rst-paste .user-nav .login span{font-size:.8em;margin-left:.5em;}
			.luogusp-rst-paste .user-nav .avatar{width:35px;height:35px;border-radius:50%;margin-left:.4em;vertical-align:middle;}
			.luogusp-rst-paste .bread-crumb{padding-top:1.5em;font-size:.8em;color:#aaa;}
			.luogusp-rst-paste .bread-crumb .link,.luogusp-rst-paste .bread-crumb .text{color:rgba(255,255,255,.75);}
			.luogusp-rst-paste .bread-crumb .link:hover{color:#fff;}
			.luogusp-rst-paste .header .lfe-h1{font-size:1.75em;font-weight:700;line-height:1.2;color:inherit;margin:.5em 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
			.luogusp-rst-paste .functional{padding-top:.8em;}
			.luogusp-rst-paste .functional .stat{float:right;}
			.luogusp-rst-paste .functional .operation{display:flex;align-items:baseline;color:#fff;}
			.luogusp-rst-paste main{flex:1;background:#efefef;}
			.luogusp-rst-paste .full-container{display:block;margin-top:2em;margin-bottom:2em;}
			.luogusp-rst-paste .full-container::after{display:block;content:"";clear:both;}
			.luogusp-rst-paste .lfe-caption{font-size:.875em;}
			.luogusp-rst-paste .card{display:block;margin-bottom:1.3em;background-color:#fff;border-radius:4px;box-shadow:rgba(26,26,26,.1) 0 1px 3px;box-sizing:border-box;padding:1.3em;}
			.luogusp-rst-paste .content-card-top{display:flex;justify-content:space-between;align-items:center;}
			.luogusp-rst-paste .content-card-top .author{display:flex;}
			@media (max-width:576px){.luogusp-rst-paste .content-card-top .author{flex-direction:column;}}
			.luogusp-rst-paste .author-margin{margin-right:1em;}
			.luogusp-rst-paste .pubbadge{display:inline-block;background:#e74c3c;color:#fff;border-radius:2px;padding:0 .5em;line-height:1.5;}
			.luogusp-rst-paste .horizon{height:2px;background-color:#e8e8e8;border:none;margin:8px 0;}
			.luogusp-rst-paste .code-card-top strong span{font-weight:700;}
			.luogusp-rst-paste .copy-btn{font-size:.8em;float:right;padding:0 5px;color:#3498db;background:rgba(52,152,219,0);border:1px solid #3498db;border-radius:3px;cursor:pointer;}
			.luogusp-rst-paste .code-card-top pre{margin:.5em 0;padding:.3em .5em;font-size:14px;font-family:monospace;background:#f8f8f8;border:1px solid #ddd;overflow:auto;}
			.luogusp-rst-paste .code-card-top pre>div{white-space:pre;}
			.luogusp-rst-paste .expand-tip{text-align:center;}
			.luogusp-rst-paste .expand-tip>span{-webkit-user-select:none;user-select:none;cursor:pointer;color:rgba(0,0,0,.3);}
			.luogusp-rst-paste .expand-tip>span:hover{color:inherit;}
			.luogusp-rst-paste .expand-tip svg{width:1em;height:1em;fill:currentColor;vertical-align:-.125em;}
			.luogusp-rst-paste .marked h1{font-size:2em;}
			.luogusp-rst-paste .marked h2{font-size:1.5em;}
			.luogusp-rst-paste .marked h3{font-size:1.17em;}
			.luogusp-rst-paste .marked h5{font-size:.83em;}
			.luogusp-rst-paste .marked h6{font-size:.67em;}
			.luogusp-rst-paste .marked h1,.luogusp-rst-paste .marked h2,.luogusp-rst-paste .marked h3,.luogusp-rst-paste .marked h4,.luogusp-rst-paste .marked h5,.luogusp-rst-paste .marked h6{margin:.5rem 0;font-weight:700;line-height:1.2;}
			.luogusp-rst-paste .marked h1,.luogusp-rst-paste .marked h2{padding-bottom:.2em;border-bottom:1px solid #eee;}
			.luogusp-rst-paste .marked p{margin:1rem 0;}
			.luogusp-rst-paste .marked img{max-width:100%;}
			.luogusp-rst-paste .marked ol,.luogusp-rst-paste .marked ul{padding-left:1.5em;}
			.luogusp-rst-paste .marked ul{list-style:outside disc;}
			.luogusp-rst-paste .marked ol{list-style:outside decimal;}
			.luogusp-rst-paste .marked hr{margin:1em 0;height:0;border:none;border-bottom:1px solid #eee;}
			.luogusp-rst-paste .marked blockquote{margin:1em 0;padding:.5em 1em;border-left:4px solid #e8e8e8;background:#fafafa;}
			.luogusp-rst-paste .marked table{border-collapse:collapse;margin:.5em 0;}
			.luogusp-rst-paste .marked th,.luogusp-rst-paste .marked td{border:1px solid #e8e8e8;padding:.3em .7em;}
			.luogusp-rst-paste .marked code,.luogusp-rst-paste .marked pre{font-family:monospace;font-size:.875em;background-color:#fafafa;border:1px solid #e8e8e8;border-radius:2px;}
			.luogusp-rst-paste .marked code{margin:0 .2em;padding:.1em .2em;white-space:nowrap;tab-size:4;}
			.luogusp-rst-paste .marked pre{margin:0;padding:1em;overflow-y:auto;}
			.luogusp-rst-paste .marked pre>code{font-size:unset;margin:0;padding:0;white-space:pre;border:none;}
			.luogusp-rst-paste .marked li code.hljs,.luogusp-rst-paste .marked p code.hljs{display:inline;}
			.luogusp-rst-paste .lgfooter{position:relative;}
			.luogusp-rst-paste .lgfooter .background{position:absolute;inset:0;background:#333;z-index:-1;}
			.luogusp-rst-paste .lgfooter .footer{position:relative;display:flex;align-items:center;color:rgba(255,255,255,.9);font-size:.875em;padding:1em;}
			.luogusp-rst-paste .lgfooter .footer a{color:rgba(255,255,255,.75);}
			.luogusp-rst-paste .lgfooter .footer a:hover{color:#fff;}
			.luogusp-rst-paste .lgfooter .logo-img{max-height:60px;}
			.luogusp-rst-paste .lgfooter .slogan{margin-left:.5em;font-size:1.3em;line-height:1.5;font-weight:700;}
			.luogusp-rst-paste .lgfooter .qr-img{margin-left:5em;max-height:60px;}
			.luogusp-rst-paste .lgfooter .info{flex:1;text-align:right;}
			.luogusp-rst-paste .lgfooter .info p{margin:1em 0;}
			@media (max-width:576px){.luogusp-rst-paste .lgfooter .logo-img,.luogusp-rst-paste .lgfooter .qr-img,.luogusp-rst-paste .lgfooter .slogan{display:none;}.luogusp-rst-paste .lgfooter .info{text-align:center;}}
		`;
    (document.head || document.documentElement).appendChild(style);
    // 拦截页无宿主样式，KaTeX 公式需要自带 CSS（与 @require 的 katex 同版本同 CDN，无新增依赖源）
    if (!document.getElementById("luogusp-rst-katex")) {
      const link = document.createElement("link");
      link.id = "luogusp-rst-katex";
      link.rel = "stylesheet";
      link.href =
        "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
      (document.head || document.documentElement).appendChild(link);
    }
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
  // 原生文章页 update-info 的「创建时间」带秒（banner 发布时间不带，勿混用）
  function rstFmtTimeSec(v) {
    const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${rstFmtTime(v)}:${p(d.getSeconds())}`;
  }
  // 相对时间（原生评论区的「N 个月前」格式）
  function rstRelTime(unixSec) {
    const s = Math.floor(Date.now() / 1000 - unixSec);
    if (!isFinite(s) || s < 0) return rstFmtTime(unixSec);
    if (s < 60) return "刚刚";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo} 个月前`;
    return `${Math.floor(mo / 12)} 年前`;
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
  // 作者等用户数据一律走国内站同源接口（owner 要求：不吃保存站/国际站的用户数据；头像也全走 .cn CDN）。
  // 接口失败（离线/风控）时由调用方回退保存站存档里的作者快照。
  const rstUserCache = new Map();
  async function rstCnUser(uid) {
    if (!uid) return null;
    if (rstUserCache.has(uid)) return rstUserCache.get(uid);
    let user = null;
    try {
      const res = await fetch(`/user/${uid}?_contentOnly=1`);
      const json = await res.json();
      user = (json && json.currentData && json.currentData.user) || null;
    } catch (e) {
      /* 回退存档快照 */
    }
    rstUserCache.set(uid, user);
    return user;
  }
  // ccfLevel 认证勾配色（洛谷通例：3~5 绿、6~7 蓝、8+ 金；<3 不显示）
  function rstCcfColor(lv) {
    if (!(lv >= 3)) return null;
    return lv >= 8 ? "#ffc116" : lv >= 6 ? "#3498db" : "#52c41a";
  }
  // 徽章边框=底色加深一档（原生取主题色深一档，此处按 88% 亮度近似，1px 边框视觉等同）
  function rstDarken(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = (x) => Math.round(x * 0.88);
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  }
  // 原生 luogu-username 组件：名字（粗体+用户名色）+自定义徽章+获奖认证勾。
  // 结构对照 www.luogu.com 实测：div.luogu-username > span>span>a + a>span(徽章) + a>svg(认证)。
  function rstUsernameEl(user, uid, opts) {
    const o = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "luogu-username" + (o.cls ? ` ${o.cls}` : "");
    const s1 = document.createElement("span");
    const s2 = document.createElement("span");
    const a = document.createElement("a");
    a.className = "name";
    a.textContent = (user && user.name) || `用户 ${uid || "?"}`;
    const color = rstUserColor(user && user.color);
    a.style.color = color;
    a.style.fontWeight = "bold";
    if (uid) {
      a.href = `/user/${uid}`;
      if (o.blank) a.target = "_blank";
    }
    s2.appendChild(a);
    s1.appendChild(s2);
    wrap.appendChild(s1);
    if (user && user.badge) {
      const ba = document.createElement("a");
      ba.className = "user-badge";
      ba.target = "_blank";
      ba.rel = "noopener";
      ba.href = "https://help.luogu.com.cn/manual/luogu/account/user-tag";
      const bs = document.createElement("span");
      bs.textContent = String(user.badge);
      bs.style.backgroundColor = color;
      bs.style.borderColor = rstDarken(color);
      ba.appendChild(bs);
      wrap.appendChild(ba);
    }
    const ccf = rstCcfColor(user && user.ccfLevel);
    if (ccf) {
      const ca = document.createElement("a");
      ca.className = "ccf-check";
      ca.target = "_blank";
      ca.rel = "noopener";
      ca.href = "https://help.luogu.com.cn/manual/luogu/account/award-certify";
      ca.innerHTML = `<svg viewBox="${RST_BADGE_CHECK.vb}" aria-hidden="true"><path fill="${ccf}" d="${RST_BADGE_CHECK.secondary}"/><path fill="#fff" d="${RST_BADGE_CHECK.primary}"/></svg>`;
      wrap.appendChild(ca);
    }
    return wrap;
  }

  // 图标与素材：path 逐字抄自洛谷真实页面（勿改）。RST_ICONS=文章互动条；RST_COL=columba 顶栏/侧栏；RST_LFE=旧版左导航/头部。
  const RST_ICONS = {
    star: {
      vb: "0 0 576 512",
      d: "M288.1-32c9 0 17.3 5.1 21.4 13.1L383 125.3 542.9 150.7c8.9 1.4 16.3 7.7 19.1 16.3s.5 18-5.8 24.4L441.7 305.9 467 465.8c1.4 8.9-2.3 17.9-9.6 23.2s-17 6.1-25 2L288.1 417.6 143.8 491c-8 4.1-17.7 3.3-25-2s-11-14.2-9.6-23.2L134.4 305.9 20 191.4c-6.4-6.4-8.6-15.8-5.8-24.4s10.1-14.9 19.1-16.3l159.9-25.4 73.6-144.2c4.1-8 12.4-13.1 21.4-13.1zm0 76.8L230.3 158c-3.5 6.8-10 11.6-17.6 12.8l-125.5 20 89.8 89.9c5.4 5.4 7.9 13.1 6.7 20.7l-19.8 125.5 113.3-57.6c6.8-3.5 14.9-3.5 21.8 0l113.3 57.6-19.8-125.5c-1.2-7.6 1.3-15.3 6.7-20.7l89.8-89.9-125.5-20c-7.6-1.2-14.1-6-17.6-12.8L288.1 44.8z",
    },
    thumb: {
      vb: "0 0 512 512",
      d: "M171.5 38.8C192.3 4 236.5-10 274 7.6l7.2 3.8C316 32.3 330 76.5 312.4 114l0 0-14.1 30 109.7 0 7.4 .4c36.3 3.7 64.6 34.4 64.6 71.6 0 13.2-3.6 25.4-9.8 36 6.1 10.6 9.7 22.8 9.8 36 0 18.3-6.9 34.8-18 47.5 1.3 5.3 2 10.8 2 16.5 0 25.1-12.9 47-32.2 59.9-1.9 35.5-29.4 64.2-64.4 67.7l-7.4 .4-104.1 0c-18 0-35.9-3.4-52.6-9.9l-7.1-3-.7-.3-6.6-3.2-.7-.3-12.2-6.5c-12.3-6.5-23.3-14.7-32.9-24.1-4.1 26.9-27.3 47.4-55.3 47.4l-32 0c-30.9 0-56-25.1-56-56L0 200c0-30.9 25.1-56 56-56l32 0c10.8 0 20.9 3.1 29.5 8.5l50.1-106.5 .6-1.2 2.7-5 .6-.9zM56 192c-4.4 0-8 3.6-8 8l0 224c0 4.4 3.6 8 8 8l32 0c4.4 0 8-3.6 8-8l0-224c0-4.4-3.6-8-8-8l-32 0zM253.6 51c-14.8-6.9-32.3-1.6-40.7 12l-2.2 4-56.8 120.9c-3.5 7.5-5.5 15.5-6 23.7l-.1 4.2 0 112.9 .2 7.9c2.4 32.7 21.4 62.1 50.7 77.7l11.5 6.1 6.3 3.1c12.4 5.6 25.8 8.5 39.4 8.5l104.1 0 2.4-.1c12.1-1.2 21.6-11.5 21.6-23.9l-.2-2.6c-.1-.9-.2-1.7-.4-2.6-2.7-12.1 4.3-24.2 16-28 9.7-3.1 16.6-12.2 16.6-22.8 0-4.3-1.1-8.2-3.1-11.8-6.3-11.1-2.8-25.2 8-32 6.8-4.3 11.2-11.8 11.2-20.2 0-7.1-3.1-13.5-8.2-18-5.2-4.6-8.2-11.1-8.2-18s3-13.4 8.2-18c5.1-4.5 8.2-10.9 8.2-18l-.1-2.4c-1.1-11.3-10.1-20.3-21.4-21.4l-2.4-.1-147.5 0c-8.2 0-15.8-4.2-20.2-11.1-4.4-6.9-5-15.7-1.5-23.1L269 93.6c7-15 1.4-32.7-12.5-41L253.6 51z",
    },
    frown: {
      vb: "0 0 512 512",
      d: "M464 256a208 208 0 1 0 -416 0 208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zM197.5 382c-7.7 10.8-22.7 13.2-33.5 5.5s-13.2-22.7-5.5-33.5c21.7-30.2 57.3-50 97.5-50s75.7 19.8 97.5 50c7.7 10.8 5.3 25.8-5.5 33.5s-25.8 5.3-33.5-5.5c-13.1-18.2-34.4-30-58.5-30s-45.4 11.8-58.5 30zM144 208a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm192-32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z",
    },
  };
  const RST_COL = {
    home: { vb: "0 0 512 512", d: "M240 6.1c9.1-8.2 22.9-8.2 32 0l232 208c9.9 8.8 10.7 24 1.8 33.9s-24 10.7-33.9 1.8l-8-7.2 0 205.3c0 35.3-28.7 64-64 64l-288 0c-35.3 0-64-28.7-64-64l0-205.3-8 7.2c-9.9 8.8-25 8-33.9-1.8s-8-25 1.8-33.9L240 6.1zm16 50.1L96 199.7 96 448c0 8.8 7.2 16 16 16l48 0 0-104c0-39.8 32.2-72 72-72l48 0c39.8 0 72 32.2 72 72l0 104 48 0c8.8 0 16-7.2 16-16l0-248.3-160-143.4zM208 464l96 0 0-104c0-13.3-10.7-24-24-24l-48 0c-13.3 0-24 10.7-24 24l0 104z" },
    tiku: { vb: "0 0 448 512", d: "M88 0C39.4 0 0 39.4 0 88L0 432c0 44.2 35.8 80 80 80l344 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-8 0 0-76.1C435.3 375 448 353 448 328l0-256c0-39.8-32.2-72-72-72L88 0zM368 400l0 64-288 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l288 0zM80 352c-11.4 0-22.2 2.4-32 6.7L48 88c0-22.1 17.9-40 40-40l288 0c13.3 0 24 10.7 24 24l0 256c0 13.3-10.7 24-24 24L80 352zm48-200c0 13.3 10.7 24 24 24l176 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-176 0c-13.3 0-24 10.7-24 24zm24 72c-13.3 0-24 10.7-24 24s10.7 24 24 24l176 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-176 0z" },
    wangxiao: { vb: "0 0 576 512", d: "M318.8 38.1C309 34.1 298.6 32 288 32s-21 2.1-30.8 6.1L14.8 137.9C5.8 141.6 0 150.3 0 160L0 456c0 13.3 10.7 24 24 24s24-10.7 24-24l0-260.2 48 19.8 0 168.5c0 53 86 96 192 96s192-43 192-96l0-168.5 81.2-33.4c9-3.7 14.8-12.4 14.8-22.1s-5.8-18.4-14.8-22.1L318.8 38.1zM144 384l0-148.7 113.2 46.6c9.8 4 20.2 6.1 30.8 6.1s21-2.1 30.8-6.1L432 235.3 432 384c0 .1 0 .1 0 .3s-.1 .4-.3 .9c-.4 .9-1.3 2.7-3.4 5.2-4.4 5.2-12.6 11.9-26 18.6-26.8 13.4-67.1 23-114.3 23s-87.5-9.7-114.3-23c-13.4-6.7-21.6-13.4-26-18.6-2.1-2.5-3-4.3-3.4-5.2-.2-.5-.3-.8-.3-.9s0-.2 0-.3zM87.2 160L275.5 82.5c4-1.6 8.2-2.5 12.5-2.5s8.5 .8 12.5 2.5L488.8 160 300.5 237.5c-4 1.6-8.2 2.5-12.5 2.5s-8.5-.8-12.5-2.5L87.2 160z" },
    tidan: { vb: "0 0 384 512", d: "M152 96l80 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-80 0c-13.3 0-24 10.7-24 24s10.7 24 24 24zm0 48c-37.1 0-67.6-28-71.6-64L64 80c-8.8 0-16 7.2-16 16l0 352c0 8.8 7.2 16 16 16l256 0c8.8 0 16-7.2 16-16l0-352c0-8.8-7.2-16-16-16l-16.4 0c-4 36-34.5 64-71.6 64l-80 0zM232 0c25 0 47 12.7 59.9 32L320 32c35.3 0 64 28.7 64 64l0 352c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 96C0 60.7 28.7 32 64 32l28.1 0C105 12.7 127 0 152 0l80 0zM171.2 193.1c8.2 6.7 9.5 18.8 2.8 27l-45.3 56c-3.7 4.5-9.2 7.1-15 7.1s-11.3-2.7-14.9-7.2L73.9 244.9c-6.6-8.3-5.3-20.4 3-27s20.4-5.3 27 3l10 12.5 30.3-37.5c6.7-8.2 18.8-9.5 27-2.8zM192 256c0-13.3 10.7-24 24-24l64 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-64 0c-13.3 0-24-10.7-24-24zm-16 96c0-13.3 10.7-24 24-24l80 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-80 0c-13.3 0-24-10.7-24-24zm-64-32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z" },
    bisai: { vb: "0 0 512 512", d: "M488 56c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 400c0 13.3 10.7 24 24 24s24-10.7 24-24l0-400zM360 128c-13.3 0-24 10.7-24 24l0 304c0 13.3 10.7 24 24 24s24-10.7 24-24l0-304c0-13.3-10.7-24-24-24zM280 248c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 208c0 13.3 10.7 24 24 24s24-10.7 24-24l0-208zM152 320c-13.3 0-24 10.7-24 24l0 112c0 13.3 10.7 24 24 24s24-10.7 24-24l0-112c0-13.3-10.7-24-24-24zM48 384c-13.3 0-24 10.7-24 24l0 48c0 13.3 10.7 24 24 24s24-10.7 24-24l0-48c0-13.3-10.7-24-24-24z" },
    jilu: { vb: "0 0 576 512", d: "M352.4 54l0 138 138 0C473 124.6 419.9 71.4 352.4 54zm-144 210l0-173.1c-74.6 26.4-128 97.5-128 181.1 0 106 86 192 192 192 24.6 0 48-4.6 69.5-12.9L225 309.9c-10.7-12.9-16.6-29.2-16.6-45.9zm333.9-55.9c2.3 17.5-12.2 31.9-29.9 31.9l-176 0c-17.7 0-32-14.3-32-32l0-176c0-17.7 14.4-32.2 31.9-29.9 107 14.2 191.8 99 206 206zM256.4 66.7l0 197.3c0 5.6 2 11 5.5 15.3L394 438.7c11.7 14.1 9.2 35.4-6.9 44.1-34.1 18.6-73.2 29.2-114.7 29.2-132.5 0-240-107.5-240-240 0-115.5 81.5-211.9 190.2-234.8 18.1-3.8 33.8 11 33.8 29.5zM541.7 288c18.5 0 33.3 15.7 29.5 33.8-10.2 48.4-35 91.4-69.6 124.2-12.3 11.7-31.6 9.2-42.4-3.9L374.9 340.4c-17.3-20.9-2.4-52.4 24.6-52.4l142.2 0z" },
    taolun: { vb: "0 0 576 512", d: "M76.2 258.7c6.1-15.2 4-32.6-5.6-45.9-14.5-20.1-22.6-43.7-22.6-68.8 0-66.8 60.5-128 144-128s144 61.2 144 128-60.5 128-144 128c-15.9 0-31.1-2.3-45.3-6.5-10.3-3.1-21.4-2.5-31.4 1.5l-50.4 20.2 11.4-28.5zM0 144c0 35.8 11.6 69.1 31.7 96.8L1.9 315.2c-1.3 3.2-1.9 6.6-1.9 10 0 14.8 12 26.8 26.8 26.8 3.4 0 6.8-.7 10-1.9l96.3-38.5c18.6 5.5 38.4 8.4 58.9 8.4 106 0 192-78.8 192-176S298-32 192-32 0 46.8 0 144zM384 512c20.6 0 40.3-3 58.9-8.4l96.3 38.5c3.2 1.3 6.6 1.9 10 1.9 14.8 0 26.8-12 26.8-26.8 0-3.4-.7-6.8-1.9-10l-29.7-74.4c20-27.8 31.7-61.1 31.7-96.8 0-82.4-61.7-151.5-145-170.7-1.6 16.3-5.1 31.9-10.1 46.9 63.9 14.8 107.2 67.3 107.2 123.9 0 25.1-8.1 48.7-22.6 68.8-9.6 13.3-11.7 30.6-5.6 45.9l11.4 28.5-50.4-20.2c-10-4-21.1-4.5-31.4-1.5-14.2 4.2-29.4 6.5-45.3 6.5-72.2 0-127.1-45.7-140.7-101.2-15.6 3.2-31.7 5-48.1 5.2 16.4 81.9 94.7 144 188.8 144z" },
    zhuanlan: { vb: "0 0 512 512", d: "M168 80c-13.3 0-24 10.7-24 24l0 304c0 8.4-1.4 16.5-4.1 24L440 432c13.3 0 24-10.7 24-24l0-304c0-13.3-10.7-24-24-24L168 80zM72 480c-39.8 0-72-32.2-72-72L0 112C0 98.7 10.7 88 24 88s24 10.7 24 24l0 296c0 13.3 10.7 24 24 24s24-10.7 24-24l0-304c0-39.8 32.2-72 72-72l272 0c39.8 0 72 32.2 72 72l0 304c0 39.8-32.2 72-72 72L72 480zM192 152c0-13.3 10.7-24 24-24l48 0c13.3 0 24 10.7 24 24l0 48c0 13.3-10.7 24-24 24l-48 0c-13.3 0-24-10.7-24-24l0-48zm152 24l48 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-48 0c-13.3 0-24-10.7-24-24s10.7-24 24-24zM216 256l176 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-176 0c-13.3 0-24-10.7-24-24s10.7-24 24-24zm0 80l176 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-176 0c-13.3 0-24-10.7-24-24s10.7-24 24-24z" },
    search: { vb: "0 0 512 512", d: "M368 208a160 160 0 1 0 -320 0 160 160 0 1 0 320 0zM337.1 371.1C301.7 399.2 256.8 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0 416 93.1 416 208c0 48.8-16.8 93.7-44.9 129.1L505 471c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0L337.1 371.1z" },
    mail: { vb: "0 0 512 512", d: "M61.4 64C27.5 64 0 91.5 0 125.4 0 126.3 0 127.1 .1 128L0 128 0 384c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-256-.1 0c0-.9 .1-1.7 .1-2.6 0-33.9-27.5-61.4-61.4-61.4L61.4 64zM464 192.3L464 384c0 8.8-7.2 16-16 16L64 400c-8.8 0-16-7.2-16-16l0-191.7 154.8 117.4c31.4 23.9 74.9 23.9 106.4 0L464 192.3zM48 125.4C48 118 54 112 61.4 112l389.2 0c7.4 0 13.4 6 13.4 13.4 0 4.2-2 8.2-5.3 10.7L280.2 271.5c-14.3 10.8-34.1 10.8-48.4 0L53.3 136.1c-3.3-2.5-5.3-6.5-5.3-10.7z" },
    bell: { vb: "0 0 448 512", d: "M224 0c-13.3 0-24 10.7-24 24l0 9.7C118.6 45.3 56 115.4 56 200l0 14.5c0 37.7-10 74.7-29 107.3L5.1 359.2C1.8 365 0 371.5 0 378.2 0 399.1 16.9 416 37.8 416l372.4 0c20.9 0 37.8-16.9 37.8-37.8 0-6.7-1.8-13.3-5.1-19L421 321.7c-19-32.6-29-69.6-29-107.3l0-14.5c0-84.6-62.6-154.7-144-166.3l0-9.7c0-13.3-10.7-24-24-24zM392.4 368l-336.9 0 12.9-22.1C91.7 306 104 260.6 104 214.5l0-14.5c0-66.3 53.7-120 120-120s120 53.7 120 120l0 14.5c0 46.2 12.3 91.5 35.5 131.4L392.4 368zM156.1 464c9.9 28 36.6 48 67.9 48s58-20 67.9-48l-135.8 0z" },
    pen: { vb: "0 0 512 512", d: "M441.3 59.1L453.2 71c9.4 9.4 9.4 24.6 0 33.9l-21.1 21.1-45.7-45.7 20.8-21.1c9.4-9.5 24.6-9.5 34.1-.1zM232 236.8L352.7 114.5 398.2 160 276.7 281.6c-3.3 3.3-7.5 5.6-12 6.5l-49.5 10.4 10.4-49.7c.9-4.5 3.2-8.7 6.4-11.9zM373.1 25.5L197.8 203.1c-9.7 9.8-16.4 22.3-19.2 35.8l-18 85.7c-1.7 7.9 .8 16.2 6.5 21.9s14 8.2 21.9 6.5l85.5-17.9c13.7-2.9 26.2-9.7 36.1-19.6L487.2 138.9c28.1-28.1 28.1-73.7 0-101.8L475.3 25.2C447-3.1 401.2-2.9 373.1 25.5zM307 13.2C290.6 9.8 273.5 8 256.1 8 119.2 8 8.1 119 8.1 256s111 248 248 248c13.3 0 24-10.7 24-24s-10.7-24-24-24c-110.5 0-200-89.5-200-200s89.5-200 200-200c2.9 0 5.7 .1 8.5 .2l42.3-43zM456 249.3c.1 2.2 .1 4.4 .1 6.7 0 57.4-46.6 104-104 104-13.3 0-24 10.7-24 24s10.7 24 24 24c83.9 0 152-68.1 152-152 0-17.1-1.7-33.7-5-49.8L456 249.3z" },
    sortArrow: { vb: "0 0 384 512", d: "M209.5 369c-9.4 9.4-24.6 9.4-33.9 0L15.5 209c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l143 143 143-143c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-160 160z" },
    sidebar: { vb: "0 0 512 512", d: "M448 448l-192 0 0-384 192 0c35.3 0 64 28.7 64 64l0 256c0 35.3-28.7 64-64 64zM64 64l144 0 0 384-144 0c-35.3 0-64-28.7-64-64L0 128C0 92.7 28.7 64 64 64zm8 64c-13.3 0-24 10.7-24 24s10.7 24 24 24l64 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-64 0zM48 240c0 13.3 10.7 24 24 24l64 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-64 0c-13.3 0-24 10.7-24 24zm24 64c-13.3 0-24 10.7-24 24s10.7 24 24 24l64 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-64 0z" },
  };
  // 获奖认证勾（fa-badge-check 双色：底=按 ccfLevel 配色，勾=白）
  const RST_BADGE_CHECK = {
    vb: "0 0 512 512",
    secondary:
      "M0 256C0 292.8 20.7 324.8 51.1 340.9 41 373.8 49 411 75 437s63.3 34 96.1 23.9C187.2 491.3 219.2 512 256 512s68.8-20.7 84.9-51.1C373.8 471 411 463 437 437s34-63.3 23.9-96.1C491.3 324.8 512 292.8 512 256s-20.7-68.8-51.1-84.9C471 138.2 463 101 437 75s-63.3-34-96.1-23.9C324.8 20.7 292.8 0 256 0s-68.8 20.7-84.9 51.1C138.2 41 101 49 75 75s-34 63.3-23.9 96.1C20.7 187.2 0 219.2 0 256zm152.3 41.6c-9.2-9.5-9-24.7 .6-33.9 9.5-9.2 24.7-8.9 33.9 .6l35.8 37 106.1-145.8c7.8-10.7 22.8-13.1 33.5-5.3 10.7 7.8 13.1 22.8 5.3 33.5L244.7 352.7c-4.2 5.7-10.7 9.4-17.8 9.8-7.1 .5-14-2.2-18.9-7.3l-55.7-57.6z",
    primary:
      "M328.7 155.5c7.8-10.7 22.8-13.1 33.5-5.3 10.7 7.8 13.1 22.8 5.3 33.5L244.7 352.7c-4.2 5.7-10.7 9.4-17.8 9.8-7.1 .5-14-2.2-18.9-7.3l-55.7-57.6c-9.2-9.5-9-24.7 .6-33.9 9.5-9.2 24.7-8.9 33.9 .6l35.8 37 106.1-145.8z",
  };
  const RST_LFE = {
    popup: { vb: "0 0 512 512", d: "M470.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L402.7 256 265.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160zm-352 160l160-160c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L210.7 256 73.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0z" },
    tiku: { vb: "0 0 448 512", d: "M96 0C43 0 0 43 0 96V416c0 53 43 96 96 96H384h32c17.7 0 32-14.3 32-32s-14.3-32-32-32V384c17.7 0 32-14.3 32-32V32c0-17.7-14.3-32-32-32H384 96zm0 384H352v64H96c-17.7 0-32-14.3-32-32s14.3-32 32-32zm32-240c0-8.8 7.2-16 16-16H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16zm16 48H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16s7.2-16 16-16z" },
    tidan: { vb: "0 0 384 512", d: "M192 0c-41.8 0-77.4 26.7-90.5 64H64C28.7 64 0 92.7 0 128V448c0 35.3 28.7 64 64 64H320c35.3 0 64-28.7 64-64V128c0-35.3-28.7-64-64-64H282.5C269.4 26.7 233.8 0 192 0zm0 64a32 32 0 1 1 0 64 32 32 0 1 1 0-64zm-4.7 132.7c6.2 6.2 6.2 16.4 0 22.6l-64 64c-6.2 6.2-16.4 6.2-22.6 0l-32-32c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0L112 249.4l52.7-52.7c6.2-6.2 16.4-6.2 22.6 0zM192 272c0-8.8 7.2-16 16-16h96c8.8 0 16 7.2 16 16s-7.2 16-16 16H208c-8.8 0-16-7.2-16-16zm-16 80H304c8.8 0 16 7.2 16 16s-7.2 16-16 16H176c-8.8 0-16-7.2-16-16s7.2-16 16-16zM72 368a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z" },
    bisai: { vb: "0 0 640 512", d: "M576 0c17.7 0 32 14.3 32 32V480c0 17.7-14.3 32-32 32s-32-14.3-32-32V32c0-17.7 14.3-32 32-32zM448 96c17.7 0 32 14.3 32 32V480c0 17.7-14.3 32-32 32s-32-14.3-32-32V128c0-17.7 14.3-32 32-32zM352 224V480c0 17.7-14.3 32-32 32s-32-14.3-32-32V224c0-17.7 14.3-32 32-32s32 14.3 32 32zM192 288c17.7 0 32 14.3 32 32V480c0 17.7-14.3 32-32 32s-32-14.3-32-32V320c0-17.7 14.3-32 32-32zM96 416v64c0 17.7-14.3 32-32 32s-32-14.3-32-32V416c0-17.7 14.3-32 32-32s32 14.3 32 32z" },
    taolun: { vb: "0 0 640 512", d: "M208 352c114.9 0 208-78.8 208-176S322.9 0 208 0S0 78.8 0 176c0 38.6 14.7 74.3 39.6 103.4c-3.5 9.4-8.7 17.7-14.2 24.7c-4.8 6.2-9.7 11-13.3 14.3c-1.8 1.6-3.3 2.9-4.3 3.7c-.5 .4-.9 .7-1.1 .8l-.2 .2 0 0 0 0C1 327.2-1.4 334.4 .8 340.9S9.1 352 16 352c21.8 0 43.8-5.6 62.1-12.5c9.2-3.5 17.8-7.4 25.3-11.4C134.1 343.3 169.8 352 208 352zM448 176c0 112.3-99.1 196.9-216.5 207C255.8 457.4 336.4 512 432 512c38.2 0 73.9-8.7 104.7-23.9c7.5 4 16 7.9 25.2 11.4c18.3 6.9 40.3 12.5 62.1 12.5c6.9 0 13.1-4.5 15.2-11.1c2.1-6.6-.2-13.8-5.8-17.9l0 0 0 0-.2-.2c-.2-.2-.6-.4-1.1-.8c-1-.8-2.5-2-4.3-3.7c-3.6-3.3-8.5-8.1-13.3-14.3c-5.5-7-10.7-15.4-14.2-24.7c24.9-29 39.6-64.7 39.6-103.4c0-92.8-84.9-168.9-192.6-175.5c.4 5.1 .6 10.3 .6 15.5z" },
    zhuanlan: { vb: "0 0 512 512", d: "M96 96c0-35.3 28.7-64 64-64H448c35.3 0 64 28.7 64 64V416c0 35.3-28.7 64-64 64H80c-44.2 0-80-35.8-80-80V128c0-17.7 14.3-32 32-32s32 14.3 32 32V400c0 8.8 7.2 16 16 16s16-7.2 16-16V96zm64 24v80c0 13.3 10.7 24 24 24H296c13.3 0 24-10.7 24-24V120c0-13.3-10.7-24-24-24H184c-13.3 0-24 10.7-24 24zm208-8c0 8.8 7.2 16 16 16h48c8.8 0 16-7.2 16-16s-7.2-16-16-16H384c-8.8 0-16 7.2-16 16zm0 96c0 8.8 7.2 16 16 16h48c8.8 0 16-7.2 16-16s-7.2-16-16-16H384c-8.8 0-16 7.2-16 16zM160 304c0 8.8 7.2 16 16 16H432c8.8 0 16-7.2 16-16s-7.2-16-16-16H176c-8.8 0-16 7.2-16 16zm0 96c0 8.8 7.2 16 16 16H432c8.8 0 16-7.2 16-16s-7.2-16-16-16H176c-8.8 0-16 7.2-16 16z" },
    search: { vb: "0 0 512 512", d: "M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z" },
    mail: { vb: "0 0 512 512", d: "M48 64C21.5 64 0 85.5 0 112c0 15.1 7.1 29.3 19.2 38.4L236.8 313.6c11.4 8.5 27 8.5 38.4 0L492.8 150.4c12.1-9.1 19.2-23.3 19.2-38.4c0-26.5-21.5-48-48-48H48zM0 176V384c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V176L294.4 339.2c-22.8 17.1-54 17.1-76.8 0L0 176z" },
    bell: { vb: "0 0 448 512", d: "M224 0c-17.7 0-32 14.3-32 32V51.2C119 66 64 130.6 64 208v18.8c0 47-17.3 92.4-48.5 127.6l-7.4 8.3c-8.4 9.4-10.4 22.9-5.3 34.4S19.4 416 32 416H416c12.6 0 24-7.4 29.2-18.9s3.1-25-5.3-34.4l-7.4-8.3C401.3 319.2 384 273.9 384 226.8V208c0-77.4-55-142-128-156.8V32c0-17.7-14.3-32-32-32zm45.3 493.3c12-12 18.7-28.3 18.7-45.3H224 160c0 17 6.7 33.3 18.7 45.3s28.3 18.7 45.3 18.7s33.3-6.7 45.3-18.7z" },
    chevronDown: { vb: "0 0 512 512", d: "M267.3 395.3c-6.2 6.2-16.4 6.2-22.6 0l-192-192c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0L256 361.4 436.7 180.7c6.2-6.2 16.4-6.2 22.6 0s6.2 16.4 0 22.6l-192 192z" },
    chevronUp: { vb: "0 0 512 512", d: "M244.7 116.7c6.2-6.2 16.4-6.2 22.6 0l192 192c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0L256 150.6 75.3 331.3c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6l192-192z" },
    logoUrl: "https://fecdn.luogu.com.cn/luogu/logo-single.png",
    qrUrl: "https://fecdn.luogu.com.cn/luogu/wechat_qr.png",
  };
  // columba 顶栏彩色 logo（白顶栏用彩色版，非旧深色主题的白色蒙版）
  const RST_COL_LOGO =
    "https://fecdn.luogu.com.cn/columba/static.325908fec383795b.logo-single-color.svg";
  function rstIconSvg(icon) {
    return `<svg viewBox="${icon.vb}" aria-hidden="true"><path d="${icon.d}"/></svg>`;
  }

  // 当前登录用户（页头头像用）；拦截页无数据 → 拉首页 lentille JSON
  let rstViewerCache;
  async function rstViewer() {
    if (rstViewerCache !== undefined) return rstViewerCache;
    try {
      const res = await fetch("/", {
        headers: { "x-lentille-request": "content-only" },
      });
      const json = await res.json();
      rstViewerCache =
        json && json.user && json.user.uid ? { uid: json.user.uid } : null;
    } catch (e) {
      rstViewerCache = null;
    }
    return rstViewerCache;
  }

  // 加载动效覆盖层：检测命中后立即出现（盖住拦截页），渲染完成随 body 重写消失
  function rstShowLoader(text) {
    injectRstStyle();
    let el = document.getElementById("luogusp-rst-loader");
    if (!el) {
      el = document.createElement("div");
      el.id = "luogusp-rst-loader";
      el.className = "luogusp-rst-loader";
      el.innerHTML =
        '<div class="luogusp-rst-spinner"></div><div class="msg">加载中…</div>';
      (document.body || document.documentElement).appendChild(el);
    }
    el.querySelector(".msg").textContent = text || "加载中…";
  }
  function rstHideLoader() {
    const el = document.getElementById("luogusp-rst-loader");
    if (el) el.remove();
  }
  function rstBuildFailure(info, reason) {
    document.title =
      (info.type === "article" ? "文章" : "云剪贴板") + " - 洛谷";
    document.body.className = "luogusp-rst-plain luogusp-rst-fadein";
    document.body.innerHTML = `
			<div class="luogusp-rst-plaincard"><h1 style="font-size:20px;margin:0 0 10px;">未能获取内容</h1>
			<p></p>
			<p>可能原因：内容未公开、未通过审核，或保存站暂时不可用。</p>
			<p><a href="${info.origUrl}" rel="noopener noreferrer">前往国际站查看原文 →</a></p>
			<p class="luogusp-rst-note">此页面由 LuoguSP 生成 · 数据来源：洛谷保存站</p></div>`;
    document.querySelector(".luogusp-rst-plaincard p").textContent =
      String(reason);
  }

  // 通用收尾：申请更新链接接线（作者区/头像由各页面构建时直填）
  function rstFillCommon(info) {
    const refresh = document.querySelector(".luogusp-rst-refresh");
    if (refresh)
      refresh.addEventListener("click", (e) => {
        e.preventDefault();
        rstManualRefresh(info);
      });
  }
  // columba 侧栏（钉栏 bar / 抽屉 drawer 双模式共用一套 DOM，换类切换；条目=登录态实测清单，
  // 登录时多一项「评测记录」。更多功能/相关链接两组带 on-expand（钉栏未 hover 时隐藏）。
  function rstColSidebarHtml(viewer) {
    const g1 = [
      ["/", RST_COL.home, "主页"],
      ["/problem/list", RST_COL.tiku, "题库"],
      ["https://class.luogu.com.cn", RST_COL.wangxiao, "网校"],
      ["/training/list", RST_COL.tidan, "训练题单"],
      ["/contest/list", RST_COL.bisai, "比赛"],
    ];
    if (viewer)
      g1.push([`/record/list?user=${viewer.uid}`, RST_COL.jilu, "评测记录"]);
    const g2 = [
      ["/discuss", RST_COL.taolun, "讨论区"],
      ["/article", RST_COL.zhuanlan, "文章广场"],
    ];
    const more = [
      ["/image", "图片上传"],
      ["/paste", "云剪贴板"],
      ["/theme/list", "主题商店"],
      ["/ranking", "咕值排名"],
      ["/ranking/elo", "等级分排名"],
      ["https://ti.luogu.com.cn/", "洛谷有题"],
      ["/ticket", "工单/反馈"],
    ];
    const links = [
      ["https://help.luogu.com.cn", "帮助中心"],
      ["https://help.luogu.com.cn/contact-us", "联系我们"],
      ["https://help.luogu.com.cn/rules/community/", "社区规则"],
      ["/judgement", "陶片放逐"],
      ["/judgement/admins", "管理名单"],
    ];
    const iconLi = ([href, ic, title]) =>
      `<li><a href="${href}"><span class="icon">${rstIconSvg(ic)}</span><span class="title">${title}</span></a></li>`;
    const minorLi = ([href, title]) =>
      `<li><a href="${href}"><span class="title minor">${title}</span></a></li>`;
    const group = (inner, title, expand) =>
      `<div class="nav-group${expand ? " on-expand" : ""}">${title ? `<span class="group-title"><span class="title">${title}</span></span>` : ""}<ul>${inner}</ul></div>`;
    return (
      `<nav class="lside nav-scrollbar">` +
      group(g1.map(iconLi).join(""), "", false) +
      group(g2.map(iconLi).join(""), "", false) +
      group(more.map(minorLi).join(""), "更多功能", true) +
      group(links.map(minorLi).join(""), "相关链接", true) +
      `</nav>`
    );
  }
  // 侧栏钉住偏好（原生偏好存服务端读不到；默认钉住=登录用户常态，切换后本地持久化）
  const RST_PIN_KEY = `${STORAGE_PREFIX}rstSidebarPinned`;
  function rstSidebarPinned() {
    try {
      return localStorage.getItem(RST_PIN_KEY) !== "0";
    } catch (e) {
      return true;
    }
  }
  function rstApplySidebarMode(pinned, drawerShown) {
    const nav = document.querySelector(".luogusp-rst-article nav.lside");
    const mc = document.querySelector(".luogusp-rst-article .main-container");
    const toggle = document.querySelector(".luogusp-rst-article .side-toggle");
    if (!nav || !mc) return;
    nav.className = pinned
      ? "sidebar lside bar hide nav-scrollbar"
      : `lside drawer ${drawerShown ? "show" : "hide"} nav-scrollbar`;
    mc.classList.toggle("lside-nav", pinned);
    if (toggle) toggle.classList.toggle("active", pinned || drawerShown);
  }
  // 互动按钮：计数>0 显示数字，否则显示文字（原生行为）；存档只读，点按无操作
  function rstActionButtonsHtml(data) {
    const num = (n, label) => (n > 0 ? String(n) : label);
    return `
			<div class="button-2line" title="收藏（存档只读，请前往国际站原文）">${rstIconSvg(RST_ICONS.star)}<span class="text">${num(Number(data.favorCount) || 0, "收藏")}</span></div>
			<div class="button-2line" title="点赞（存档只读，请前往国际站原文）">${rstIconSvg(RST_ICONS.thumb)}<span class="text">${num(Number(data.upvote) || 0, "点赞")}</span></div>
			<div class="button-2line" title="不推荐（存档只读，请前往国际站原文）">${rstIconSvg(RST_ICONS.frown)}<span class="text">不推荐</span></div>`;
  }
  // 文章页：1:1 复刻 columba 现行版式（白顶栏+侧栏双模式+banner+白色通栏正文带+内联/左浮互动条+TOC+评论+页脚）
  function rstBuildArticlePage(info, data, viewer, author) {
    document.title = `${data.title || "文章"} - 洛谷专栏`;
    document.documentElement.scrollTop = 0;
    document.body.className =
      "luogusp-rstpage luogusp-rst-article luogusp-rst-fadein";
    const userNav = viewer
      ? `<div class="nav-search"><div class="search-wrap"><input type="text" placeholder="输入题号搜索题目"></div><a class="link luogusp-rst-searchbtn" href="javascript:void 0" title="搜索">${rstIconSvg(RST_COL.search)}</a></div>
					<a class="link" href="/chat" title="私信">${rstIconSvg(RST_COL.mail)}</a>
					<a class="link" href="/user/notification" title="提醒">${rstIconSvg(RST_COL.bell)}</a>
					<span><a class="link" href="/article/mine" title="我的专栏">${rstIconSvg(RST_COL.pen)}</a></span>
					<span class="avatar"><a href="/user/${viewer.uid}"><img src="${rstAvatar(viewer.uid)}" alt="User Avatar"></a></span>`
      : `<a class="text" href="/auth/login">登录</a>
					<a class="text" href="/auth/register">注册</a>
					<span class="avatar"><img src="${rstAvatar(1)}" alt="User Avatar"></span>`;
    const catText = data.category != null ? rstCategoryText(data.category) : "";
    // 面包屑：分类 1（个人记录）原生不显示分类项
    const crumbCat =
      data.category != null && Number(data.category) !== 1
        ? `<span>/</span><a href="/article?category=${Number(data.category)}"></a>`
        : "";
    document.body.innerHTML = `
			<div class="top-bar">
				<div class="left">
					<div class="side-toggle">${rstIconSvg(RST_COL.sidebar)}</div>
					<a class="logo-link" href="/"><img class="header-logo mini" src="${RST_COL_LOGO}" alt=""></a>
					<div class="breadcrumb"><a href="/article">文章广场</a>${crumbCat}</div>
				</div>
				<div class="right"><div class="user-nav">${userNav}</div></div>
			</div>
			${rstColSidebarHtml(viewer)}
			<div class="main-container"><main>
			<div class="article-banner columba-content-wrap wrapper"><div class="banner-content">
				<h1 class="title"></h1>
				<div class="meta">
					<div class="author"><img class="avatar luogusp-rst-avatar" alt=""><div class="user"><div class="label">作者</div><div class="luogusp-rst-uname-slot"></div></div></div>
					<div class="metas">
						<div><div class="label">发布时间</div><time class="luogusp-rst-ctime"></time></div>
						<div><div class="label">分类</div><div><span class="luogusp-rst-ccat"></span></div></div>
					</div>
				</div>
			</div></div>
			<div class="content-band"><div class="article-content columba-content-wrap wrapper">
				<div class="lfe-marked-wrap"><div class="lfe-marked luogusp-rst-md"></div></div>
				<div class="update-info lfe-caption"><span class="luogusp-rst-uinfo"></span> &nbsp;&nbsp; <span>创建时间：<time class="luogusp-rst-ctime2"></time></span> &nbsp;&nbsp; <span>存档于 ${rstFmtTime(data.updatedAt)} · <a class="luogusp-rst-refresh" href="javascript:void 0">申请更新</a> · <a href="${info.origUrl}" rel="noopener noreferrer">国际站原文</a></span><span class="luogusp-rst-status"></span></div>
				<div class="actions left-mode hidden">${rstActionButtonsHtml(data)}</div>
				<div class="actions luogusp-rst-actions-inline">${rstActionButtonsHtml(data)}</div>
				<div class="toc-wrapper"></div>
			</div></div>
			<div class="article-comment columba-content-wrap wrapper">
				<h3 class="lfe-h3 section-title">评论区</h3>
				<h4 class="lfe-h4">发表评论</h4>
				<div class="l-card commentbox">
					<textarea placeholder="${viewer ? "发表一条友善的评论吧！" : ""}" title="存档页仅展示评论，发表请前往国际站原文"></textarea>
					<p>${viewer ? '<button type="button" class="solid" title="存档页仅展示评论，发表请前往国际站原文">发表</button>' : '<button type="button" class="need-login" disabled>请先登录</button>'}</p>
				</div>
				<div class="comment-filter-line">
					<span class="luogusp-rst-ccount"></span>
					<span><a class="lfe-caption luogusp-rst-crefresh" href="javascript:void 0" style="margin-right:12px;">更新评论</a></span>
					<div class="combo-wrapper">
						<div class="combo-text luogusp-rst-sorttext">默认排序</div>
						<span class="arrow">${rstIconSvg(RST_COL.sortArrow)}</span>
						<div class="combo-dropdown"><ul><li data-sort="default">默认排序</li><li data-sort="newest">最新评论</li></ul></div>
					</div>
				</div>
				<div class="list luogusp-rst-clist"><p class="luogusp-rst-note">评论加载中…</p></div>
				<p class="loadmore luogusp-rst-more" style="display:none"><a href="javascript:void 0">加载更多</a></p>
			</div>
			</main>
			<footer>
				<p><a target="_blank" href="https://help.luogu.com.cn/about-us">关于洛谷</a> · <a target="_blank" href="https://help.luogu.com.cn/">帮助中心</a> · <a target="_blank" href="https://help.luogu.com.cn/ula/luogu">用户协议</a> · <a target="_blank" href="https://help.luogu.com.cn/contact-us">联系我们</a> · <a target="_blank" href="/discuss?forum=miaomiaowu">小黑屋</a> · <a target="_blank" href="/judgement">陶片放逐</a> · <a target="_blank" href="https://help.luogu.com.cn/rules/community/">社区规则</a></p>
				<p class="copyright">在洛谷，享受 Coding 的欢乐 · © 2013-${new Date().getFullYear()} 洛谷. All rights reserved.</p>
			</footer>
			</div>`;
    document.querySelector(".banner-content .title").textContent =
      data.title || "(无标题)";
    document.querySelector(".luogusp-rst-ctime").textContent = rstFmtTime(
      data.createdAt,
    );
    const t2 = document.querySelector(".luogusp-rst-ctime2");
    t2.textContent = rstFmtTimeSec(data.createdAt);
    t2.title = rstFmtTimeSec(data.createdAt);
    document.querySelector(".luogusp-rst-ccat").textContent = catText || "—";
    const crumbCatA = document.querySelector(
      '.breadcrumb a[href^="/article?category="]',
    );
    if (crumbCatA) crumbCatA.textContent = catText;
    const user = author || data.author || {};
    const uid = data.authorId || user.id || user.uid || 0;
    document.querySelector(".luogusp-rst-uinfo").textContent =
      `作者：${user.name || uid || "?"}`;
    document
      .querySelector(".luogusp-rst-uname-slot")
      .appendChild(rstUsernameEl(user, uid, { cls: "user-name" }));
    document.querySelector(".luogusp-rst-avatar").src = rstAvatar(uid);
    rstRenderMd(document.querySelector(".luogusp-rst-md"), data.content);
    rstBuildToc(data.title);
    rstFillCommon(info);
    rstWireArticle();
  }
  // 文章页交互：侧栏钉住/抽屉、顶栏搜索展开、滚动出现左浮互动条、评论排序下拉
  function rstWireArticle() {
    rstApplySidebarMode(rstSidebarPinned(), false);
    let drawerShown = false;
    const toggle = document.querySelector(".side-toggle");
    if (toggle)
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const nav = document.querySelector("nav.lside");
        if (!nav) return;
        if (nav.classList.contains("bar") || nav.classList.contains("show")) {
          // 已钉住/抽屉开着 → 收起并记住不钉
          try {
            localStorage.setItem(RST_PIN_KEY, "0");
          } catch (err) {
            /* 无痕模式等：仅本页生效 */
          }
          drawerShown = false;
          rstApplySidebarMode(false, false);
        } else {
          // 原生行为：打开抽屉并记住钉住（下次进入即钉栏）
          try {
            localStorage.setItem(RST_PIN_KEY, "1");
          } catch (err) {
            /* 同上 */
          }
          drawerShown = true;
          rstApplySidebarMode(false, true);
        }
      });
    document.addEventListener("click", (e) => {
      if (!drawerShown) return;
      const nav = document.querySelector("nav.lside");
      if (nav && !nav.contains(e.target)) {
        drawerShown = false;
        rstApplySidebarMode(false, false);
      }
    });
    rstWireSearch(".nav-search .search-wrap");
    // 左浮互动条：内联互动条滚出视口后出现（原生行为，IntersectionObserver 驱动）
    const inline = document.querySelector(".luogusp-rst-actions-inline");
    const leftMode = document.querySelector(".actions.left-mode");
    if (inline && leftMode && typeof IntersectionObserver === "function") {
      new IntersectionObserver((entries) => {
        for (const en of entries)
          leftMode.classList.toggle("hidden", en.isIntersecting);
      }).observe(inline);
    }
    // 排序下拉（默认排序=存档序 / 最新评论=时间倒序）
    const combo = document.querySelector(".combo-wrapper");
    if (combo) {
      const dd = combo.querySelector(".combo-dropdown");
      combo.addEventListener("click", (e) => {
        e.stopPropagation();
        const li = e.target.closest("li[data-sort]");
        if (li) {
          rstCommentSort = li.dataset.sort;
          combo.querySelector(".luogusp-rst-sorttext").textContent =
            li.textContent;
          dd.classList.remove("show");
          rstRenderCommentPage(true);
          return;
        }
        dd.classList.toggle("show");
      });
      document.addEventListener("click", () => dd.classList.remove("show"));
    }
  }
  // 顶栏/头部搜索框展开（原生跳题目搜索）
  function rstWireSearch(wrapSel) {
    const btn = document.querySelector(".luogusp-rst-searchbtn");
    const wrap = document.querySelector(wrapSel);
    if (!btn || !wrap) return;
    const inp = wrap.querySelector("input");
    const go = () => {
      const kw = inp.value.trim();
      if (kw)
        location.href = `/problem/list?keyword=${encodeURIComponent(kw)}`;
    };
    btn.addEventListener("click", () => {
      if (!wrap.classList.contains("show")) {
        wrap.classList.add("show");
        inp.focus();
      } else if (inp.value.trim()) go();
      else wrap.classList.remove("show");
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
  }
  // 剪贴板页：1:1 复刻旧版 lfe（59px 左导航+深色头部+user-nav+card+页脚）
  function rstBuildPastePage(info, data) {
    document.title = "云剪贴板 - 洛谷 | 计算机科学教育新生态";
    document.documentElement.scrollTop = 0;
    document.body.className =
      "luogusp-rstpage luogusp-rst-paste luogusp-rst-fadein";
    const navItem = (href, ic, text) =>
      `<a href="${href}"><span class="icon">${rstIconSvg(ic)}</span><span class="text">${text}</span></a>`;
    document.body.innerHTML = `
			<nav class="lgnav">
				<a class="logo-wrap" href="/" title="洛谷首页"><img src="${RST_LFE.logoUrl}" alt="洛谷"></a>
				<div class="popup-button">${rstIconSvg(RST_LFE.popup)}</div>
				${navItem("/problem/list", RST_LFE.tiku, "题库")}
				${navItem("/training/list", RST_LFE.tidan, "题单")}
				${navItem("/contest/list", RST_LFE.bisai, "比赛")}
				${navItem("/record/list", RST_LFE.jilu, "记录")}
				${navItem("/discuss", RST_LFE.taolun, "讨论")}
				${navItem("/article", RST_LFE.zhuanlan, "专栏")}
			</nav>
			<div class="main-container">
			<div class="wrapper wrapped header-layout narrow"><div class="background"></div><div class="header">
				<div class="user-nav">
					<a class="icon-btn" href="/search" title="搜索">${rstIconSvg(RST_LFE.search)}</a>
					<a class="icon-btn" href="/chat" title="私信">${rstIconSvg(RST_LFE.mail)}</a>
					<a class="icon-btn" href="/user/notification" title="提醒">${rstIconSvg(RST_LFE.bell)}</a>
					<a class="icon-btn" href="javascript:void 0"><img class="avatar luogusp-rst-viewer" style="display:none" alt=""></a>
				</div>
				<nav class="bread-crumb"><a href="/">洛谷</a><span class="text"> / </span><span class="text">云剪贴板</span></nav>
				<h1 class="lfe-h1">云剪贴板</h1>
			</div></div>
			<main class="wrapped"><div>
			<div class="card">
				<div class="content-card-top">
					<div class="author">
						<div class="author-margin"><a class="luogusp-rst-uname" rel="noopener noreferrer"></a><span class="pubbadge">公开</span></div>
						<div><time class="luogusp-rst-ctime"></time></div>
					</div>
					<div class="actions"><span class="luogusp-rst-status"></span><button class="luogusp-rst-refresh" type="button">申请更新</button></div>
				</div>
				<hr class="horizon">
				<div class="marked luogusp-rst-md"></div>
				<p class="lfe-caption" style="color:#999;margin:1em 0 0;">存档更新于 ${rstFmtTime(data.updatedAt)} · 内容来自洛谷保存站 · <a href="${info.origUrl}" rel="noopener noreferrer">查看国际站原文</a></p>
			</div>
			</div></main>
			<div class="wrapper wrapped lgfooter"><div class="background"></div><div class="footer">
				<img class="logo-img" src="${RST_LFE.logoUrl}" alt="">
				<div class="slogan">计算机科学<br>教育新生态</div>
				<img class="qr-img" src="${RST_LFE.qrUrl}" alt="">
				<div class="info">
					<p><a href="https://help.luogu.com.cn/about">关于洛谷</a><a href="https://help.luogu.com.cn">帮助中心</a><a href="https://help.luogu.com.cn/rules/user-agreement">用户协议</a><a href="https://help.luogu.com.cn/contact-us">联系我们</a><br>
					<a href="/discuss/124">小黑屋</a><a href="/judgement">陶片放逐</a><a href="https://help.luogu.com.cn/rules/community/">社区规则</a><a href="https://www.luogu.com.cn/discuss/142324">招贤纳才</a><br>
					<a href="https://beian.miit.gov.cn/">沪ICP备18008322号</a></p>
				</div>
			</div></div>
			</div>`;
    document.querySelector(".luogusp-rst-ctime").textContent = rstFmtTime(
      data.createdAt,
    );
    rstFillCommon(info, data);
  }
  function rstBuildPage(info, data) {
    if (info.type === "article") rstBuildArticlePage(info, data);
    else rstBuildPastePage(info, data);
  }
  // columba 原生 TOC（指示条 + 文字），挂在 .toc-wrapper 内 sticky 跟随
  function rstBuildToc() {
    const old = document.querySelector(".toc-wrapper .toc");
    if (old) old.remove();
    const wrapper = document.querySelector(".toc-wrapper");
    const md = document.querySelector(".luogusp-rst-md");
    if (!wrapper || !md) return;
    const heads = [...md.querySelectorAll("h1, h2, h3")];
    if (heads.length < 2) return;
    const toc = document.createElement("div");
    toc.className = "toc";
    const ul = document.createElement("ul");
    heads.forEach((h, i) => {
      h.id = `luogusp-toc-${i}`;
      const li = document.createElement("li");
      li.className = `title-${Number(h.tagName[1]) - 1}`;
      const a = document.createElement("a");
      a.textContent = h.textContent;
      a.href = `#luogusp-toc-${i}`;
      li.appendChild(a);
      ul.appendChild(li);
    });
    toc.appendChild(ul);
    wrapper.appendChild(toc);
  }
  // 评论列表：复刻 columba 原生 reply-item 结构（灰底 meta 行 + 内容区，相对时间）
  function rstRenderComments(comments) {
    const wrap = document.querySelector(".luogusp-rst-clist");
    if (!wrap) return;
    const count = document.querySelector(".luogusp-rst-ccount");
    if (count) count.textContent = `${(comments && comments.length) || 0} 条评论`;
    wrap.innerHTML = "";
    if (!comments || !comments.length) {
      wrap.innerHTML = '<p class="luogusp-rst-note">暂无评论存档</p>';
      return;
    }
    for (const c of comments) {
      const a = c.author || {};
      const row = document.createElement("div");
      row.className = "row";
      const card = document.createElement("div");
      card.className = "l-card reply-item";
      const meta = document.createElement("div");
      meta.className = "meta";
      const left = document.createElement("div");
      left.className = "left";
      const img = document.createElement("img");
      img.className = "avatar";
      img.src = rstAvatar(a.id || 0);
      img.alt = "";
      const name = document.createElement(a.id ? "a" : "span");
      name.className = "username";
      name.textContent = a.name || "?";
      name.style.color = rstUserColor(a.color);
      if (a.id) name.href = `/user/${a.id}`;
      const time = document.createElement("span");
      time.className = "time";
      const t = document.createElement("time");
      t.textContent = rstRelTime(Number(c.time));
      t.title = rstFmtTime(Number(c.time));
      time.appendChild(t);
      left.append(img, name, time);
      meta.appendChild(left);
      const body = document.createElement("div");
      body.className = "content";
      body.innerHTML = renderMarkdown(String(c.content || "")); // renderMarkdown 已消毒
      card.append(meta, body);
      row.appendChild(card);
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
    if (info.type === "article") rstBuildToc(); // 内部会先移除旧 TOC
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
      // 保存站不可达：撤掉加载层还原拦截页，仅置顶提示，保留原生跳转能力
      console.error("LuoguSP restricted:", e);
      rstHideLoader();
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
      // 已收录：直接显示存档，不自动申请更新（owner 拍板：更新只走「申请更新」按钮）
      rstBuildPage(info, q.data);
      if (info.type === "article") rstLoadComments(info);
      return;
    }
    // 未收录：发起保存并等待入库（加载层持续转圈，完成后整页渲染）
    rstShowLoader("该内容尚未被保存站收录，已自动发起收录…");
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
    // 拦截页是独立静态页，无 SPA。命中即刻盖上加载动效层（不闪原生跳转确认页），
    // 随后异步取数渲染；取数失败会撤层还原拦截页。
    try {
      if (restrictedPageInfo()) rstShowLoader();
    } catch (e) {
      console.error("LuoguSP restricted loader:", e);
    }
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
