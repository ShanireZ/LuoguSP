import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { createProblemIdentityResolver } from "../problem-color/identity.js";
import { readCsrfToken, readViewerUid, resolveHoverTarget } from "./anchors.js";
import { placeCard, renderProblemCard, renderUserCard } from "./card-view.js";
import { createFollowAction } from "./follow-action.js";
import { createHoverIntent } from "./hover-intent.js";
import { createHoverCardSources } from "./sources.js";
import { HOVER_CARD_STYLE } from "./style.js";

// 题号 / 用户名 / 头像的悬停预览卡。
//
// 页面上满地是裸题号和裸用户名，现在只有颜色，看不出是什么题、是谁。这个功能把
// 题名、难度、通过率、标签（默认折叠）、我的状态，以及用户的通过数/排名/咕值/Elo/
// 获奖/关系 就地摊开，并带一枚复用洛谷原生契约的关注按钮。
//
// ★ 全部数据只走当前站同源（.com.cn）；一个字节都不碰国际站。
// ★ 靠事件委托，不靠 MutationObserver + rAF —— 隐藏标签页里 rAF 不触发。

const STYLE_ID = "luogusp-hover-card-style";
const CARD_ID = "luogusp-hover-card";

export function createHoverCardFeature(config) {
  const { storage, fetchPage } = config || {};

  const clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const identity = createProblemIdentityResolver({
    getOrigin: () => location.origin,
    voidAnchorSelector: "a[data-v-bade3303][data-v-4842157a]",
    standalonePidSelector: ".pid[title]",
  });

  const mount = () => {
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
        // 状态变了就地重画，别等下一次 hover。
        if (shown && shown.kind === "user" && shown.uid === uid) draw(shown.key);
      },
      logError: (error) => console.error("LuoguSP hover follow:", error),
    });

    // 当前正在展示的目标（由 hover-intent 决定），以及它的锚点矩形。
    let shown = null;
    const targets = new Map();

    const position = () => {
      if (!shown || card.hidden) return;
      const anchor = shown.anchor;
      if (!anchor || !anchor.getBoundingClientRect) return;
      placeCard(card, anchor.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    const draw = async (key) => {
      const target = targets.get(key);
      if (!target) return;
      const viewer = readViewerUid(document, window);
      const model =
        target.kind === "problem"
          ? await sources.problem(target.pid, viewer)
          : await sources.user(target.uid);
      // 等数据的过程中鼠标可能已经走了 —— 拿到了也不许再画。
      if (!shown || shown.key !== key) return;
      card.textContent = "";
      if (!model) {
        card.appendChild(
          Object.assign(document.createElement("div"), {
            className: "luogusp-hc-muted",
            textContent: "拿不到这条数据。",
          }),
        );
      } else if (model.kind === "problem") {
        card.appendChild(renderProblemCard(model, { origin: location.origin }));
      } else {
        card.appendChild(
          renderUserCard(model, {
            origin: location.origin,
            // 匿名访客不给关注按钮：点了必然被洛谷拒。
            onFollow: viewer ? (next) => follow.toggle(next) : null,
            followBusy: follow.isBusy(model.uid),
          }),
        );
      }
      position();
    };

    const intent = createHoverIntent({
      clock,
      onOpen: (key) => {
        shown = targets.get(key) || null;
        if (!shown) return;
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
        card.hidden = true;
        card.textContent = "";
      },
    });

    const onOver = (event) => {
      // 指针落在卡片自己身上：维持当前卡，别关。
      if (card.contains(event.target)) {
        if (shown) intent.enter(shown.key);
        return;
      }
      const target = resolveHoverTarget(event.target, identity);
      if (!target) return;
      targets.set(target.key, target);
      intent.enter(target.key);
    };
    const onOut = (event) => {
      const to = event.relatedTarget;
      // 移到卡片上不算离开，否则卡上的按钮永远点不到。
      if (to && (card === to || card.contains(to))) return;
      intent.leave();
    };
    const onScroll = () => intent.dismiss();
    const onKey = (event) => {
      if (event.key === "Escape") intent.dismiss();
    };

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
      targets.clear();
      card.remove();
    };
  };

  return defineConfigurableFeature({
    id: "hover-card",
    key: "showHoverCards",
    label: "题号与用户悬停预览卡",
    storage,
    mount,
  });
}
