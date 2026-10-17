import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { createGetRequestScheduler } from "../../core/get-request-scheduler.js";
import { DIFFICULTY_COLORS } from "../../core/luogu-difficulty.js";
import { createProblemIdentityResolver } from "./identity.js";
import { createNativeDifficultySource } from "./native-difficulty-source.js";
import { createProblemPipeline } from "./pipeline.js";
import { isProblemAnchorColorable } from "./practice-policy.js";

export function createProblemColorFeature({ storage }) {
  // ★ 色表**不在這裡** —— 唯一一份在 `core/luogu-difficulty.js`。
  //   它以前在這裡另存了一份，和懸停卡那份同時錯了兩檔（2.14.1 修正）。
  const FALLBACK_COLOR = DIFFICULTY_COLORS[0];
  const diffColor = (difficulty) =>
    DIFFICULTY_COLORS[difficulty] || FALLBACK_COLOR;
  const SELECTORS = {
    voidAnchor: "a[data-v-bade3303][data-v-4842157a]",
    standalonePid: ".pid[title]",
  };

  // ============================================================
  // 題號顯示難度顏色
  // ============================================================
  // 單佇列 FIFO：300ms 發起間隔、最多 3 並行、15s 超時。
  const limiter = createGetRequestScheduler({
    fetch: (url, init) => fetch(url, init),
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    },
    launchGap: 300,
    concurrency: 3,
    timeoutMs: 15000,
    maxRetries: 1,
  });

  const PROBLEM_ANCHOR_SELECTOR = [
    'a[href*="/problem/"]',
    'a[href*="?forum="]',
    SELECTORS.voidAnchor,
    SELECTORS.standalonePid,
  ].join(",");

  const problemIdentity = createProblemIdentityResolver({
    getOrigin: () => location.origin,
    voidAnchorSelector: SELECTORS.voidAnchor,
    standalonePidSelector: SELECTORS.standalonePid,
  });
  const shouldColorProblemAnchor = (anchor) =>
    isProblemAnchorColorable(anchor, location.pathname);
  const shouldProcessProblemAnchor = (anchor) =>
    shouldColorProblemAnchor(anchor) || Boolean(anchor?.dataset?.luoguspPid);
  const problemAnchorIdentity = Object.freeze({
    resolve: (anchor) =>
      shouldColorProblemAnchor(anchor)
        ? problemIdentity.resolve(anchor)
        : null,
  });

  // 把子樹中第一處 pid 文字包成 <b>（純 DOM，避免 innerHTML.replace 誤傷屬性內同名子串、
  // 重建整個錨點子樹、抖掉已綁定的監聽）。回傳建立的包裹節點，未找到則回傳 null。
  function wrapPidText(root, pid, color) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(pid);
      if (idx === -1) continue;
      const mid = node.splitText(idx); // mid 以 pid 開頭
      mid.splitText(pid.length); // 把 pid 之後的部分切走，mid 現在正好等於 pid
      const b = document.createElement("b");
      b.style.color = color;
      b.textContent = pid;
      mid.parentNode.replaceChild(b, mid);
      return b;
    }
    return null;
  }

  const appliedProblemColors = new WeakMap();
  const captureInlineProperty = (element, property) =>
    Object.freeze({
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
  const restoreInlineProperty = (element, property, original) => {
    if (original.value)
      element.style.setProperty(property, original.value, original.priority);
    else element.style.removeProperty(property);
  };
  const clearProblemColor = (anchor) => {
    const state = appliedProblemColors.get(anchor);
    if (state && state.node && anchor.contains(state.node)) {
      if (state.kind === "span" || state.kind === "standalone") {
        restoreInlineProperty(state.node, "color", state.color);
        restoreInlineProperty(state.node, "font-weight", state.fontWeight);
      } else if (state.kind === "wrapper") {
        state.node.replaceWith(document.createTextNode(state.node.textContent || ""));
        anchor.normalize();
      }
    }
    appliedProblemColors.delete(anchor);
    delete anchor.dataset.luoguspPid;
  };

  const nativeDifficulty = typeof document === "undefined" ? null :
    createNativeDifficultySource({
      document,
      XMLHttpRequest: globalThis.XMLHttpRequest,
      origin: location.origin,
    });

  const problemPipeline =
    typeof document === "undefined"
      ? null
      : createProblemPipeline({
    identity: problemAnchorIdentity,
    routeAdapter: {
      token: () =>
        `${location.origin}${location.pathname}${location.search}`,
    },
    difficultySource: {
      text: (path, options) => limiter.text(path, options),
      // 練習頁只收“嘗試過的題目”；“已通過”已按難度分組，既不著色也不入快取。
      // 評測記錄列表的題號洛谷已經上色，practice-policy.js 會整頁跳過。
      // 列表 payload 裡的難度仍收進快取，離開該頁後的題號不用逐題再請求。
      // 首屏 JSON + 洛谷自身導覽請求的回應，不額外請求頁面資料。
      harvest: () => nativeDifficulty.harvest(),
      subscribe: (accept) => nativeDifficulty.subscribe(accept),
    },
    colorForDifficulty: (difficulty) => diffColor(difficulty),
    logError: (pid, error) =>
      console.error("LuoguSP difficulty:", pid, error),
    documentAdapter: {
      root: document,
      anchors: (root) => {
        if (!root || !root.querySelectorAll) return [];
        const anchors = [];
        if (
          root.matches &&
          root.matches(PROBLEM_ANCHOR_SELECTOR) &&
          shouldProcessProblemAnchor(root)
        )
          anchors.push(root);
        root
          .querySelectorAll(PROBLEM_ANCHOR_SELECTOR)
          .forEach((anchor) => {
            if (shouldProcessProblemAnchor(anchor)) anchors.push(anchor);
          });
        return anchors;
      },
      observeAnchors: (accept) => {
        const observer = new MutationObserver((mutations) => {
          if (mutations.some((mutation) =>
            mutation.target.id === "lentille-context" ||
            mutation.target.parentElement?.id === "lentille-context" ||
            Array.from(mutation.addedNodes || []).some((node) => node.id === "lentille-context"),
          )) {
            accept(document.querySelectorAll(PROBLEM_ANCHOR_SELECTOR));
            return;
          }
          const anchors = new Set();
          const addAnchor = (anchor) => {
            if (anchor && shouldProcessProblemAnchor(anchor))
              anchors.add(anchor);
          };
          const addDescendants = (root) => {
            if (!root || !root.querySelectorAll) return;
            if (root.matches && root.matches(PROBLEM_ANCHOR_SELECTOR))
              addAnchor(root);
            root
              .querySelectorAll(PROBLEM_ANCHOR_SELECTOR)
              .forEach(addAnchor);
          };
          const reconsiderPracticeCard = (target) => {
            if (!target || typeof target.closest !== "function") return;
            const card = target.closest(".l-card");
            if (card) addDescendants(card);
          };
          for (const mutation of mutations) {
            if (mutation.type === "childList") {
              for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                addDescendants(node);
              }
              reconsiderPracticeCard(mutation.target);
            } else if (mutation.type === "characterData") {
              const element = mutation.target.parentElement;
              reconsiderPracticeCard(element);
              if (
                element &&
                element.matches &&
                element.matches(SELECTORS.standalonePid)
              ) {
                addAnchor(element);
                continue;
              }
              const anchor =
                element &&
                element.matches &&
                element.matches("span.pid") &&
                element.closest("a[href]");
              addAnchor(anchor);
            } else if (mutation.type === "attributes") {
              addAnchor(mutation.target);
              if (
                mutation.attributeName === "href" &&
                mutation.target.parentElement
              )
                mutation.target.parentElement
                  .querySelectorAll(SELECTORS.standalonePid)
                  .forEach(addAnchor);
            }
          }
          accept(anchors);
        });
        observer.observe(document, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["href", "title"],
        });
        return () => observer.disconnect();
      },
      appliedPid: (anchor) => {
        const state = appliedProblemColors.get(anchor);
        return state && anchor.contains(state.node) && state.node.style.color === state.paintColor
          ? anchor.dataset.luoguspPid : null;
      },
      isConnected: (anchor) => anchor.isConnected,
      clearColor: (anchor) => clearProblemColor(anchor),
      applyColor: (a, pid, color) => {
        // 虛擬列表可能在請求期間重複使用錨點；Problem Pipeline 已複核身分後才會到這裡。
        clearProblemColor(a);
        if (
          a.matches(SELECTORS.standalonePid) &&
          (a.getAttribute("title") || "").trim() === pid &&
          (a.innerText || a.textContent || "").trim() === pid
        ) {
          appliedProblemColors.set(a, {
            kind: "standalone",
            node: a,
            color: captureInlineProperty(a, "color"),
            fontWeight: captureInlineProperty(a, "font-weight"),
          });
          a.style.color = color;
          a.style.fontWeight = "bold";
          appliedProblemColors.get(a).paintColor = a.style.color;
          a.dataset.luoguspPid = pid;
          return;
        }
        const span = a.children[0];
        if (
          span &&
          span.matches("span.pid") &&
          (span.innerText || span.textContent || "").trim() === pid
        ) {
          appliedProblemColors.set(a, {
            kind: "span",
            node: span,
            color: captureInlineProperty(span, "color"),
            fontWeight: captureInlineProperty(span, "font-weight"),
          });
          span.style.color = color;
          span.style.fontWeight = "bold";
          appliedProblemColors.get(a).paintColor = span.style.color;
          a.dataset.luoguspPid = pid;
        } else {
          const wrapper = wrapPidText(a, pid, color);
          if (!wrapper) return;
          appliedProblemColors.set(a, {
            kind: "wrapper",
            node: wrapper,
            paintColor: wrapper.style.color,
          });
          a.dataset.luoguspPid = pid;
        }
      },
    },
  });

  return defineConfigurableFeature({
    id: "problem-pipeline",
    key: "addProblemsColor",
    label: "题号显示难度颜色",
    storage,
    mount: (context) => {
      if (!context.isCurrent()) return () => {};
      // Observe immediately; only the query fallback waits 300ms in the pipeline.
      return problemPipeline ? problemPipeline.mount() : () => {};
    },
  });
}
