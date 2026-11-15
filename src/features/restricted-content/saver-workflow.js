import { createSaverProtocol } from "./saver-protocol.js";

export function createSaverWorkflow(config, policy) {
  const {
    transport,
    protocol = createSaverProtocol(),
    clock,
    createAbortController = () => new AbortController(),
  } = config || {};
  const {
    pollAttempts = 15,
    pollIntervalMs = 3000,
  } = policy || {};
  if (
    !transport ||
    typeof transport.get !== "function" ||
    typeof transport.post !== "function"
  )
    throw new TypeError("Saver Workflow requires a transport adapter");
  if (
    !clock ||
    typeof clock.setTimeout !== "function" ||
    typeof clock.clearTimeout !== "function"
  )
    throw new TypeError("Saver Workflow requires a clock adapter");

  let disposed = false;
  const controllers = new Set();
  const now = typeof clock.now === "function" ? () => clock.now() : Date.now;
  const unavailableFromError = (error) => ({
    kind: "unavailable",
    reason: String((error && error.message) || error || "保存站暂时不可用"),
    retryable: !!(
      error &&
      (error.kind === "transport" || error.kind === "timeout")
    ),
    category: (error && error.kind) || "transport",
  });
  const unknownFromPost = (error) => ({
    kind: "unknown",
    reason: String((error && error.message) || error || "请求结果未知"),
    retryable: false,
    category: (error && error.kind) || "transport",
  });
  const validateTarget = (type, id) =>
    (type === "article" || type === "paste") &&
    typeof id === "string" &&
    /^[A-Za-z0-9]+$/.test(id);
  const invalidTarget = () => ({
    kind: "unavailable",
    reason: "保存站目标无效",
    retryable: false,
    category: "invariant",
  });
  const withTask = async (externalSignal, task) => {
    if (disposed)
      return {
        kind: "unavailable",
        reason: "保存工作流已取消",
        retryable: true,
        category: "cancelled",
      };
    const controller = createAbortController();
    const abort = () => controller.abort();
    if (externalSignal && externalSignal.aborted) abort();
    else if (externalSignal)
      externalSignal.addEventListener("abort", abort, { once: true });
    controllers.add(controller);
    try {
      return await task(controller.signal, abort);
    } finally {
      controllers.delete(controller);
      if (externalSignal)
        externalSignal.removeEventListener("abort", abort);
    }
  };
  const pause = (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      const finish = (value) => {
        clock.clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        resolve(value);
      };
      const cancel = () => finish(false);
      const timer = clock.setTimeout(() => finish(true), ms);
      signal.addEventListener("abort", cancel, { once: true });
    });
  const lookupRaw = async (type, id, signal) => {
    try {
      const payload = await transport.get(`/${type}/query/${id}`, { signal });
      return protocol.classifyLookup(payload, type, id);
    } catch (error) {
      return unavailableFromError(error);
    }
  };
  const postRaw = async (path, body, signal, fallback) => {
    try {
      const payload = await transport.post(path, body, { signal });
      return protocol.classifyAction(payload, fallback);
    } catch (error) {
      if (error && error.kind === "cancelled")
        return unavailableFromError(error);
      return unknownFromPost(error);
    }
  };
  const lookup = (type, id, options) => {
    if (!validateTarget(type, id)) return Promise.resolve(invalidTarget());
    return withTask(options && options.signal, (signal) =>
      lookupRaw(type, id, signal),
    );
  };
  const pollArchive = async (type, id, signal, abort, onAccepted) => {
    const budgetMs = pollAttempts * pollIntervalMs;
    const deadline = now() + budgetMs;
    let timedOut = false;
    const stopResult = () => ({
      kind: "unavailable",
      reason: timedOut
        ? "保存站在限定时间内未能完成收录。"
        : "保存工作流已取消",
      retryable: true,
      category: timedOut ? "timeout" : "cancelled",
      stage: "poll",
    });
    const expire = () => {
      if (signal.aborted) return;
      timedOut = true;
      abort();
    };
    const isStopped = () => {
      if (now() >= deadline) expire();
      return signal.aborted;
    };
    if (isStopped()) return stopResult();
    let onAbort;
    const stopped = new Promise((resolve) => {
      onAbort = () => resolve(stopResult());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const timer = clock.setTimeout(expire, budgetMs);
    const poll = async () => {
      let interval = pollIntervalMs;
      for (let attempt = 0; attempt < pollAttempts; attempt++) {
        if (!(await pause(interval, signal)) || isStopped()) return stopResult();
        interval = Math.min(interval * 2, pollIntervalMs * 4);
        const result = await lookupRaw(type, id, signal);
        if (isStopped()) return stopResult();
        if (result.kind === "archived") return result;
        if (result.kind === "missing") continue;
        if (
          result.kind === "unavailable" &&
          result.retryable &&
          (result.category === "transport" || result.category === "timeout")
        )
          continue;
        return { ...result, stage: "poll" };
      }
      expire();
      return stopResult();
    };
    try {
      if (typeof onAccepted === "function") onAccepted();
      return await Promise.race([stopped, poll()]);
    } finally {
      clock.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  };
  const ensureArchived = (type, id, options) => {
    if (!validateTarget(type, id)) return Promise.resolve(invalidTarget());
    return withTask(options && options.signal, async (signal, abort) => {
      const initial = await lookupRaw(type, id, signal);
      if (initial.kind !== "missing")
        return initial.kind === "unavailable"
          ? { ...initial, stage: "lookup" }
          : initial;
      const created = await postRaw(
        `/workflow/create/template/${type}-save-pipeline`,
        { targetId: id },
        signal,
        "保存站拒绝收录请求",
      );
      if (created.kind !== "accepted") return { ...created, stage: "create" };
      return pollArchive(type, id, signal, abort, options?.onAccepted);
    });
  };
  const requestRefresh = (type, id, options) => {
    if (!validateTarget(type, id)) return Promise.resolve(invalidTarget());
    return withTask(options && options.signal, (signal) =>
      // ★ 只發 targetId。曾經給 article 額外發過強制更新標誌，撤掉的原因有兩條：
      //   1. 上游維護者明確說沒打算把這個權限交給公開不鑑權的入口（luogu-saver#85），
      //      與其等他收口，不如我們先撤；
      //   2. 我們要它的唯一理由是補真實發表時間，而 luogu-saver#84 之後保存站會在
      //      「內容沒變、整條跳過」那條路上自己回填，不再需要強制重寫。
      postRaw(
        `/workflow/create/template/${type}-save-pipeline`,
        { targetId: id },
        signal,
        "保存站拒绝更新请求",
      ),
    );
  };
  const loadComments = (id, options) =>
    withTask(options && options.signal, async (signal) => {
      try {
        const payload = await transport.get(`/article/comments/${id}`, {
          signal,
        });
        return protocol.classifyComments(payload, id);
      } catch (error) {
        return unavailableFromError(error);
      }
    });
  const refreshComments = (id, options) =>
    withTask(options && options.signal, (signal) =>
      postRaw(
        `/article/comments/${id}/refresh`,
        null,
        signal,
        "评论刷新请求失败",
      ),
    );
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };

  return Object.freeze({
    lookup,
    ensureArchived,
    requestRefresh,
    loadComments,
    refreshComments,
    dispose,
  });
}
