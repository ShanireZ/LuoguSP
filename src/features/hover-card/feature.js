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
import { createUserMedia } from "./user-media.js";

const STYLE_ID = "luogusp-hover-card-style";
const CARD_ID = "luogusp-hover-card";
const NATIVE_OWNERSHIP_CLASS = "luogusp-hc-owns-user-preview";

export function createHoverCardFeature(config) {
  const { fetchPage, problemData, nativeUserInfo, isEnabled = () => true, anchors } = config;
  if (typeof fetchPage !== "function") throw new TypeError("Hover card requires a fetch adapter");
  const { readCsrfToken, readViewerUid, resolveHoverTarget } = anchors;
  const currentViewer = () => problemData?.viewerUid() ?? readViewerUid(document, window) ?? 0;
  const settings = () => document.getElementById("luogusp-settings");
  let dismissUserPreview;

  const clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const mount = (options = {}) => {
    const body = document.body;
    if (!body) return () => {};
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
    body.appendChild(card);
    const visualViewport = window.visualViewport;
    const claimNativeUserPreview = (ownsPreview) =>
      body.classList.toggle(NATIVE_OWNERSHIP_CLASS, ownsPreview);
    const allowMotion = window.matchMedia?.("(prefers-reduced-motion: no-preference)");
    const origin = location.origin;
    const fadeLateField = (node) => node.animate?.(
      [{ opacity: 0.8 }, { opacity: 1 }],
      { duration: 125, easing: "ease-out" },
    );

    const sources = createHoverCardSources({
      fetchPage,
      origin,
      problemData,
      nativeUserInfo,
      viewer: currentViewer,
      clock,
      logError: (error) => console.error("LuoguSP hover card:", error),
    });
    const follow = createFollowAction({
      origin,
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
      for (const node of [anchor, ...anchor.querySelectorAll("[title]")]) {
        if (strippedTitles.has(node)) continue;
        const title = node.getAttribute("title");
        if (title === null) continue;
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
      const rects = [...anchor.getClientRects()];
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
    let signature;
    let signatureWidth;
    const measureSignature = () => {
      const width = signature?.getBoundingClientRect().width;
      if (width && width !== signatureWidth) {
        signatureWidth = width;
        finalizeCard(card);
      }
    };

    const position = () => {
      const target = shown;
      const anchor = target?.anchor;
      if (!anchor || card.hidden) return;
      const placement = placeCard(
        card,
        rectForPointer(anchor),
        visualViewport ? {
          x: visualViewport.offsetLeft,
          y: visualViewport.offsetTop,
          width: visualViewport.width,
          height: visualViewport.height,
        } : { width: window.innerWidth, height: window.innerHeight },
        {
          assumeMinHeight: loading ? LOADING_MIN_HEIGHT : 0,
          forceBelow: openSide,
          measureSignature,
        },
      );
      // 載入態記住這一邊；內容一完成實作就交還自由。
      openSide = loading ? placement.below : null;
      if (target.kind !== "problem") {
        card.querySelector(".luogusp-hc-expand:focus")
          ?.scrollIntoView({ block: "nearest", behavior: "instant" });
        return;
      }
      const control = card.querySelector(".luogusp-hc-actions :focus, .luogusp-hc-tagbtn:focus");
      if (!control) return;
      const top = card.getBoundingClientRect().top + card.clientTop;
      const rect = control.getBoundingClientRect();
      const above = top - rect.top;
      const below = rect.bottom - (top + card.clientHeight);
      // The scrollport metrics round to CSS pixels. Keep the offset within that tolerance.
      if (above > 1) card.scrollTop -= above;
      else if (below > 1) card.scrollTop += below;
    };

    const signatureObserver = typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(([entry]) => {
        // Reconcile after this delivery so collapsing the signature can resize the card.
        if (entry.contentRect.width !== signatureWidth) requestAnimationFrame(position);
      }) : null;
    const watchSignature = () => {
      signatureObserver?.disconnect();
      signature = card.querySelector(".luogusp-hc-clamp");
      signatureWidth = 0;
      if (signature) signatureObserver?.observe(signature);
    };

    const draw = async (target, viewer) => {
      const { signal } = openController;
      const isCurrent = () => !signal.aborted && shown === target && isEnabled(target.kind);
      const showMedia = target.kind === "user" ? createUserMedia(fetchPage, signal) : null;
      const canAct = () => {
        if (!isCurrent()) return false;
        if (currentViewer() === viewer) return true;
        intent.dismiss();
        return false;
      };
      let displayed;
      let relationNotice;
      let pendingAction;
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
            origin, href: target.href, onResize: position, tagsExpanded,
          }), fadeField);
        } else {
          pendingAction = updateUserCard(card,
            renderUserCard(model, {
              origin,
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
            pendingAction,
          );
          showMedia(card.firstElementChild, model);
          claimNativeUserPreview(true);
        }
        watchSignature();
        card.scrollTop = scrollTop;
        position();
      };
      if (target.kind === "problem") {
        const model = await sources.problem(target.pid, viewer, signal, {
          href: target.href, onUpdate: display,
        });
        if (model || displayed === undefined) display(model);
      } else {
        updateShownUser = (account, uid, model, patch, busy, notice) => {
          if (account !== viewer || uid !== target.uid || !(model || displayed)) return;
          relationNotice = notice;
          display(model ?? { ...displayed, ...patch }, busy);
        };
        display(await sources.user(target.uid, signal, display));
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
            current.href !== target.href || !isEnabled(target.kind) || settings()) {
          intent.dismiss();
          return;
        }
        const viewer = currentViewer();
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
        draw(target, viewer);
      },
      onClose: () => {
        const anchor = shown?.anchor;
        openController?.abort();
        openController = null;
        claimNativeUserPreview(false);
        shown = null;
        keyboardPreview = false;
        updateShownUser = null;
        loading = false;
        openSide = null;
        if (anchor?.isConnected && card.contains(document.activeElement))
          anchor.focus({ preventScroll: true });
        card.hidden = true;
        card.textContent = "";
        watchSignature();
      },
    });
    const stopViewer = problemData?.subscribeViewer(() => {
      if (shown?.kind === "problem") intent.dismiss();
    });

    const targetAt = (node) => {
      if (settings()) return null;
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
      if (event.target === card || event.target?.isConnected === false || pointerInsideCard()) return;
      intent.dismiss();
    };
    const onKey = (event) => {
      if (event.defaultPrevented) return;
      if (isPreviewShortcut(event) && enterWithKeyboard(event.target)) event.preventDefault();
      if (event.key === "Escape") intent.dismiss();
      if (event.key === "Tab" && card.contains(event.target)) {
        const controls = [...card.querySelectorAll("a[href], button:not(:disabled)")]
          .filter(node => node.tabIndex >= 0 && node.getClientRects().length);
        const edge = event.shiftKey ? controls[0] : controls.at(-1);
        // Let the browser continue Tab from the restored trigger's place in the page.
        if (!edge || event.target === edge || (event.shiftKey && event.target === card)) intent.dismiss();
      }
    };
    const onFocusOut = (event) => {
      if (event.relatedTarget && !card.contains(event.relatedTarget) && !pointerInsideCard())
        intent.dismiss();
    };
    const onFocusIn = (event) => {
      if (settings()?.contains(event.target)) intent.dismiss();
    };
    dismissUserPreview = () => {
      if (shown?.kind === "user" || (!shown && candidate?.kind === "user")) intent.dismiss();
    };

    // ★★ 塊是被使用者那一次懸停拉下來的，而那個事件早就派發完了 —— 委託監聽接不到。
    //    所以薄殼把「指針當時在哪」交過來，這裡自己解析一次並**立刻打開**。
    //    ★ 不用補發合成事件：跨 realm 造事件脆，而且合成事件仍要再等 300ms 停留，
    //      體感還是「第一次懸停不彈」。
    const listeners = [
      [document, "mouseover", onOver, true],
      [document, "mouseout", onOut, true],
      [window, "scroll", onScroll, true],
      [window, "resize", position],
      [visualViewport, "resize", position],
      [visualViewport, "scroll", position],
      [document, "keydown", onKey],
      [document, "focusin", onFocusIn],
      [card, "focusout", onFocusOut],
    ];
    for (const [target, type, listener, capture] of listeners)
      target?.addEventListener(type, listener, capture);

    const dispose = () => {
      stopViewer?.();
      intent.dismiss();
      dismissUserPreview = null;
      for (const [target, type, listener, capture] of listeners)
        target?.removeEventListener(type, listener, capture);
      restoreNativeTitles();
      card.remove();
    };
    try {
      if (options.replayFocus) enterWithKeyboard(options.replayFocus);
      else if (options.replayAt && document.elementFromPoint) {
        const { x, y } = options.replayAt;
        const primed = targetAt(document.elementFromPoint(x, y));
        if (primed) {
          pointer = { x, y };
          intent.open(primed);
        }
      }
    } catch (error) {
      dispose();
      throw error;
    }
    return dispose;
  };

  return Object.freeze({ mount, dismissUserPreview: () => dismissUserPreview?.() });
}
