import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { resolveHoverTarget } from "./anchors.js";
import { isPreviewShortcut } from "./hover-intent.js";

// hover 卡的啟動側薄殼。與受限內容那次同一個形狀：**只有使用者真的把指針停在
// 題號或使用者名上，才去拉那個塊**。絕大多數頁面瀏覽根本不會觸發。
//
// ★ 設定項必須在不載入塊的前提下就能列出來，所以 id / key / label 由本殼持有。
//
// ★★★ owner 報過兩輪「第一次懸停不彈卡」。這一層有**兩個**獨立原因，都修了：
//
//  1. 塊是**被這一次 mouseover 拉下來的**，等它載入完掛上委託監聽時，那個事件早就
//     派發完了；使用者停著不動就再也沒有新事件。→ 掛載時把**指針當時的座標**交給塊，
//     由塊自己解析並**立刻開卡**（`mount({ replayAt })`）。
//     ★ 不再補發合成事件：跨 realm 造事件脆，而且合成事件還要再等 300ms 停留，
//       體感仍然是「第一次懸停不彈」。
//
//  2. 私信頁的聯繫人名稱可能是純 span。薄殼和卡片共用解析器，可從同列頭像取得 uid。

// ★★★ 屏蔽洛谷原生的個人懸停卡。owner 2026-08-14 第五輪：文章廣場、討論區、
//   提交記錄、題目頁出題人……到處都是原生卡和我們的卡一起彈。
//
// 結構取自 `DropdownWrapper` 元件原文（loader chunk）：
//     <wrapper><trigger .../><Teleport to="#app">
//       <div class="dropdown {shown}">{shown ? 卡片內容 : 空}</div>
//     </Teleport></wrapper>
//   使用者卡本體是那個 `class="float-card"` 的節點（`UserFloatCard` 的根）。
//   全站 chunk 裡 `"float-card"` **只有這一處**用到，所以按它認不會誤傷。
//
// ★ 為什麼用 CSS 而不是掐事件：原生觸發器的 `mouseover` 監聽掛在觸發元素上，
//   要攔就得在 document 捕獲階段 `stopPropagation` —— 那會連帶掐掉那棵子樹上
//   別人的一切 mouseover，代價不可控。CSS 只影響顯示，壞不了任何行為。
//   代價是原生那邊照樣會發一次 `/api/user/info/{uid}`（約 1 KB），可以接受。
// ★ 只在**使用者卡開關打開時**才注入：關掉我們的卡就該把原生卡還給使用者。
//   `:has()` 那條連空的下拉盒子一起藏掉；下面那條是沒有 `:has()` 時的備援。
const NATIVE_SUPPRESS_ID = "luogusp-hc-native-suppress";
const NATIVE_SUPPRESS_CSS =
  ".dropdown:has(> .float-card){display:none !important;}" +
  ".float-card{display:none !important;}";

const suppressNativeCard = (on) => {
  const head = document.head || document.documentElement;
  const existing = document.getElementById(NATIVE_SUPPRESS_ID);
  if (!on) {
    if (existing) existing.remove();
    return;
  }
  if (existing || !head) return;
  const style = document.createElement("style");
  style.id = NATIVE_SUPPRESS_ID;
  style.textContent = NATIVE_SUPPRESS_CSS;
  head.appendChild(style);
};

