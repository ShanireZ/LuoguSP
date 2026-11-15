import {
  readCsrfToken,
  readViewerUid,
  resolveHoverTarget,
} from "./anchors.js";
import {
  finalizeCard,
  placeCard,
  renderProblemCard,
  renderUserCard,
  updateProblemCard,
  updateUserCard,
} from "./card-view.js";
import { createFollowAction } from "./follow-action.js";
import { createHoverIntent, isPreviewShortcut } from "./hover-intent.js";
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
  const { fetchPage, problemData, nativeUserInfo, isEnabled = () => true } = config || {};
  const currentViewer = () => problemData?.viewerUid() ?? readViewerUid(document, window) ?? 0;

  const clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
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
    card.tabIndex = -1;
    card.setAttribute("role", "dialog");
    document.body.appendChild(card);
    const allowMotion = window.matchMedia?.("(prefers-reduced-motion: no-preference)");
    const fadeLateField = (node) => node.animate?.(
      [{ opacity: 0.8 }, { opacity: 1 }],
      { duration: 125, easing: "ease-out" },
    );

    const sources = createHoverCardSources({
      fetchPage: (path, signal, init) => fetchPage(path, signal, init),
      problemData,
      nativeUserInfo,
      viewer: currentViewer,
      clock,
      logError: (error) => console.error("LuoguSP hover card:", error),
    });
    const follow = createFollowAction({
      origin: location.origin,
      csrfToken: () => readCsrfToken(document),
      request: (payload) =>
        fetchPage(payload.url, undefined, {
          method: payload.method,
          headers: payload.headers,
          body: payload.body,
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "error",
        }),
      onState: (viewer, uid, patch, phase, notice) => {
        const updated = sources.patchUser(viewer, uid, patch);
        updateShownUser?.(viewer, uid, updated, patch, phase === "pending", notice);
      },
    });

    // 當前正在展示的目標（由 hover-intent 決定），以及它的錨點矩形。
    let shown = null;
    let candidate = null;
    let openController;
    let keyboardPreview = false;
    let updateShownUser;
    // ★ owner 要求屏蔽洛谷原生的題號懸停。原生那個就是 `.pid[title]` 上的 title 屬性
    //   （problem-color 的選擇器就叫這個名字）觸發的瀏覽器浮泡 —— 我們的卡片一接管，
    //   兩層提示就會打架。摘掉 title，並記下原值，dispose 時還回去。
    const strippedTitles = new Map();
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
      for (const [node, title] of strippedTitles)
        if (!node.hasAttribute("title")) node.setAttribute("title", title);
      strippedTitles.clear();
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

    const draw = async (target) => {
      const viewer = currentViewer();
      const controller = openController;
      const isCurrent = () => !controller?.signal.aborted && shown === target;
      const canAct = () => {
        if (!isCurrent()) return false;
        if (currentViewer() === viewer) return true;
        intent.dismiss();
        return false;
      };
      let displayed;
      let relationNotice;
      const display = (model, busy) => {
        if (!isCurrent() || displayed === model) return;
        if (target.kind === "user" && currentViewer() !== viewer) return;
        const previous = displayed;
        displayed = model;
        const fadeField = previous && busy === undefined && allowMotion?.matches ? fadeLateField : undefined;
        const tagsExpanded = !!card.querySelector(".luogusp-hc-taglist:not([hidden])");
        const scrollTop = card.scrollTop;
        if (!model) {
          card.replaceChildren(
            Object.assign(document.createElement("div"), {
              className: "luogusp-hc-muted",
              textContent: sources.lastError(target.key) || "拿不到这条数据。",
            }),
          );
        } else if (model.kind === "problem") {
          updateProblemCard(card, renderProblemCard(model, {
            origin: location.origin, href: target.href, onResize: position, tagsExpanded,
          }), fadeField);
        } else {
          updateUserCard(card,
            renderUserCard(model, {
              origin: location.origin,
              viewerUid: viewer,
              onResize: position,
              onFollow: viewer ? (next) => canAct() && follow.toggle(viewer, next) : null,
              onBlock: viewer ? (next) => canAct() && follow.block(viewer, next) : null,
              followBusy: busy ?? follow.isBusy(viewer, model.uid),
              relationNotice,
            }),
            busy === undefined && previous?.name === model.name &&
              previous.relation === model.relation && previous.reverseRelation === model.reverseRelation &&
              previous.followerCount === model.followerCount,
            fadeField,
          );
        }
        finalizeCard(card);
        position();
        card.scrollTop = scrollTop;
      };
      if (target.kind === "problem") {
        const model = await sources.problem(target.pid, viewer, controller?.signal, {
          href: target.href, onUpdate: display,
        });
        if (model || displayed === undefined) display(model);
      } else {
        updateShownUser = (account, uid, model, patch, busy, notice) => {
          if (account !== viewer || uid !== target.uid || !(model || displayed)) return;
          relationNotice = notice;
          display(model ?? { ...displayed, ...patch }, busy);
        };
        display(await sources.user(target.uid, display));
      }
      if (!isCurrent()) return;
      loading = false;
      openSide = null;
    };

    const intent = createHoverIntent({
      clock,
      onOpen: (target) => {
        // 錨點可能在等待懸停的期間被頁面重用。
        const current = resolveHoverTarget(target.anchor);
        if (!target.anchor.isConnected || !current || current.key !== target.key ||
            current.href !== target.href || !isEnabled(target.kind)) {
          intent.dismiss();
          return;
        }
        shown = target;
        openController = new AbortController();
        loading = true;
        openSide = null;
        const status = document.createElement("div");
        status.className = "luogusp-hc-loading";
        status.setAttribute("role", "status");
        const indicator = document.createElement("span");
        indicator.className = "luogusp-hc-spin";
        indicator.setAttribute("aria-hidden", "true");
        status.append(indicator, "正在加载预览…");
        card.replaceChildren(status);
        card.hidden = false;
        card.setAttribute("aria-label", target.kind === "problem" ? "题目预览" : "用户预览");
        position();
        draw(target);
      },
      onClose: () => {
        openController?.abort();
        openController = null;
        shown = null;
        keyboardPreview = false;
        updateShownUser = null;
        loading = false;
        openSide = null;
        card.hidden = true;
        card.textContent = "";
      },
    });

    const targetAt = (node) => {
      const target = resolveHoverTarget(node);
      if (!target || !isEnabled(target.kind)) return null;
      const { anchor, href } = target;
      for (const existing of [shown, candidate])
        if (existing?.anchor === anchor && existing.key === target.key && existing.href === href)
          return existing;
      if (target.kind === "problem") stripNativeTitle(anchor);
      return target;
    };

    const enterWithKeyboard = (node) => {
      if (!node || card.contains(node)) return false;
      const target = targetAt(node);
      if (!target || target.anchor !== node) return false;
      pointer = null;
      intent.open(target);
      keyboardPreview = true;
      card.focus({ preventScroll: true });
      return true;
    };

    const onOver = (event) => {
      if (typeof event.clientX === "number")
        pointer = { x: event.clientX, y: event.clientY };
      // 指針落在卡片自己身上：維持當前卡，別關。
      if (card.contains(event.target)) {
        if (shown) intent.enter(shown);
        return;
      }
      // ★ 頁面主體每次 hover 現讀，不在 mount 時算一次：洛谷是 SPA，
      //   路由一換 pathname 就變了，快取下來會在下一頁拿舊主體做判斷。
      if (keyboardPreview && card.contains(document.activeElement)) return;
      const target = targetAt(event.target);
      if (!target) {
        candidate = null;
        intent.leave();
        return;
      }
      candidate = target;
      intent.enter(target);
    };
    const onOut = (event) => {
      const to = event.relatedTarget;
      // 移到卡片上不算離開，否則卡上的按鈕永遠點不到。
      if (to && (card === to || card.contains(to))) return;
      if (keyboardPreview && card.contains(document.activeElement)) return;
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
    const onScroll = (event) => {
      if (event.target === card || pointerInsideCard()) return;
      intent.dismiss();
    };
    const onKey = (event) => {
      if (event.defaultPrevented) return;
      if (isPreviewShortcut(event) && enterWithKeyboard(event.target)) event.preventDefault();
      if (event.key === "Escape") {
        const anchor = shown?.anchor;
        const restore = card.contains(document.activeElement);
        intent.dismiss();
        if (restore && anchor?.isConnected) anchor.focus({ preventScroll: true });
      }
    };
    const onFocusOut = (event) => {
      if (event.relatedTarget && !card.contains(event.relatedTarget) && !pointerInsideCard())
        intent.dismiss();
    };

    // ★★ 塊是被使用者那一次懸停拉下來的，而那個事件早就派發完了 —— 委託監聽接不到。
    //    所以薄殼把「指針當時在哪」交過來，這裡自己解析一次並**立刻打開**。
    //    ★ 不用補發合成事件：跨 realm 造事件脆，而且合成事件仍要再等 300ms 停留，
    //      體感還是「第一次懸停不彈」。
    if (options.replayFocus) enterWithKeyboard(options.replayFocus);
    else if (options.replayAt && document.elementFromPoint) {
      const { x, y } = options.replayAt;
      const node = document.elementFromPoint(x, y);
      const primed = targetAt(node);
      if (primed) {
        pointer = { x, y };
        intent.open(primed);
      }
    }

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey);
    card.addEventListener("focusout", onFocusOut);

    return () => {
      intent.dismiss();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey);
      restoreNativeTitles();
      card.remove();
    };
  };

  return Object.freeze({ mount });
}
