import { createProblemIdentityResolver } from "../problem-color/identity.js";
import {
  readCsrfToken,
  readPageSubject,
  readViewerUid,
  resolveHoverTarget,
} from "./anchors.js";
import {
  finalizeCard,
  placeCard,
  renderProblemCard,
  renderUserCard,
} from "./card-view.js";
import { createFollowAction } from "./follow-action.js";
import { createHoverIntent } from "./hover-intent.js";
import { createHoverCardSources } from "./sources.js";
import { HOVER_CARD_STYLE } from "./style.js";

// 題號 / 使用者名 / 頭像的懸停預覽卡。
//
// 頁面上滿地是裸題號和裸使用者名，現在只有顏色，看不出是什麼題、是誰。這個功能把
// 題名、難度、通過率、標籤（預設摺疊）、我的狀態，以及使用者的通過數/排名/咕值/Elo/
// 獲獎/關係 就地攤開，並帶一枚重複使用洛谷原生契約的關注按鈕。
//
// ★ 全部資料只走當前站同源（.com.cn）；一個位元組都不碰國際站。
// ★ 靠事件委託，不靠 MutationObserver + rAF —— 隱藏標籤頁裡 rAF 不觸發。

const STYLE_ID = "luogusp-hover-card-style";
const CARD_ID = "luogusp-hover-card";

