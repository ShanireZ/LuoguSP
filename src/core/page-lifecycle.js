export function createPageLifecycle(config) {
  const {
    routeAdapter,
    documentAdapter,
    storage,
    logError = () => {},
  } = config || {};
  if (!routeAdapter || typeof routeAdapter.subscribe !== "function")
    throw new TypeError("Page Lifecycle requires a route adapter");
  if (
    !documentAdapter ||
    typeof documentAdapter.schedule !== "function" ||
    typeof documentAdapter.whenReady !== "function"
  )
    throw new TypeError("Page Lifecycle requires a document adapter");

  const features = new Map();
  let disposers = [];
  let routeDispose = null;
  let scheduledDispose = null;
  let readyDispose = null;
  let generation = 0;
  let started = false;
  let disposed = false;
  let replacing = false;
  let lastRouteToken = "";

  const context = () => {
    const contextGeneration = generation;
    return Object.freeze({
      generation,
      routeToken:
        typeof routeAdapter.token === "function" ? routeAdapter.token() : "",
      isCurrent: () =>
        !disposed && !replacing && generation === contextGeneration,
    });
  };
  const disposeFeatures = () => {
    const current = disposers;
    disposers = [];
    for (let index = current.length - 1; index >= 0; index--) {
      try {
        current[index]();
      } catch (error) {
        logError("dispose", error);
      }
    }
  };
  const mountFeatures = () => {
    if (!started || disposed || replacing) return;
    const mountContext = context();
    for (const feature of features.values()) {
      let enabled = true;
      try {
        enabled =
          typeof feature.enabled === "function"
            ? !!feature.enabled(storage)
            : true;
        if (!enabled) continue;
        const dispose = feature.mount(mountContext);
        if (typeof dispose === "function") disposers.push(dispose);
      } catch (error) {
        logError(feature.id, error);
      }
    }
  };
  const cancelScheduled = () => {
    if (!scheduledDispose) return;
    scheduledDispose();
    scheduledDispose = null;
  };
  const releaseReady = (dispose = readyDispose) => {
    if (dispose === readyDispose) readyDispose = null;
    if (typeof dispose !== "function") return;
    try {
      dispose();
    } catch (error) {
      logError("documentReadyDispose", error);
    }
  };
  const remount = () => {
    if (!started || disposed || replacing) return;
    cancelScheduled();
    disposeFeatures();
    generation++;
    scheduledDispose =
      documentAdapter.schedule(() => {
        scheduledDispose = null;
        mountFeatures();
      }) || null;
  };
  const handleRoute = (event) => {
    if (!started || disposed || replacing) return;
    const nextRouteToken =
      typeof routeAdapter.token === "function" ? routeAdapter.token() : "";
    const persistedPageRestore =
      event?.type === "pageshow" && event.persisted === true;
    if (nextRouteToken === lastRouteToken) {
      if (persistedPageRestore) remount();
      return;
    }
    const routeContext = Object.freeze({
      generation,
      previousRouteToken: lastRouteToken,
      routeToken: nextRouteToken,
    });
    for (const feature of features.values()) {
      if (typeof feature.onRoute !== "function") continue;
      try {
        feature.onRoute(routeContext);
      } catch (error) {
        logError(`${feature.id}:route`, error);
      }
    }
    lastRouteToken = nextRouteToken;
    remount();
  };
  const register = (feature) => {
    if (
      !feature ||
      typeof feature.id !== "string" ||
      typeof feature.mount !== "function"
    )
      throw new TypeError("Page Lifecycle feature is invalid");
    if (features.has(feature.id))
      throw new Error(`Page Lifecycle feature already registered: ${feature.id}`);
    features.set(feature.id, feature);
    if (started && !disposed) remount();
    return lifecycle;
  };
  const start = () => {
    if (disposed || started) return;
    started = true;
    generation++;
    lastRouteToken =
      typeof routeAdapter.token === "function" ? routeAdapter.token() : "";
    routeDispose = routeAdapter.subscribe(handleRoute) || null;
    mountFeatures();
  };
  const replaceDocument = (commit) => {
    if (disposed || replacing || typeof commit !== "function") return false;
    cancelScheduled();
    disposeFeatures();
    generation++;
    const replacementGeneration = generation;
    replacing = true;
    let afterReady;
    try {
      afterReady = commit(context());
    } catch (error) {
      replacing = false;
      logError("replaceDocument", error);
      return false;
    }
    let readyFired = false;
    let pendingReadyDispose = null;
    try {
      const disposeReady = documentAdapter.whenReady(() => {
        readyFired = true;
        releaseReady();
        if (disposed || generation !== replacementGeneration) return;
        replacing = false;
        mountFeatures();
        if (typeof afterReady === "function") {
          try {
            afterReady(context());
          } catch (error) {
            logError("afterDocumentReady", error);
          }
        }
      });
      if (typeof disposeReady === "function")
        pendingReadyDispose = disposeReady;
    } catch (error) {
      replacing = false;
      logError("documentReady", error);
      return false;
    }
    if (readyFired) {
      releaseReady(pendingReadyDispose);
    } else readyDispose = pendingReadyDispose;
    return true;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelScheduled();
    releaseReady();
    disposeFeatures();
    if (routeDispose) routeDispose();
    routeDispose = null;
  };
  const getState = () =>
    Object.freeze({
      generation,
      started,
      disposed,
      replacing,
      featureCount: features.size,
      mountedCount: disposers.length,
    });
  const lifecycle = Object.freeze({
    register,
    start,
    replaceDocument,
    dispose,
    getState,
  });
  return lifecycle;
}
