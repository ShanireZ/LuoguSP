import { SETTINGS_STYLE } from "./style.js";

export function createSettingsFeature({ storage, configurableFeatures }) {
  // 按先後順序試，第一個命中的就是本頁導覽。
  // ★ nav.lside 是窄視口備援：columba 側欄釘住時是 `nav.sidebar lside bar`，
  //   收窄到抽屜態就變成 `nav.lside drawer`——沒有 sidebar 類，入口會整個消失。
  //   兩種形態都帶 lside，所以放在 nav.sidebar 之後備援，寬屏行為一字不變。
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

  // ★★ 本功能會往 body 上放兩種覆蓋層：設定面板與保存後的「是否立即刷新」確認框，
  //   兩者**共用 `#luogusp-settings` 這個 id**（CSS 作用域全掛在它上面，見 style.js）。
  //   此前只有設定面板登記了關閉回呼，確認框沒有，於是（2026-08-15 jsdom 重現）：
  //   保存設定 → 確認框彈出 → 路由切換（page-lifecycle dispose 再 remount）
  //   → 確認框連同它那個 document 級 keydown 監聽一起留在頁面上（Enter 直接
  //   `location.reload()`），而且它頂著的 id 會把 `openSettings` 的防重入判據擋下 ——
  //   齒輪從此點了沒反應。所以登記表是**一份**，兩種覆蓋層都進。
  const openOverlays = new Set();
  const closeAllOverlays = () => {
    for (const close of [...openOverlays]) close();
  };
  function openSettings() {
    if (document.getElementById("luogusp-settings")) return; // 避免重複打開
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
        // owner 要求：提示要在螢幕正中。瀏覽器原生 confirm() 在 Chrome/Edge 一律貼
        // 視口頂部且樣式不可控，所以重複使用設定面板同一套遮罩 + 居中面板。
        askRefresh();
      }
    });
    document.addEventListener("keydown", esc);
  }

  // 保存後的「是否立即刷新」確認框。與設定面板共用 #luogusp-settings 的樣式作用域，
  // 所以天然居中、天然跟隨同一套配色。
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
    // ★ 功能被卸載時只能是「收起」，絕不能替使用者按下「立即刷新」。
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

  // 齒輪圖標（24×24 Material settings，fill=currentColor 跟隨導覽文字色）
  const GEAR_PATH =
    "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";
  // 把一個已存在的 <svg> 原地改成齒輪（保留它的 class/data-v/尺寸，只換 viewBox+內容，從而繼承洛谷圖標樣式）
  function gearInto(svg) {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", GEAR_PATH);
    svg.appendChild(path);
    return svg;
  }
  // 新建一個齒輪 svg（用於原條目沒有 svg 圖標時）；templateIcon 存在則重複使用其 class 拿尺寸。
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

  // 會被瀏覽器當浮泡、或被讀屏當元素名字的屬性（data-v-* 是作用域 CSS，絕不能碰）。
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
    // 兩套導覽都試：首頁豎排 nav.lfe-body / 內容頁側欄 nav.sidebar
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
    if (!nav) return; // 該頁無可識別導覽，跳過
    if (nav.querySelector(".luogusp-setting-entry")) return; // 已存在

    // 選一個既有圖標又有文字的原生條目當範本（取靠後的，落在工具/雜項區），克隆繼承洛谷當前樣式與間距。
    const cands = [...nav.querySelectorAll("a")].filter(
      (a) => a.querySelector("svg, img, .icon") && navTextSpan(a),
    );
    if (!cands.length) return;
    const template = cands[cands.length - 1];
    const li = template.closest("li");
    const unit = li && nav.contains(li) ? li : template; // 側欄條目外套 <li>，連 li 一起克隆才對齊

    const clone = unit.cloneNode(true);
    const link = clone.matches("a") ? clone : clone.querySelector("a");
    if (!link) return;
    // ★ 浮泡文字不在 <a> 上，在外面那層 <li title="文章广场"> 上（2026-08-20 在真站上量過：
    //   新側欄每條都是 `<li title="…"><a>…</a></li>`，而範本恰好取到 /article 那條 ——
    //   它是最後一個「既有圖標又有文字」的條目）。只改 <a> 裡的文字，滑鼠一懸停仍報範本的名字。
    //   所以凡是能產生浮泡或讀屏名字的屬性，連 clone 根帶整棵子樹一起剝淨，再按自己的名字重設。
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
        // 首頁豎排欄窄：強制「外掛」「設定」兩字兩行，避免預設 3+1 難看折行
        textEl.textContent = "";
        textEl.append("插件", document.createElement("br"), "设置");
      } else {
        textEl.textContent = "插件设置";
      }
    }
    const svg = link.querySelector("svg"); // 原地把圖標 svg 改成齒輪，保留其 class/data-v 尺寸
    if (svg) gearInto(svg);
    else {
      const other = link.querySelector("img, i");
      if (other) other.replaceWith(newGear(other));
    }
    // 名字按洛谷的位置放：新側欄的浮泡掛在 <li> 上，所以掛 clone 根（無 li 時 clone 就是 <a>）。
    clone.setAttribute("title", "插件设置");
    link.setAttribute("aria-label", "插件设置");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSettings();
    });
    unit.parentNode.insertBefore(clone, unit.nextSibling);
  }

  // 洛谷是 SPA：首頁頂欄↔內容頁側欄隨路由切換而重掛，入口須在導覽變化時補上（rAF 節流，加了就早退）。
  // ★受限內容接管頁 document.write 後舊 body 上的觀察器全滅——接管流程會重新呼叫本函式。
  // 格式隨導覽自適應：舊版豎排欄（nav.lfe-body，首頁/剪貼板同款）=「外掛/設定」兩行，
  // 新版側欄（nav.sidebar，columba 文章頁等）=「外掛設定」單行。
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
