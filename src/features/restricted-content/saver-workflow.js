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
  const timers = new Map();
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
      return await task(controller.signal);
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
        if (!timers.has(timer)) return;
        clock.clearTimeout(timer);
        timers.delete(timer);
        signal.removeEventListener("abort", cancel);
        resolve(value);
      };
      const cancel = () => finish(false);
      const timer = clock.setTimeout(() => finish(true), ms);
      timers.set(timer, cancel);
      signal.addEventListener("abort", cancel, { once: true });
    });
  const lookupRaw = async (type, id, signal) => {
    try {
      const payload = await transport.get(`/${type}/query/${id}`, { signal });
      return protocol.classifyLookup(payload);
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
  const ensureArchived = (type, id, options) => {
    if (!validateTarget(type, id)) return Promise.resolve(invalidTarget());
    return withTask(options && options.signal, async (signal) => {
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
      if (options && typeof options.onAccepted === "function")
        options.onAccepted();
      for (let attempt = 0; attempt < pollAttempts; attempt++) {
        if (!(await pause(pollIntervalMs, signal)))
          return {
            ...unavailableFromError({
              kind: "cancelled",
              message: "保存工作流已取消",
            }),
            stage: "poll",
          };
        const result = await lookupRaw(type, id, signal);
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
      return {
        kind: "unavailable",
        reason: "保存站在限定时间内未能完成收录。",
        retryable: true,
        category: "timeout",
        stage: "poll",
      };
    });
  };
  const requestRefresh = (type, id, options) => {
    if (!validateTarget(type, id)) return Promise.resolve(invalidTarget());
    return withTask(options && options.signal, (signal) =>
      postRaw(
        `/workflow/create/template/${type}-save-pipeline`,
        type === "article"
          ? { targetId: id, forceUpdate: true }
          : { targetId: id },
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
        if (protocol.isSuccess(payload))
          return { kind: "available", data: payload.data || {} };
        return {
          ...protocol.classifyAction(payload, "评论存档读取失败"),
          kind: "unavailable",
        };
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
    for (const [timer, cancel] of timers) {
      clock.clearTimeout(timer);
      cancel();
    }
    timers.clear();
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
