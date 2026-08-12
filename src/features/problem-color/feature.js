import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { createGetRequestScheduler } from "../../core/get-request-scheduler.js";
import { createProblemIdentityResolver } from "./identity.js";
import {
  collectDifficultyBatches,
  readLentilleData,
} from "./lentille-harvest.js";
import { createProblemPipeline } from "./pipeline.js";
import { isProblemAnchorColorable } from "./practice-policy.js";

export function createProblemColorFeature({ storage }) {
  const DIFFICULTY_COLORS = [
    "#bfbfbf",
    "#fe4c61",
    "#f39c11",
    "#ffc116",
    "#52c41a",
    "#14b8a6",
    "#3498db",
    "#9d3dcf",
    "#0f172a",
  ];
  const FALLBACK_COLOR = "#bfbfbf";
  const diffColor = (difficulty) =>
    DIFFICULTY_COLORS[difficulty] || FALLBACK_COLOR;
  const SELECTORS = {
    voidAnchor: "a[data-v-bade3303][data-v-4842157a]",
    standalonePid: ".pid[title]",
  };

  // ============================================================
  // 题号显示难度颜色
  // ============================================================
  // 单队列 FIFO：300ms 发起间隔、最多 3 并发、15s 超时。
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

  // 把子树中第一处 pid 文本包成 <b>（纯 DOM，避免 innerHTML.replace 误伤属性内同名子串、
  // 重建整个锚点子树、抖掉已绑定的监听）。返回创建的包裹节点，未找到则返回 null。
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
      // 练习页只收“尝试过的题目”；“已通过”已按难度分组，既不着色也不入缓存。
      // 评测记录列表仍随页面下发整批难度，省掉逐题请求。
      // 数据源与判据见 lentille-harvest.js（原先读的 window._feInstance 已全站消失）。
      harvest: () => collectDifficultyBatches(readLentilleData()),
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
      appliedPid: (anchor) => anchor.dataset.luoguspPid,
      isConnected: (anchor) => anchor.isConnected,
      clearColor: (anchor) => clearProblemColor(anchor),
      applyColor: (a, pid, color) => {
        // 虚拟列表可能在请求期间复用锚点；Problem Pipeline 已复核身份后才会到这里。
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
          a.dataset.luoguspPid = pid;
        } else {
          const wrapper = wrapPidText(a, pid, color);
          if (!wrapper) return;
          appliedProblemColors.set(a, {
            kind: "wrapper",
            node: wrapper,
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
      let disposePipeline = null;
      const timer = setTimeout(() => {
        if (!context.isCurrent()) return;
        try {
          disposePipeline = problemPipeline
            ? problemPipeline.mount()
            : () => {};
        } catch (error) {
          console.error("LuoguSP lifecycle problem-pipeline:", error);
        }
      }, 500);
      return () => {
        clearTimeout(timer);
        if (disposePipeline) disposePipeline();
      };
    },
  });
}
