import { validDifficulty } from "./native-difficulty-source.js";

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
    clock = {
      now: () => Date.now(),
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (id) => clearTimeout(id),
    },
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

  // 兩種快取都在接收後 5 分鐘過期；讀取不續期，不輪詢伺服器。
  // colors = 最多 1000 條查詢結果，按寫入順序淘汰。
  // ★harvested 與它分開：整批資料是本頁自帶的 payload，不是請求結果，條數由頁面決定。
  //   曾經兩者共用一個 1000 條的 LRU——練習頁一次收 1363 題，後來的直接把先收的擠掉，
  //   而收取順序與頁面繪製順序一致，被擠掉的恰好是螢幕最上面那批，整批優化等於白做。
  const colors = new Map();
  const harvested = new Map();
  const harvestedLists = new WeakSet();
  const painted = new WeakMap();
  let coloringAnchors = new WeakMap();
  let mounted = false;
  let generation = 0;
  let stopObserving = null;
  let activeController = null;
  let stopSource = null;
  let requestTimer = null;
  let requestsReady = false;

  const routeToken = () =>
    routeAdapter && typeof routeAdapter.token === "function"
      ? routeAdapter.token()
      : "";
  const rememberColor = (pid, color, at) => {
    if (!pid || !color) return;
    if (colors.has(pid)) colors.delete(pid);
    colors.set(pid, { color, at });
    if (colors.size > cacheLimit) colors.delete(colors.keys().next().value);
  };
  const rememberDifficulty = (pid, difficulty, at) => {
    if (pid && validDifficulty(difficulty) &&
        (!harvested.has(pid) || harvested.get(pid).at <= at))
      harvested.set(pid, { color: colorForDifficulty(difficulty), at });
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
  const knownColor = (pid) => {
    const native = fresh(harvested, pid);
    const fetched = fresh(colors, pid);
    return native && (!fetched || native.at >= fetched.at) ? native : fetched;
  };
  const harvest = () => {
    if (typeof difficultySource.harvest !== "function") return;
    const batches = difficultySource.harvest() || [];
    for (const batch of batches) {
      if (
        !batch ||
        !batch.source ||
        (typeof batch.source !== "object" &&
          typeof batch.source !== "function") ||
        harvestedLists.has(batch.source)
      )
        continue;
      const problems =
        typeof batch.problems === "function"
          ? batch.problems()
          : batch.problems;
      const at = batch.at ?? clock.now();
      for (const pid of harvested.keys()) fresh(harvested, pid);
      if (clock.now() - at >= cacheTtlMs) {
        harvestedLists.add(batch.source);
        continue;
      }
      for (const problem of problems || [])
        rememberDifficulty(problem && problem.pid, problem && problem.difficulty, at);
      harvestedLists.add(batch.source);
    }
  };
  const getColor = async (identity, signal) => {
    const { pid } = identity;
    const known = identity.scoped ? null : knownColor(pid);
    if (known) return known.color;
    const startedAt = clock.now();
    try {
      const difficulty = await difficultySource.lookup(identity, signal);
      if (signal.aborted || !validDifficulty(difficulty)) return null;
      if (identity.scoped) return colorForDifficulty(difficulty);
      rememberColor(pid, colorForDifficulty(difficulty), startedAt);
      return knownColor(pid)?.color || null;
    } catch (error) {
      if (!signal.aborted) logError(pid, error);
      return null;
    }
  };
  const colorAnchor = async (anchor, allowQueries) => {
    const controller = activeController;
    if (!controller) return;
    const taskGeneration = generation;
    const taskRoute = routeToken();
    if (typeof documentAdapter.isConnected === "function" && !documentAdapter.isConnected(anchor)) return;
    const taskIdentity = identity.resolve(anchor);
    // A recycled anchor can keep its PID while changing destination or scope.
    // Clear the previous paint before any lookup for the new identity.
    const previous = painted.get(anchor);
    if (!taskIdentity || (previous && previous.key !== taskIdentity.key)) {
      documentAdapter.clearColor?.(anchor, documentAdapter.appliedPid?.(anchor));
      painted.delete(anchor);
    }
    if (!taskIdentity) return;
    const apply = (color) => {
      const previous = painted.get(anchor);
      if (previous?.key === taskIdentity.key && previous.color === color &&
          documentAdapter.appliedPid?.(anchor) === taskIdentity.pid) return;
      documentAdapter.applyColor(anchor, taskIdentity.pid, color, taskIdentity);
      painted.set(anchor, { key: taskIdentity.key, color });
    };
    if (taskIdentity.recordColor) {
      apply(taskIdentity.recordColor);
      return;
    }
    const known = taskIdentity.scoped ? null : knownColor(taskIdentity.pid);
    // No await/timer on the native path: MutationObserver callbacks finish before
    // the next paint, including newly inserted or recycled list rows.
    if (known && (requestsReady || known === fresh(harvested, taskIdentity.pid))) {
      apply(known.color);
      return;
    }
    const shared = difficultySource.peek?.(taskIdentity);
    if (validDifficulty(shared)) {
      apply(colorForDifficulty(shared));
      return;
    }
    if (!requestsReady || !allowQueries) return;
    const routeQueries = coloringAnchors;
    if (routeQueries.get(anchor) === taskIdentity.key) return;
    routeQueries.set(anchor, taskIdentity.key);
    try {
      const color = await getColor(taskIdentity, controller.signal);
      const currentIdentity = identity.resolve(anchor);
      if (
        !mounted ||
        generation !== taskGeneration ||
        routeToken() !== taskRoute ||
        !color ||
        (typeof documentAdapter.isConnected === "function" &&
          !documentAdapter.isConnected(anchor)) ||
        !currentIdentity ||
        currentIdentity.key !== taskIdentity.key
      )
        return;
      // A native response may have arrived while this query was in flight.
      apply((taskIdentity.scoped ? null : knownColor(taskIdentity.pid)?.color) || color);
    } finally {
      if (routeQueries.get(anchor) === taskIdentity.key)
        routeQueries.delete(anchor);
    }
  };
  const acceptAnchors = (anchors, { allowQueries = true } = {}) => {
    harvest();
    for (const anchor of anchors || []) colorAnchor(anchor, allowQueries);
  };
  const rescan = (options) => {
    if (mounted) acceptAnchors(documentAdapter.anchors(documentAdapter.root), options);
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
    stopSource = difficultySource.subscribe?.(rescan) || null;
    stopObserving = documentAdapter.observeAnchors(acceptAnchors) || null;
    onRoute();
    return dispose;
  };

  return Object.freeze({ mount, dispose, onRoute, rescan });
}
