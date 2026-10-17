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
  if (!difficultySource || typeof difficultySource.text !== "function")
    throw new TypeError("Problem Pipeline requires a difficulty source");
  if (typeof colorForDifficulty !== "function")
    throw new TypeError("Problem Pipeline requires a color adapter");

  const DIFFICULTY_RE = /"difficulty":\s*(\d+)/;
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
  let contentOnlySupport = null;
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
  // ★ pid 已經過 identity.js 的字元集守衛，編碼後逐位元組不變；這裡編碼是**第二道閘**：
  //   pid 的來源裡有頁面可控文字，一個 `#` 就能把 query 連同後半段路徑吃掉、
  //   一個 `/` 就能把請求打到別的同源介面去（2026-08-15 實測重現，見 identity.js）。
  //   判據壞掉時應當請求不到東西，而不是請求到別的東西。
  const problemPath = (pid, query = "") =>
    `/problem/${encodeURIComponent(pid)}${query}`;
  const fetchDifficulty = async (pid, signal) => {
    if (contentOnlySupport !== false) {
      let text;
      try {
        text = await difficultySource.text(
          problemPath(pid, "?_contentOnly=1"),
          { signal },
        );
      } catch (error) {
        if (signal.aborted) return null;
        // 已刪除、無權訪問或尚未公開的題目都可能回傳 403/404；它們沒有可著色難度，
        // 也不需要再請求完整頁面或汙染控制檯。
        if (error && (error.status === 403 || error.status === 404)) return null;
        /* 臨時網路錯誤不能永久降級 _contentOnly。 */
      }
      if (text != null) {
        try {
          const difficulty =
            JSON.parse(text)?.currentData?.problem?.difficulty;
          if (validDifficulty(difficulty)) {
            contentOnlySupport = true;
            return difficulty;
          }
        } catch (error) {
          const htmlDifficulty = text.match(DIFFICULTY_RE);
          if (htmlDifficulty && validDifficulty(Number(htmlDifficulty[1]))) {
            contentOnlySupport = false;
            return Number(htmlDifficulty[1]);
          }
        }
      }
    }
    if (signal.aborted) return null;
    try {
      const html = await difficultySource.text(problemPath(pid), { signal });
      const match = html.match(DIFFICULTY_RE);
      return match && validDifficulty(Number(match[1])) ? Number(match[1]) : null;
    } catch (error) {
      if (!signal.aborted) logError(pid, error);
      return null;
    }
  };
  const getColor = async (pid, signal) => {
    const known = knownColor(pid);
    if (known) return known.color;
    const startedAt = clock.now();
    const difficulty = await fetchDifficulty(pid, signal);
    if (signal.aborted || difficulty == null) return null;
    const color = colorForDifficulty(difficulty);
    rememberColor(pid, color, startedAt);
    return knownColor(pid)?.color || null;
  };
  const colorAnchor = async (anchor) => {
    const controller = activeController;
    if (!controller) return;
    const taskGeneration = generation;
    const taskRoute = routeToken();
    if (typeof documentAdapter.isConnected === "function" && !documentAdapter.isConnected(anchor)) return;
    const taskIdentity = identity.resolve(anchor);
    const appliedPid =
      typeof documentAdapter.appliedPid === "function"
        ? documentAdapter.appliedPid(anchor)
        : null;
    if (!taskIdentity) {
      if (appliedPid && typeof documentAdapter.clearColor === "function")
        documentAdapter.clearColor(anchor, appliedPid);
      return;
    }
    const apply = (color) => {
      const previous = painted.get(anchor);
      if (documentAdapter.appliedPid?.(anchor) === taskIdentity.pid && previous?.color === color) return;
      documentAdapter.applyColor(anchor, taskIdentity.pid, color);
      painted.set(anchor, { color });
    };
    const known = knownColor(taskIdentity.pid);
    // No await/timer on the native path: MutationObserver callbacks finish before
    // the next paint, including newly inserted or recycled list rows.
    if (known && (requestsReady || known === fresh(harvested, taskIdentity.pid))) {
      apply(known.color);
      return;
    }
    // 洛谷記錄分頁會重複使用同一批錨點。先撤銷舊題號的樣式，避免新題查詢失敗時
    // （例如題目已刪除而回傳 403）繼續顯示上一頁題目的難度色。
    if (appliedPid && appliedPid !== taskIdentity.pid && typeof documentAdapter.clearColor === "function")
      documentAdapter.clearColor(anchor, appliedPid);
    if (!requestsReady) return;
    if (coloringAnchors.get(anchor) === taskIdentity.key) return;
    coloringAnchors.set(anchor, taskIdentity.key);
    try {
      const color = await getColor(taskIdentity.pid, controller.signal);
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
      apply(knownColor(taskIdentity.pid)?.color || color);
    } finally {
      if (coloringAnchors.get(anchor) === taskIdentity.key)
        coloringAnchors.delete(anchor);
    }
  };
  const acceptAnchors = (anchors) => {
    harvest();
    for (const anchor of anchors || []) colorAnchor(anchor);
  };
  const scan = (root) => acceptAnchors(documentAdapter.anchors(root));
  const dispose = () => {
    if (!mounted) return;
    mounted = false;
    generation++;
    if (activeController) activeController.abort();
    activeController = null;
    if (stopObserving) stopObserving();
    stopObserving = null;
    if (stopSource) stopSource();
    stopSource = null;
    if (requestTimer !== null) clock.clearTimeout(requestTimer);
    requestTimer = null;
    coloringAnchors = new WeakMap();
  };
  const mount = () => {
    if (mounted) return dispose;
    mounted = true;
    generation++;
    activeController = createAbortController();
    requestsReady = requestDelayMs === 0;
    if (!requestsReady) requestTimer = clock.setTimeout(() => {
      requestTimer = null;
      requestsReady = true;
      scan(documentAdapter.root);
    }, requestDelayMs);
    stopSource = difficultySource.subscribe?.(() => scan(documentAdapter.root)) || null;
    stopObserving = documentAdapter.observeAnchors(acceptAnchors) || null;
    scan(documentAdapter.root);
    return dispose;
  };

  return Object.freeze({ mount, dispose });
}
