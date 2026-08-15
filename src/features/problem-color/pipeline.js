import { recordDifficultyForHarvest } from "./identity.js";

export function createProblemPipeline(config) {
  const {
    identity,
    documentAdapter,
    routeAdapter,
    difficultySource,
    colorForDifficulty,
    cacheLimit = 1000,
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
  // colors = 网络请求结果的 LRU（有界，因为它会跨路由无限增长）。
  // ★harvested 与它分开：整批数据是本页自带的 payload，不是请求结果，条数由页面决定。
  //   曾经两者共用一个 1000 条的 LRU——练习页一次收 1363 题，后来的直接把先收的挤掉，
  //   而收取顺序与页面渲染顺序一致，被挤掉的恰好是屏幕最上面那批，整批优化等于白做。
  const colors = new Map();
  const harvested = new Map();
  const harvestedLists = new WeakSet();
  let coloringAnchors = new WeakMap();
  let contentOnlySupport = null;
  let mounted = false;
  let generation = 0;
  let stopObserving = null;
  let activeController = null;

  const routeToken = () =>
    routeAdapter && typeof routeAdapter.token === "function"
      ? routeAdapter.token()
      : "";
  const rememberColor = (pid, color) => {
    if (!pid || !color) return;
    if (colors.has(pid)) colors.delete(pid);
    colors.set(pid, color);
    if (colors.size > cacheLimit) colors.delete(colors.keys().next().value);
  };
  const rememberDifficulty = (pid, difficulty) => {
    if (pid && typeof difficulty === "number")
      harvested.set(pid, colorForDifficulty(difficulty));
  };
  // 请求结果优先于整批数据：单题接口给的是当前值，整批里可能是历史编号。
  const knownColor = (pid) =>
    colors.has(pid) ? colors.get(pid) : harvested.get(pid);
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
      for (const problem of problems || [])
        rememberDifficulty(problem && problem.pid, problem && problem.difficulty);
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
          if (typeof difficulty === "number") {
            contentOnlySupport = true;
            return difficulty;
          }
        } catch (error) {
          const htmlDifficulty = text.match(DIFFICULTY_RE);
          if (htmlDifficulty) {
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
      return match ? Number(match[1]) : null;
    } catch (error) {
      if (!signal.aborted) logError(pid, error);
      return null;
    }
  };
  const getColor = async (pid, signal) => {
    harvest();
    const known = knownColor(pid);
    if (known) return known;
    const difficulty = await fetchDifficulty(pid, signal);
    if (signal.aborted || difficulty == null) return null;
    const color = colorForDifficulty(difficulty);
    rememberColor(pid, color);
    return color;
  };
  const colorAnchor = async (anchor) => {
    const controller = activeController;
    if (!controller) return;
    const taskGeneration = generation;
    const taskRoute = routeToken();
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
    if (appliedPid === taskIdentity.pid) return;
    // 洛谷记录分页会复用同一批锚点。先撤销旧题号的样式，避免新题查询失败时
    // （例如题目已删除而返回 403）继续显示上一页题目的难度色。
    if (appliedPid && typeof documentAdapter.clearColor === "function")
      documentAdapter.clearColor(anchor, appliedPid);
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
      documentAdapter.applyColor(anchor, taskIdentity.pid, color);
    } finally {
      if (coloringAnchors.get(anchor) === taskIdentity.key)
        coloringAnchors.delete(anchor);
    }
  };
  const acceptAnchors = (anchors) => {
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
    coloringAnchors = new WeakMap();
  };
  const mount = () => {
    if (mounted) return dispose;
    mounted = true;
    generation++;
    activeController = createAbortController();
    stopObserving = documentAdapter.observeAnchors(acceptAnchors) || null;
    scan(documentAdapter.root);
    return dispose;
  };

  return Object.freeze({ mount, dispose });
}
