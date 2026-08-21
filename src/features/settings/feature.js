import { SETTINGS_STYLE } from "./style.js";

export function createSettingsFeature({ storage, configurableFeatures }) {
  // 按先后顺序试，第一个命中的就是本页导航。
  // ★ nav.lside 是窄视口兜底：columba 侧栏钉住时是 `nav.sidebar lside bar`，
  //   收窄到抽屉态就变成 `nav.lside drawer`——没有 sidebar 类，入口会整个消失。
  //   两种形态都带 lside，所以放在 nav.sidebar 之后兜底，宽屏行为一字不变。
  const SELECTORS = {
    navContainers: ["nav.lfe-body", "nav.sidebar", "nav.lside"],
    navText: ".text, .title",
  };
  const featureLabels = new Map(
    configurableFeatures.map((feature) => [
      feature.storageKey,
      feature.label,
    ]),
  );

  function injectStyle() {
    if (document.getElementById("luogusp-style")) return;
    const style = document.createElement("style");
    style.id = "luogusp-style";
    style.textContent = SETTINGS_STYLE;
    (document.head || document.documentElement).appendChild(style);
  }

  // ★★ 本功能会往 body 上放两种覆盖层：设置面板与保存后的「是否立即刷新」确认框，
  //   两者**共用 `#luogusp-settings` 这个 id**（CSS 作用域全挂在它上面，见 style.js）。
  //   此前只有设置面板登记了关闭回调，确认框没有，于是（2026-08-15 jsdom 复现）：
  //   保存设置 → 确认框弹出 → 路由切换（page-lifecycle dispose 再 remount）
  //   → 确认框连同它那个 document 级 keydown 监听一起留在页面上（Enter 直接
  //   `location.reload()`），而且它顶着的 id 会把 `openSettings` 的防重入判据挡下 ——
  //   齿轮从此点了没反应。所以登记表是**一份**，两种覆盖层都进。
  const openOverlays = new Set();
  const closeAllOverlays = () => {
    for (const close of [...openOverlays]) close();
  };
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
            ${[...featureLabels]
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
    let closed = false;
    function esc(e) {
      if (e.key === "Escape") close();
    }
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      document.removeEventListener("keydown", esc);
      openOverlays.delete(close);
    };
    openOverlays.add(close);

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
        // owner 要求：提示要在屏幕正中。浏览器原生 confirm() 在 Chrome/Edge 一律贴
        // 视口顶部且样式不可控，所以复用设置面板同一套遮罩 + 居中面板。
        askRefresh();
      }
    });
    document.addEventListener("keydown", esc);
  }

  // 保存后的「是否立即刷新」确认框。与设置面板共用 #luogusp-settings 的样式作用域，
  // 所以天然居中、天然跟随同一套配色。
  function askRefresh() {
    const overlay = document.createElement("div");
    overlay.id = "luogusp-settings";
    overlay.innerHTML =
      '<div class="luogusp-mask"></div>' +
      '<div class="luogusp-panel" role="alertdialog" aria-modal="true">' +
      '<div class="luogusp-content">' +
      '<h3>设置已保存</h3>' +
      '<p class="luogusp-confirm">是否立即刷新页面生效？</p>' +
      '<div class="luogusp-actions">' +
      '<button data-act="reload" class="luogusp-primary">立即刷新</button>' +
      '<button data-act="later">稍后</button>' +
      "</div></div></div>";
    document.body.appendChild(overlay);
    let done = false;
    const finish = (reload) => {
      if (done) return;
      done = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      openOverlays.delete(dismiss);
      if (reload) location.reload();
    };
    // ★ 功能被卸载时只能是「收起」，绝不能替用户按下「立即刷新」。
    const dismiss = () => finish(false);
    openOverlays.add(dismiss);
    function onKey(event) {
      if (event.key === "Escape") finish(false);
      if (event.key === "Enter") finish(true);
    }
    overlay.addEventListener("click", (event) => {
      const target = event.target;
      if (target.classList.contains("luogusp-mask")) return finish(false);
      const act = target.getAttribute && target.getAttribute("data-act");
      if (act === "reload") return finish(true);
      if (act === "later") return finish(false);
    });
    document.addEventListener("keydown", onKey);
    const primary = overlay.querySelector('[data-act="reload"]');
    if (primary) primary.focus();
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

  // 会被浏览器当浮泡、或被读屏当元素名字的属性（data-v-* 是作用域 CSS，绝不能碰）。
  const TOOLTIP_ATTRS = [
    "title",
    "aria-label",
    "aria-labelledby",
    "data-title",
    "data-tooltip",
    "data-original-title",
  ];

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
    // ★ 浮泡文字不在 <a> 上，在外面那层 <li title="文章广场"> 上（2026-08-20 在真站上量过：
    //   新侧栏每条都是 `<li title="…"><a>…</a></li>`，而模板恰好取到 /article 那条 ——
    //   它是最后一个「既有图标又有文字」的条目）。只改 <a> 里的文字，鼠标一悬停仍报模板的名字。
    //   所以凡是能产生浮泡或读屏名字的属性，连 clone 根带整棵子树一起剥净，再按自己的名字重设。
    for (const el of [clone, ...clone.querySelectorAll("*")])
      for (const name of TOOLTIP_ATTRS) el.removeAttribute(name);
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
    // 名字按洛谷的位置放：新侧栏的浮泡挂在 <li> 上，所以挂 clone 根（无 li 时 clone 就是 <a>）。
    clone.setAttribute("title", "插件设置");
    link.setAttribute("aria-label", "插件设置");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSettings();
    });
    unit.parentNode.insertBefore(clone, unit.nextSibling);
  }

  // 洛谷是 SPA：首页顶栏↔内容页侧栏随路由切换而重挂，入口须在导航变化时补上（rAF 节流，加了就早退）。
  // ★受限内容接管页 document.write 后旧 body 上的观察器全灭——接管流程会重新调用本函数。
  // 格式随导航自适应：旧版竖排栏（nav.lfe-body，首页/剪贴板同款）=「插件/设置」两行，
  // 新版侧栏（nav.sidebar，columba 文章页等）=「插件设置」单行。
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
      document
        .querySelectorAll(".luogusp-setting-entry")
        .forEach((entry) => (entry.closest("li") || entry).remove());
      closeAllOverlays();
    };
  }

  return Object.freeze({
    id: "settings",
    mount: () => {
      injectStyle();
      return watchSettingButton();
    },
  });
}