export function createHoverCardFeature(config) {
  // ★ 設定項的身分（id/key/label）在**薄殼**手裡，不在這裡 —— 這個塊只負責幹活。
  //   `isEnabled(kind)` 是薄殼現問的：owner 把開關拆成了題目卡與使用者卡兩個，
  //   改開關要**立刻生效**，不能靠重掛。
  const { fetchPage, isEnabled = () => true } = config || {};

  const clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const identity = createProblemIdentityResolver({
    getOrigin: () => location.origin,
    voidAnchorSelector: "a[data-v-bade3303][data-v-4842157a]",
    // ★ 不給 standalonePidSelector：`.pid[title]` 已經從錨點選擇器裡拿掉了
    //   （題庫的題號格靠那個 title 著色，我們碰不得）。見 anchors.js 的說明。
  });

  const mount = (options = {}) => {
    if (!document.body) return () => {};
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = HOVER_CARD_STYLE;
      (document.head || document.documentElement).appendChild(style);
    }

    const card = document.createElement("div");
    card.id = CARD_ID;
    card.className = "luogusp-hc";
    card.hidden = true;
    card.setAttribute("role", "tooltip");
    document.body.appendChild(card);

    const sources = createHoverCardSources({
      fetchPage: (path, signal, init) => fetchPage(path, signal, init),
      clock,
      logError: (error) => console.error("LuoguSP hover card:", error),
    });
    const follow = createFollowAction({
      csrfToken: () => readCsrfToken(document),
      request: (payload) =>
        fetchPage(payload.url, undefined, {
          method: payload.method,
          headers: payload.headers,
          body: payload.body,
          credentials: "same-origin",
        }),
      onState: (uid, next) => {
        sources.patchUser(uid, next);
        // 狀態變了就地重畫，別等下一次 hover。
        if (shown && shown.kind === "user" && shown.uid === uid) draw(shown.key);
      },
      logError: (error) => console.error("LuoguSP hover follow:", error),
    });

    // 當前正在展示的目標（由 hover-intent 決定），以及它的錨點矩形。
    let shown = null;
    const targets = new Map();
    // ★ owner 要求屏蔽洛谷原生的題號懸停。原生那個就是 `.pid[title]` 上的 title 屬性
    //   （problem-color 的選擇器就叫這個名字）觸發的瀏覽器浮泡 —— 我們的卡片一接管，
    //   兩層提示就會打架。摘掉 title，並記下原值，dispose 時還回去。
    const strippedTitles = new WeakMap();
    const stripNativeTitle = (anchor) => {
      for (const node of [anchor, ...anchor.querySelectorAll?.("[title]") ?? []]) {
        if (!node || strippedTitles.has(node)) continue;
        const title = node.getAttribute && node.getAttribute("title");
        if (title === null || title === undefined) continue;
        strippedTitles.set(node, title);
        node.removeAttribute("title");
      }
    };
    const restoreNativeTitles = () => {
      for (const target of targets.values()) {
        const anchor = target.anchor;
        for (const node of [anchor, ...(anchor.querySelectorAll?.("*") ?? [])]) {
          const title = strippedTitles.get(node);
          if (title !== undefined) node.setAttribute("title", title);
        }
      }
    };

    // 最近一次指針座標：跨行錨點要靠它挑出「指針所在的那一行」來定位，
    // 否則卡片會被推到整個盒子的下沿，離題號很遠。
    let pointer = null;
    // 從錨點的多個 client rect 裡挑包含指針縱座標的那一行；挑不到就退回整體盒子。
    const rectForPointer = (anchor) => {
      const rects = anchor.getClientRects ? [...anchor.getClientRects()] : [];
      if (pointer && rects.length > 1) {
        const hit = rects.find(
          (r) => pointer.y >= r.top - 2 && pointer.y <= r.bottom + 2,
        );
        if (hit) return hit;
      }
      return rects[0] || anchor.getBoundingClientRect();
    };

    // ★★★ 2.14.1「卡片跳走」。開卡時卡裡只有一個轉圈（≈42px），內容一到是 ≈320px，
    //   兩次定位量到的高度差近 8 倍 —— 錨點下方餘量 44~320px 時必然翻邊。
    //   所以開卡那一次按「內容將會有多高」定邊，內容完成實作那一次沿用同一邊。
    //   ★ 之後（使用者點展開）`openSide` 已經交還成 null，仍按第七輪的三句話自由重判。
    const LOADING_MIN_HEIGHT = 320;
    let loading = false;
    let openSide = null;

    const position = () => {
      if (!shown || card.hidden) return;
      const anchor = shown.anchor;
      if (!anchor || !anchor.getBoundingClientRect) return;
      const placement = placeCard(
        card,
        rectForPointer(anchor),
        { width: window.innerWidth, height: window.innerHeight },
        {
          assumeMinHeight: loading ? LOADING_MIN_HEIGHT : 0,
          forceBelow: openSide,
        },
      );
      // 載入態記住這一邊；內容一完成實作就交還自由。
      openSide = loading ? placement.below : null;
    };

    const draw = async (key) => {
      const target = targets.get(key);
      if (!target) return;
      const viewer = readViewerUid(document, window);
      const model =
        target.kind === "problem"
          ? await sources.problem(target.pid, viewer)
          : await sources.user(target.uid);
      // 等資料的過程中滑鼠可能已經走了 —— 拿到了也不許再畫。
      if (!shown || shown.key !== key) return;
      card.textContent = "";
      if (!model) {
        card.appendChild(
          Object.assign(document.createElement("div"), {
            className: "luogusp-hc-muted",
            // 洛谷自己說了原因就照搬（例如「該使用者未通過實名認證」），
            // 說不出原因才退回這句籠統的。★ 不編原因。
            textContent: sources.lastError(target.key) || "拿不到这条数据。",
          }),
        );
      } else if (model.kind === "problem") {
        card.appendChild(
          // ★ 展開標籤會讓卡片長高，必須就地重定位 —— 否則向下彈的卡會頂出視口。
          renderProblemCard(model, { origin: location.origin, onResize: position }),
        );
      } else {
        card.appendChild(
          renderUserCard(model, {
            origin: location.origin,
            viewerUid: viewer,
            onResize: position,
            // 匿名訪客不給寫入按鈕：點了必然被洛谷拒。
            onFollow: viewer ? (next) => follow.toggle(next) : null,
            onBlock: viewer ? (next) => follow.block(next) : null,
            followBusy: follow.isBusy(model.uid),
          }),
        );
      }
      // 插入之後才量得到「簽名有沒有溢出兩行」。
      // ★ 先摘掉載入態：這一次定位要用內容的真高，並沿用開卡時定的那一邊。
      loading = false;
      finalizeCard(card);
      position();
    };

    const intent = createHoverIntent({
      clock,
      onOpen: (key) => {
        shown = targets.get(key) || null;
        if (!shown) return;
        loading = true;
        openSide = null;
        card.textContent = "";
        card.appendChild(
          Object.assign(document.createElement("div"), {
            className: "luogusp-hc-spin",
          }),
        );
        card.hidden = false;
        position();
        draw(key);
      },
      onClose: () => {
        shown = null;
        loading = false;
        openSide = null;
        card.hidden = true;
        card.textContent = "";
      },
    });

    const onOver = (event) => {
      if (typeof event.clientX === "number")
        pointer = { x: event.clientX, y: event.clientY };
      // 指針落在卡片自己身上：維持當前卡，別關。
      if (card.contains(event.target)) {
        if (shown) intent.enter(shown.key);
        return;
      }
      // ★ 頁面主體每次 hover 現讀，不在 mount 時算一次：洛谷是 SPA，
      //   路由一換 pathname 就變了，快取下來會在下一頁拿舊主體做判斷。
      const target = resolveHoverTarget(
        event.target,
        identity,
        readPageSubject(location.pathname),
        location.pathname,
      );
      if (!target || !isEnabled(target.kind)) return;
      if (target.kind === "problem") stripNativeTitle(target.anchor);
      targets.set(target.key, target);
      intent.enter(target.key);
    };
    const onOut = (event) => {
      const to = event.relatedTarget;
      // 移到卡片上不算離開，否則卡上的按鈕永遠點不到。
      if (to && (card === to || card.contains(to))) return;
      intent.leave();
    };
    // ★★ owner 2026-08-14 第四輪：滾輪捲動時，指針明明還在卡片裡，卡片卻消失了。
    //    根因是這裡無條件 dismiss。卡片自己是可滾的（內容超高時 overflow:auto），
    //    在卡裡滾本來就不該關它 —— 而且此時頁面根本沒動，關掉純屬誤傷。
    //    判據用**指針最後落點**去問 `elementFromPoint`：捲動事件不帶座標，
    //    而 `pointer` 是每次 mouseover 更新的，捲動期間指針沒動，它就是準的。
    const pointerInsideCard = () => {
      if (!pointer || !document.elementFromPoint) return false;
      const under = document.elementFromPoint(pointer.x, pointer.y);
      return !!under && card.contains(under);
    };
    const onScroll = () => {
      if (pointerInsideCard()) return;
      intent.dismiss();
    };
    const onKey = (event) => {
      if (event.key === "Escape") intent.dismiss();
    };

    // ★★ 塊是被使用者那一次懸停拉下來的，而那個事件早就派發完了 —— 委託監聽接不到。
    //    所以薄殼把「指針當時在哪」交過來，這裡自己解析一次並**立刻打開**。
    //    ★ 不用補發合成事件：跨 realm 造事件脆，而且合成事件仍要再等 300ms 停留，
    //      體感還是「第一次懸停不彈」。
    if (options.replayAt && document.elementFromPoint) {
      const { x, y } = options.replayAt;
      const node = document.elementFromPoint(x, y);
      const primed =
        node && typeof node.closest === "function"
          ? resolveHoverTarget(
              node,
              identity,
              readPageSubject(location.pathname),
              location.pathname,
            )
          : null;
      if (primed && isEnabled(primed.kind)) {
        pointer = { x, y };
        if (primed.kind === "problem") stripNativeTitle(primed.anchor);
        targets.set(primed.key, primed);
        intent.open(primed.key);
      }
    }

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey);

    return () => {
      intent.dismiss();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey);
      restoreNativeTitles();
      targets.clear();
      card.remove();
    };
  };

  return Object.freeze({ mount });
}
