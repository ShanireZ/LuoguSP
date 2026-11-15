import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { createGetRequestScheduler } from "../../core/get-request-scheduler.js";
import { DIFFICULTY_COLORS, DIFFICULTY_COLOR_NAMES } from "../../core/luogu-difficulty.js";
import { createProblemIdentityResolver } from "./identity.js";
import { createNativeDifficultySource, recordRouteId } from "./native-difficulty-source.js";
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
    fetch: (url, init) => fetch(url, url.endsWith("?_contentOnly=1")
      ? { ...init, headers: { "x-lentille-request": "content-only" } }
      : init),
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
    "[data-luogusp-pid]",
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
  const appliedProblemColors = new WeakMap();
  const nativeColorClasses = DIFFICULTY_COLOR_NAMES.map((name) => `lcolor--${name}`);
  const problemAnchorIdentity = Object.freeze({
    resolve: (anchor) => {
      if (!shouldColorProblemAnchor(anchor)) return null;
      const identity = problemIdentity.resolve(anchor);
      if (!identity) return null;
      const record = recordRouteId(location.pathname);
      if (record) {
        const difficulty = getRecordDifficulty(anchor, record, identity.pid);
        if (difficulty === undefined || hasNativeColor(anchor, identity.pid)) return null;
        const name = DIFFICULTY_COLOR_NAMES[difficulty];
        return { ...identity, recordColor: `var(--lfe-color--${name}, ${diffColor(difficulty)})` };
      }
      return hasNativeColor(anchor, identity.pid) ? null : identity;
    },
  });

  function findPidText(root, pid) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.includes(pid)) return node;
    }
    return null;
  }

  const hasAppliedColor = (state, node) =>
    state?.node === node && node.style.color === state.paintColor &&
    !node.style.getPropertyPriority("color");

  function hasNativeColor(anchor, pid) {
    const state = appliedProblemColors.get(anchor);
    for (let node = findPidText(anchor, pid)?.parentElement; node; node = node.parentElement) {
      if ((node.style?.color && !hasAppliedColor(state, node)) ||
          nativeColorClasses.some((className) => node.classList.contains(className)))
        return true;
      if (node === anchor) break;
    }
    return false;
  }

  // Wrap only the PID text and keep the original element and event listeners.
  function wrapPidText(root, pid) {
    const node = findPidText(root, pid);
    if (!node) return null;
    const text = node.splitText(node.nodeValue.indexOf(pid));
    text.splitText(pid.length);
    const wrapper = document.createElement("span");
    wrapper.textContent = pid;
    text.replaceWith(wrapper);
    return wrapper;
  }

  const clearProblemColor = (anchor) => {
    const state = appliedProblemColors.get(anchor);
    if (!state) return;
    if (anchor.contains(state.node)) {
      if (state.wrapped) {
        state.node.replaceWith(document.createTextNode(state.node.textContent || ""));
        anchor.normalize();
      } else if (hasAppliedColor(state, state.node)) {
        state.node.style.removeProperty("color");
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

  function getRecordDifficulty(anchor, record, pid) {
    const isList = record === "list";
    if (!anchor.matches(isList ? ".problem > a" : ".problem-row > a")) return undefined;
    const number = anchor.firstElementChild;
    if (!number?.matches("strong") || number.textContent.trim() !== pid) return undefined;
    // The status link immediately precedes the problem cell in RecordListBlock.
    // Use its ID so two records of the same problem each get their own difficulty.
    let id = record;
    if (isList) {
      const status = anchor.parentElement.previousElementSibling?.querySelector("a.status[href]");
      if (status?.origin !== location.origin) return undefined;
      id = recordRouteId(status.pathname);
    }
    return nativeDifficulty.recordDifficulty(location.pathname + location.search, id, pid);
  }

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
      // 評測記錄在學術模式補色時直接讀當頁資料，不使用通用題目快取。
      // 列表裡可重用的難度仍收進快取，供其他頁面的題號使用。
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
          const addContainingAnchor = (target) =>
            addAnchor(target?.closest?.(PROBLEM_ANCHOR_SELECTOR));
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
              addContainingAnchor(mutation.target);
              reconsiderPracticeCard(mutation.target);
            } else if (mutation.type === "characterData") {
              const element = mutation.target.parentElement;
              reconsiderPracticeCard(element);
              addContainingAnchor(element);
            } else if (mutation.type === "attributes") {
              addContainingAnchor(mutation.target);
              if (
                mutation.attributeName === "href" &&
                mutation.target.parentElement
              )
                mutation.target.parentElement
                  .querySelectorAll(SELECTORS.standalonePid)
                  .forEach(addAnchor);
              if (mutation.attributeName === "href" && mutation.target.matches("a.status") &&
                  recordRouteId(location.pathname) === "list")
                addDescendants(mutation.target.parentElement?.nextElementSibling);
            }
          }
          if (anchors.size) accept(anchors);
        });
        observer.observe(document, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["href", "title", "style", "class"],
        });
        return () => observer.disconnect();
      },
      appliedPid: (anchor) => {
        const state = appliedProblemColors.get(anchor);
        return state && anchor.contains(state.node) && hasAppliedColor(state, state.node)
          ? anchor.dataset.luoguspPid : null;
      },
      isConnected: (anchor) => anchor.isConnected,
      clearColor: (anchor) => clearProblemColor(anchor),
      applyColor: (a, pid, color, identity) => {
        // 虛擬列表可能在請求期間重複使用錨點；Problem Pipeline 已複核身分後才會到這裡。
        clearProblemColor(a);
        const span = a.children[0];
        let pidElement = null;
        if (identity.recordColor) pidElement = span;
        else if (a.matches(SELECTORS.standalonePid)) pidElement = a;
        else if (span?.matches("span.pid") && (span.innerText || span.textContent || "").trim() === pid)
          pidElement = span;
        const node = pidElement || wrapPidText(a, pid);
        if (!node) return;
        node.style.color = color;
        appliedProblemColors.set(a, { node, wrapped: !pidElement, paintColor: node.style.color });
        a.dataset.luoguspPid = pid;
      },
    },
  });

  const refreshVisiblePage = () => {
    if (!document.hidden) problemPipeline.rescan({ allowQueries: false });
  };
  return defineConfigurableFeature({
    id: "problem-pipeline",
    key: "addProblemsColor",
    label: "题号显示难度颜色",
    storage,
    keepMountedOnRoute: true,
    onRoute: () => problemPipeline?.onRoute(),
    mount: (context) => {
      if (!context.isCurrent() || !problemPipeline) return () => {};
      // Observe immediately; only the query fallback waits 300ms in the pipeline.
      const dispose = problemPipeline.mount();
      document.addEventListener("visibilitychange", refreshVisiblePage);
      return () => {
        document.removeEventListener("visibilitychange", refreshVisiblePage);
        dispose();
      };
    },
  });
}
