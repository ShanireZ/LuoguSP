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
  // 两种缓存都在接收后 5 分钟过期；读取不续期，不轮询服务器。
  // colors = 最多 1000 条查询结果，按写入顺序淘汰。
  // ★harvested 与它分开：整批数据是本页自带的 payload，不是请求结果，条数由页面决定。
  //   曾经两者共用一个 1000 条的 LRU——练习页一次收 1363 题，后来的直接把先收的挤掉，
  //   而收取顺序与页面渲染顺序一致，被挤掉的恰好是屏幕最上面那批，整批优化等于白做。
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
  // ★ pid 已经过 identity.js 的字符集守卫，编码后逐字节不变；这里编码是**第二道闸**：
  //   pid 的来源里有页面可控文本，一个 `#` 就能把 query 连同后半段路径吃掉、
  //   一个 `/` 就能把请求打到别的同源接口去（2026-08-15 实测复现，见 identity.js）。
  //   判据坏掉时应当请求不到东西，而不是请求到别的东西。
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
        // 已删除、无权访问或尚未公开的题目都可能返回 403/404；它们没有可着色难度，
        // 也不需要再请求完整页面或污染控制台。
        if (error && (error.status === 403 || error.status === 404)) return null;
        /* 临时网络错误不能永久降级 _contentOnly。 */
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
    // 洛谷记录分页会复用同一批锚点。先撤销旧题号的样式，避免新题查询失败时
    // （例如题目已删除而返回 403）继续显示上一页题目的难度色。
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
