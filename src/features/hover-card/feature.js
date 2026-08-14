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
  // ★ 设置项的身份（id/key/label）在**薄壳**手里，不在这里 —— 这个块只负责干活。
  //   `isEnabled(kind)` 是薄壳现问的：owner 把开关拆成了题目卡与用户卡两个，
  //   改开关要**立刻生效**，不能靠重挂。
  const { fetchPage, isEnabled = () => true } = config || {};

  const clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const identity = createProblemIdentityResolver({
    getOrigin: () => location.origin,
    voidAnchorSelector: "a[data-v-bade3303][data-v-4842157a]",
    // ★ 不给 standalonePidSelector：`.pid[title]` 已经从锚点选择器里拿掉了
    //   （题库的题号格靠那个 title 着色，我们碰不得）。见 anchors.js 的说明。
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
      // ★ 屏蔽是替用户对第三方做的社交动作，发请求前必须让他自己点头。
      confirm: (message) => window.confirm(message),
      logError: (error) => console.error("LuoguSP hover follow:", error),
    });

    // 当前正在展示的目标（由 hover-intent 决定），以及它的锚点矩形。
    let shown = null;
    const targets = new Map();
    // ★ owner 要求屏蔽洛谷原生的题号悬停。原生那个就是 `.pid[title]` 上的 title 属性
    //   （problem-color 的选择器就叫这个名字）触发的浏览器浮泡 —— 我们的卡片一接管，
    //   两层提示就会打架。摘掉 title，并记下原值，dispose 时还回去。
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

    // 最近一次指针坐标：跨行锚点要靠它挑出「指针所在的那一行」来定位，
    // 否则卡片会被推到整个盒子的下沿，离题号很远。
    let pointer = null;
    // 从锚点的多个 client rect 里挑包含指针纵坐标的那一行；挑不到就退回整体盒子。
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

    const position = () => {
      if (!shown || card.hidden) return;
      const anchor = shown.anchor;
      if (!anchor || !anchor.getBoundingClientRect) return;
      placeCard(card, rectForPointer(anchor), {
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
            // 洛谷自己说了原因就照搬（例如「该用户未通过实名认证」），
            // 说不出原因才退回这句笼统的。★ 不编原因。
            textContent: sources.lastError(target.key) || "拿不到这条数据。",
          }),
        );
      } else if (model.kind === "problem") {
        card.appendChild(
          // ★ 展开标签会让卡片长高，必须就地重定位 —— 否则向下弹的卡会顶出视口。
          renderProblemCard(model, { origin: location.origin, onResize: position }),
        );
      } else {
        card.appendChild(
          renderUserCard(model, {
            origin: location.origin,
            viewerUid: viewer,
            onResize: position,
            // 匿名访客不给写入按钮：点了必然被洛谷拒。
            onFollow: viewer ? (next) => follow.toggle(next) : null,
            onBlock: viewer ? (next) => follow.block(next) : null,
            followBusy: follow.isBusy(model.uid),
          }),
        );
      }
      // 插入之后才量得到「签名有没有溢出两行」。
      finalizeCard(card);
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
      if (typeof event.clientX === "number")
        pointer = { x: event.clientX, y: event.clientY };
      // 指针落在卡片自己身上：维持当前卡，别关。
      if (card.contains(event.target)) {
        if (shown) intent.enter(shown.key);
        return;
      }
      // ★ 页面主体每次 hover 现读，不在 mount 时算一次：洛谷是 SPA，
      //   路由一换 pathname 就变了，缓存下来会在下一页拿旧主体做判断。
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
      // 移到卡片上不算离开，否则卡上的按钮永远点不到。
      if (to && (card === to || card.contains(to))) return;
      intent.leave();
    };
    // ★★ owner 2026-08-14 第四轮：滚轮滚动时，指针明明还在卡片里，卡片却消失了。
    //    根因是这里无条件 dismiss。卡片自己是可滚的（内容超高时 overflow:auto），
    //    在卡里滚本来就不该关它 —— 而且此时页面根本没动，关掉纯属误伤。
    //    判据用**指针最后落点**去问 `elementFromPoint`：滚动事件不带坐标，
    //    而 `pointer` 是每次 mouseover 更新的，滚动期间指针没动，它就是准的。
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
