export function createIdeBatchRunner(config) {
  const {
    ideDriver,
    clock,
    createAbortController = () => new AbortController(),
    logError = () => {},
  } = config || {};
  if (
    !ideDriver ||
    typeof ideDriver.prepare !== "function" ||
    typeof ideDriver.runSample !== "function"
  )
    throw new TypeError("IDE Batch Runner requires a browser driver");
  if (
    !clock ||
    typeof clock.setTimeout !== "function" ||
    typeof clock.clearTimeout !== "function"
  )
    throw new TypeError("IDE Batch Runner requires a clock adapter");

  let state = "idle";
  let runId = 0;
  let mounted = false;
  let disposed = false;
  let driving = false;
  let stale = false;
  let results = null;
  let stopMount = null;
  let mountKey = null;
  let delay = null;
  let activeController = null;
  let sampleRunId = null;

  const cancelDelay = () => {
    if (!delay) return;
    clock.clearTimeout(delay.timer);
    const resolve = delay.resolve;
    delay = null;
    resolve(false);
  };
  const pause = (ms, taskRunId) =>
    new Promise((resolve) => {
      const timer = clock.setTimeout(() => {
        if (delay && delay.timer === timer) delay = null;
        resolve(taskRunId === runId && !disposed);
      }, ms);
      delay = { timer, resolve };
    });
  const isCurrent = (taskRunId, context, signal) =>
    taskRunId === runId &&
    !disposed &&
    !signal.aborted &&
    (!ideDriver.isCurrent || ideDriver.isCurrent(context));
  const drive = (taskRunId, action) => {
    if (taskRunId !== runId || disposed) return;
    driving = true;
    try {
      return action();
    } finally {
      driving = false;
    }
  };
  const invalidate = () => {
    if (state === "idle") return;
    if (activeController) activeController.abort();
    activeController = null;
    runId++;
    state = "idle";
    driving = false;
    cancelDelay();
    if (typeof ideDriver.cancel === "function") ideDriver.cancel();
  };
  const stop = () => {
    if (state !== "preparing" && state !== "running") return;
    state = "stopping";
    const sampleRunning = sampleRunId === runId;
    ideDriver.setStopping?.(sampleRunning);
    if (!sampleRunning) cancelDelay();
  };
  const markStale = () => {
    if (stale || state === "preparing" || !results) return;
    stale = true;
    const active = state === "running" || state === "stopping";
    if (active) {
      state = "stopping";
      cancelDelay();
    }
    ideDriver.markStale?.(active);
  };
  const configurationIsCurrent = (context) => {
    if (ideDriver.configurationMatches?.(context) === false) markStale();
    return !stale;
  };
  const start = async () => {
    if (disposed || state !== "idle") return;
    const taskRunId = ++runId;
    const controller = createAbortController();
    activeController = controller;
    let context = null;
    state = "preparing";
    try {
      context = await ideDriver.prepare({
        runId: taskRunId,
        signal: controller.signal,
      });
      if (taskRunId !== runId || disposed) return;
      if (!context || context.kind !== "ready") {
        if (context && context.message && typeof ideDriver.hint === "function")
          ideDriver.hint(context.message);
        return;
      }
      if (state === "stopping") return;
      if (!isCurrent(taskRunId, context, controller.signal)) {
        if (typeof ideDriver.hint === "function")
          ideDriver.hint("页面已切换");
        return;
      }

      state = "running";
      stale = false;
      results = new Array(context.count).fill(null);
      if (typeof ideDriver.begin === "function")
        ideDriver.begin(context, results);
      for (let index = 0; index < context.count; index++) {
        if (
          state === "stopping" ||
          !isCurrent(taskRunId, context, controller.signal) ||
          !configurationIsCurrent(context)
        )
          break;
        if (typeof ideDriver.setRunning === "function")
          ideDriver.setRunning(context, index);
        let result;
        sampleRunId = taskRunId;
        try {
          result = await ideDriver.runSample(context, index, {
            runId: taskRunId,
            signal: controller.signal,
            drive: (action) => isCurrent(taskRunId, context, controller.signal) &&
              configurationIsCurrent(context) && drive(taskRunId, action),
            isCurrent: () =>
              isCurrent(taskRunId, context, controller.signal),
            wait: (ms) => pause(ms, taskRunId),
          });
        } catch (error) {
          if (controller.signal.aborted) break;
          logError(error);
          result = { verdict: "UKE", note: String(error) };
        } finally {
          if (sampleRunId === taskRunId) sampleRunId = null;
        }
        if (!isCurrent(taskRunId, context, controller.signal)) break;
        configurationIsCurrent(context);
        if (!result) break;
        if (result.stale) markStale();
        results[index] = result;
        if (typeof ideDriver.applyResult === "function")
          ideDriver.applyResult(context, index, result);
        if (result.uncertain) break;
        if (result.verdict === "CE") {
          if (state === "stopping") break;
          for (let rest = index + 1; rest < context.count; rest++) {
            results[rest] = {
              verdict: "CE",
              output: result.output || "",
              note: "编译错误",
            };
            if (typeof ideDriver.applyResult === "function")
              ideDriver.applyResult(context, rest, results[rest]);
          }
          break;
        }
        if (index < context.count - 1 && state !== "stopping") {
          const continued = await pause(500, taskRunId);
          if (
            !continued ||
            !isCurrent(taskRunId, context, controller.signal)
          )
            break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) logError(error);
    } finally {
      if (activeController === controller) activeController = null;
      const shouldRestore =
        context &&
        taskRunId === runId &&
        !disposed &&
        !controller.signal.aborted &&
        (!ideDriver.isCurrent || ideDriver.isCurrent(context));
      if (shouldRestore && typeof ideDriver.restore === "function") {
        try {
          ideDriver.restore(context);
        } catch (error) {
          logError(error);
        }
      }
      if (taskRunId === runId) {
        state = "idle";
        driving = false;
        cancelDelay();
        if (context && context.kind === "ready" && ideDriver.finish)
          ideDriver.finish(context, results, { stale });
      }
    }
  };
  const mount = () => {
    if (disposed) return dispose;
    const nextMountKey =
      typeof ideDriver.mountKey === "function"
        ? ideDriver.mountKey()
        : ideDriver;
    if (mounted && mountKey === nextMountKey) return dispose;
    if (mounted) {
      invalidate();
      if (stopMount) stopMount();
      stopMount = null;
      mounted = false;
    }
    mounted = true;
    mountKey = nextMountKey;
    if (typeof ideDriver.mount === "function")
      stopMount =
        ideDriver.mount({
          start,
          stop,
          invalidate,
          markStale,
          isRunning: () => state === "running" || state === "stopping",
          isDriving: () => driving,
        }) || null;
    return dispose;
  };
  const unmount = () => {
    if (!mounted) return;
    invalidate();
    if (stopMount) stopMount();
    stopMount = null;
    mountKey = null;
    mounted = false;
  };
  const dispose = () => {
    if (disposed) return;
    if (mounted) unmount();
    else invalidate();
    disposed = true;
  };
  const getState = () =>
    Object.freeze({ state, runId, driving, stale, mounted, disposed });

  return Object.freeze({
    mount,
    unmount,
    start,
    stop,
    markStale,
    dispose,
    getState,
  });
}
