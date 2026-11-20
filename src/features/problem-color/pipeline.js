import { browserClock } from "../../browser/clock.js";
import { validDifficulty } from "./native-difficulty-source.js";
import { isLater } from "./problem-data.js";

export function createProblemPipeline(config) {
  const {
    identity,
    documentAdapter,
    routeAdapter,
    difficultySource,
    colorForDifficulty,
    cacheLimit = 1000,
    cacheTtlMs = 5 * 60 * 1000,
    requestDelayMs = 300,
    clock = browserClock,
    createAbortController = () => new AbortController(),
    logError = () => {},
  } = config || {};
  if (!identity || typeof identity.resolve !== "function")
    throw new TypeError("Problem Pipeline requires a Problem Identity adapter");
  if (
    !documentAdapter ||
    typeof documentAdapter.anchors !== "function" ||
    typeof documentAdapter.observeAnchors !== "function" ||
    typeof documentAdapter.applyColor !== "function"
  )
    throw new TypeError("Problem Pipeline requires a document adapter");
  if (!difficultySource || typeof difficultySource.lookup !== "function")
    throw new TypeError("Problem Pipeline requires a difficulty source");
  if (typeof colorForDifficulty !== "function")
    throw new TypeError("Problem Pipeline requires a color adapter");

  // 兩種快取都從資料的觀測時間起算 5 分鐘；讀取不續期，不輪詢伺服器。
  // colors = 最多 1000 條查詢結果，按寫入順序淘汰。
  // ★harvested 與它分開：整批資料是本頁自帶的 payload，不是請求結果，條數由頁面決定。
  //   曾經兩者共用一個 1000 條的 LRU——練習頁一次收 1363 題，後來的直接把先收的擠掉，
  //   而收取順序與頁面繪製順序一致，被擠掉的恰好是螢幕最上面那批，整批優化等於白做。
  const colors = new Map();
  const harvested = new Map();
  const harvestedLists = new WeakSet();
  const painted = new WeakMap();
  let harvestViewer;
  let coloringAnchors = new WeakMap();
  let mounted = false;
  let generation = 0;
  let currentRoute;
  let stopObserving = null;
  let activeController = null;
  let stopSource = null;
  let requestTimer = null;
  let requestsReady = false;

  const routeToken = () =>
    routeAdapter && typeof routeAdapter.token === "function"
      ? routeAdapter.token()
      : "";
  const current = () => mounted && routeToken() === currentRoute;
  const isConnected = (anchor) => documentAdapter.isConnected?.(anchor) ?? true;
  const rememberColor = (key, color, at) => {
    if (!color || colors.get(key)?.at > at) return;
    colors.delete(key);
    colors.set(key, { color, at });
    if (colors.size > cacheLimit) colors.delete(colors.keys().next().value);
  };
  const fresh = (cache, pid) => {
    const entry = cache.get(pid);
    if (entry && clock.now() - entry.at >= cacheTtlMs) {
      cache.delete(pid);
      return null;
    }
    return entry;
  };
  // A newly received native value replaces an older query result, and vice versa.
  // Record tiers with ambiguous historical numbering are filtered before this point.
  const knownColor = ({ pid, scoped }, shared) => {
    const native = scoped ? null : fresh(harvested, pid);
    const fetched = !scoped && requestsReady ? fresh(colors, shared?.key ?? pid) : null;
    const local = native && !isLater(fetched, native) ? native : fetched;
    return validDifficulty(shared?.difficulty) && !isLater(local, shared)
      ? colorForDifficulty(shared.difficulty) : local?.color;
  };
  const harvest = (received) => {
    const { viewer, batches = [] } = difficultySource.harvest?.(received) ?? {};
    if (viewer !== harvestViewer) {
      harvestViewer = viewer;
      harvested.clear();
      colors.clear();
    }
    for (const { problems, at: observedAt, order } of batches) {
      if (harvestedLists.has(problems)) continue;
      harvestedLists.add(problems);
      const at = observedAt ?? clock.now();
      if (clock.now() - at >= cacheTtlMs) continue;
      for (const pid of harvested.keys()) fresh(harvested, pid);
      const stamp = { at, order };
      for (const { pid, difficulty } of problems) {
        if (pid && validDifficulty(difficulty) && !isLater(harvested.get(pid), stamp))
          harvested.set(pid, { ...stamp, color: colorForDifficulty(difficulty) });
      }
    }
  };
  const getColor = async (identity, signal, key) => {
    try {
      const result = await difficultySource.lookup(identity, signal);
      if (signal.aborted || !validDifficulty(result?.difficulty) || !Number.isFinite(result.at)) return null;
      const color = colorForDifficulty(result.difficulty);
      if (!identity.scoped) rememberColor(key ?? identity.pid, color, result.at);
      return color;
    } catch (error) {
      if (!signal.aborted) logError(identity.pid, error);
      return null;
    }
  };
  const colorAnchor = async (anchor, allowQueries, changedKey) => {
    const controller = activeController;
    if (!controller) return;
    const taskGeneration = generation;
    const taskRoute = routeToken();
    if (!isConnected(anchor)) return;
    const taskIdentity = identity.resolve(anchor);
    const shared = taskIdentity && !taskIdentity.recordColor ? difficultySource.peek?.(taskIdentity) : null;
    if (changedKey !== undefined && shared?.key !== changedKey) return;
    const key = taskIdentity && `${taskIdentity.key}:${shared?.key ?? ""}`;
    // A recycled anchor can keep its PID while changing destination or scope.
    // Clear the previous paint before any lookup for the new identity.
    const previous = painted.get(anchor);
    if (!taskIdentity || (previous && previous.key !== key)) {
      documentAdapter.clearColor?.(anchor, documentAdapter.appliedPid?.(anchor));
      painted.delete(anchor);
    }
    if (!taskIdentity) return;
    const apply = (color) => {
      const previous = painted.get(anchor);
      if (previous?.key === key && previous.color === color &&
          documentAdapter.appliedPid?.(anchor) === taskIdentity.pid) return;
      documentAdapter.applyColor(anchor, taskIdentity.pid, color, taskIdentity);
      painted.set(anchor, { key, color });
    };
    if (taskIdentity.recordColor) {
      apply(taskIdentity.recordColor);
      return;
    }
    // No await/timer on the native path: MutationObserver callbacks finish before
    // the next paint, including newly inserted or recycled list rows.
    const known = knownColor(taskIdentity, shared);
    if (known) {
      apply(known);
      return;
    }
    if (!requestsReady || !allowQueries) return;
    const routeQueries = coloringAnchors;
    if (routeQueries.get(anchor) === key) return;
    routeQueries.set(anchor, key);
    try {
      const color = await getColor(taskIdentity, controller.signal, shared?.key);
      const currentIdentity = identity.resolve(anchor);
      if (
        !mounted ||
        generation !== taskGeneration ||
        routeToken() !== taskRoute ||
        !color ||
        !isConnected(anchor) ||
        !currentIdentity ||
        currentIdentity.key !== taskIdentity.key
      )
        return;
      // A newer observation or a viewer change may have arrived during the lookup.
      const currentShared = difficultySource.peek?.(currentIdentity);
      if (currentShared?.key === shared?.key)
        apply(knownColor(currentIdentity, currentShared) || color);
    } finally {
      if (routeQueries.get(anchor) === key)
        routeQueries.delete(anchor);
    }
  };
  const acceptAnchors = (anchors, { allowQueries = true, batch } = {}) => {
    harvest(batch);
    for (const anchor of anchors || []) colorAnchor(anchor, allowQueries);
  };
  const rescan = (options) => {
    if (current())
      acceptAnchors(documentAdapter.anchors(documentAdapter.root), options);
  };
  const refreshDifficulty = (pid, key) => {
    if (current()) {
      for (const anchor of documentAdapter.problemAnchors(pid)) colorAnchor(anchor, false, key);
    }
  };
  const cancelRouteQueries = () => {
    activeController?.abort();
    activeController = null;
    if (requestTimer !== null) clock.clearTimeout(requestTimer);
    requestTimer = null;
    coloringAnchors = new WeakMap();
  };
  const onRoute = () => {
    if (!mounted) return;
    generation++;
    currentRoute = routeToken();
    cancelRouteQueries();
    activeController = createAbortController();
    requestsReady = requestDelayMs === 0;
    if (!requestsReady) requestTimer = clock.setTimeout(() => {
      requestTimer = null;
      requestsReady = true;
      rescan();
    }, requestDelayMs);
    rescan();
  };
  const dispose = () => {
    if (!mounted) return;
    mounted = false;
    generation++;
    cancelRouteQueries();
    if (stopObserving) stopObserving();
    stopObserving = null;
    if (stopSource) stopSource();
    stopSource = null;
  };
  const mount = () => {
    if (mounted) return dispose;
    mounted = true;
    stopSource = difficultySource.subscribe?.(rescan, refreshDifficulty) || null;
    stopObserving = documentAdapter.observeAnchors(acceptAnchors) || null;
    onRoute();
    return dispose;
  };

  return Object.freeze({ mount, dispose, onRoute, rescan });
}
