export function createBrowserRouteAdapter(config) {
  const {
    history: historyAdapter,
    eventTarget,
    token: getToken = () => "",
    logError = () => {},
  } = config || {};
  if (
    !historyAdapter ||
    typeof historyAdapter.pushState !== "function" ||
    typeof historyAdapter.replaceState !== "function"
  )
    throw new TypeError("Route Adapter requires a history adapter");
  if (
    !eventTarget ||
    typeof eventTarget.addEventListener !== "function" ||
    typeof eventTarget.removeEventListener !== "function"
  )
    throw new TypeError("Route Adapter requires an event target");

  const listeners = new Set();
  const originals = {};
  const wrappers = {};
  const wrapperStates = {};
  let installed = false;
  const notify = (event) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        logError(error);
      }
    }
  };
  const install = () => {
    if (installed) return;
    installed = true;
    for (const method of ["pushState", "replaceState"]) {
      const raw = historyAdapter[method];
      const wrapperState = { active: true };
      originals[method] = raw;
      const wrapped = function (...args) {
        const result = raw.apply(this, args);
        if (wrapperState.active) notify();
        return result;
      };
      wrappers[method] = wrapped;
      wrapperStates[method] = wrapperState;
      historyAdapter[method] = wrapped;
    }
    eventTarget.addEventListener("popstate", notify);
    eventTarget.addEventListener("hashchange", notify);
    eventTarget.addEventListener("pageshow", notify);
  };
  const uninstall = () => {
    if (!installed || listeners.size) return;
    installed = false;
    for (const method of ["pushState", "replaceState"]) {
      if (wrapperStates[method]) wrapperStates[method].active = false;
      if (originals[method] && historyAdapter[method] === wrappers[method])
        historyAdapter[method] = originals[method];
      delete originals[method];
      delete wrappers[method];
      delete wrapperStates[method];
    }
    eventTarget.removeEventListener("popstate", notify);
    eventTarget.removeEventListener("hashchange", notify);
    eventTarget.removeEventListener("pageshow", notify);
  };
  return Object.freeze({
    token: () => getToken(),
    subscribe: (listener) => {
      if (typeof listener !== "function")
        throw new TypeError("Route Adapter listener must be a function");
      listeners.add(listener);
      install();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        uninstall();
      };
    },
  });
}