// ★ owner 2026-08-14 第四輪把開關拆成兩個：「題目懸停顯示預覽卡」與
//   「使用者名/頭像懸停顯示預覽卡」。兩個開關**共用同一個塊、同一次掛載** ——
//   分別掛兩次會得到兩張卡片元素、兩套委託監聽。做法是引用計數：
//   哪一類被打開就把它記進 active，塊在 hover 時按 active 過濾；
//   兩類都關掉了才真正卸載。
export function createHoverCardFeatures(config) {
  const {
    storage,
    loadBundle,
    fetchPage,
    problemData,
    nativeUserInfo,
    logError = (error) => console.error("LuoguSP hover card bundle:", error),
  } = config || {};

  let feature = null;
  let pending = null;
  let unavailable = false;

  const ensureFeature = () => {
    if (feature) return Promise.resolve(feature);
    if (unavailable) return Promise.resolve(null);
    // 沒人串接就等於功能不存在，必須報出來 —— 靜默會偽裝成「功能沒做」。
    if (typeof loadBundle !== "function") {
      unavailable = true;
      logError(new TypeError("hover 卡功能块的加载器未接线"));
      return Promise.resolve(null);
    }
    if (!pending)
      pending = Promise.resolve()
        .then(() => loadBundle())
        .then((module) => {
          const create =
            module && typeof module.createHoverCardFeature === "function"
              ? module.createHoverCardFeature
              : null;
          if (!create) throw new TypeError("hover 卡功能块缺少工厂导出");
          feature = create({
            storage,
            fetchPage,
            problemData,
            nativeUserInfo,
            isEnabled: (kind) => active.has(kind),
          });
          return feature;
        })
        .catch((error) => {
          unavailable = true;
          logError(error);
          return null;
        })
        .finally(() => {
          pending = null;
        });
    return pending;
  };

  // 當前開著的類別。塊通過 `isEnabled` 現問，所以在設定裡改開關**立刻生效**，不必重掛。
  const active = new Set();
  // ★ 兩個開關共用**一次**掛載：各掛各的會得到兩張卡片元素、兩套委託監聽。
  //   所以做引用計數 —— 第一個打開時裝殼，最後一個關掉時才拆。
  let shellDispose = null;
  let refs = 0;
  let innerDispose = null;

  const mountShell = () => {
    if (!document.body) return () => {};
    let released = false;
    // 指針最後落在哪兒。★ 探針**一直掛到塊真正接管為止**，就是為了讓這個座標保持新鮮：
    //   塊在路上時使用者還在移動，補發要按最新位置來。
    let point = null;
    let keyboardAnchor = null;
    const detach = () => {
      document.removeEventListener("mouseover", probe, true);
      document.removeEventListener("keydown", probeKeyboard);
    };
    function mountBundle() {
      ensureFeature().then((loaded) => {
        if (released || !loaded || innerDispose) return;
        try {
          // 把指針座標交給塊：那一次懸停的事件它接不到，只能靠座標自己補。
          const replayFocus = keyboardAnchor && keyboardAnchor === document.activeElement ? keyboardAnchor : null;
          innerDispose = loaded.mount(replayFocus ? { replayFocus } : { replayAt: point });
        } catch (error) {
          logError(error);
          return;
        }
        detach();
      });
    }
    function probe(event) {
      if (typeof event.clientX === "number")
        point = { x: event.clientX, y: event.clientY };
      const target = resolveHoverTarget(event.target);
      if (target && active.has(target.kind)) mountBundle();
    }
    function probeKeyboard(event) {
      if (event.key === "Escape") keyboardAnchor = null;
      if (event.defaultPrevented || !isPreviewShortcut(event)) return;
      const node = event.target;
      const target = resolveHoverTarget(node);
      if (!target || target.anchor !== node || !active.has(target.kind)) return;
      event.preventDefault();
      keyboardAnchor = node;
      mountBundle();
    }
    document.addEventListener("mouseover", probe, true);
    document.addEventListener("keydown", probeKeyboard);
    return () => {
      released = true;
      detach();
      if (typeof innerDispose === "function") innerDispose();
      innerDispose = null;
    };
  };

  const mountFor = (kind) => {
    active.add(kind);
    // 我們的使用者卡一上場，就把原生那張藏起來 —— 兩張一起彈是 owner 報的問題。
    if (kind === "user") suppressNativeCard(true);
    if (refs === 0) shellDispose = mountShell();
    refs += 1;
    return () => {
      active.delete(kind);
      if (kind === "user") suppressNativeCard(false);
      refs -= 1;
      if (refs > 0) return;
      if (typeof shellDispose === "function") shellDispose();
      shellDispose = null;
    };
  };

  return Object.freeze({
    problem: defineConfigurableFeature({
      id: "hover-card-problem",
      key: "showProblemHoverCards",
      label: "题目悬停显示预览卡",
      storage,
      mount: () => mountFor("problem"),
    }),
    user: defineConfigurableFeature({
      id: "hover-card-user",
      key: "showUserHoverCards",
      label: "用户名/头像悬停显示预览卡",
      storage,
      mount: () => mountFor("user"),
    }),
  });
}
