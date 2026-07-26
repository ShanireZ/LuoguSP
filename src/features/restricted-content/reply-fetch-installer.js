import { createRestrictedReplyFetchAdapter } from "./reply-fetch-adapter.js";

export function createRestrictedReplyFetchInstaller(config) {
  const {
    host,
    origin,
    Response: ResponseCtor,
    URL: URLCtor,
    brand = Symbol("LuoguSP restricted replies"),
  } = config || {};
  if (!host || typeof host.fetch !== "function")
    throw new TypeError("Reply fetch installer requires a host fetch");
  let currentDispose = null;
  const dispose = () => {
    if (currentDispose) currentDispose();
    currentDispose = null;
  };
  const install = (lid, replies) => {
    const installed = host.fetch && host.fetch[brand];
    if (installed && typeof installed.dispose === "function")
      installed.dispose();
    dispose();
    const realFetch = host.fetch;
    const adapter = createRestrictedReplyFetchAdapter({
      fetch: (input, init) => realFetch.call(host, input, init),
      origin,
      Response: ResponseCtor,
      URL: URLCtor,
      lid,
      replies,
    });
    const interceptingFetch = adapter.fetch;
    let active = true;
    const wrapped = function (input, init) {
      return active
        ? interceptingFetch(input, init)
        : realFetch.call(host, input, init);
    };
    const release = () => {
      active = false;
      if (host.fetch === wrapped) host.fetch = realFetch;
      if (currentDispose === release) currentDispose = null;
    };
    Object.defineProperty(wrapped, brand, {
      value: Object.freeze({ dispose: release }),
    });
    host.fetch = wrapped;
    currentDispose = release;
    return release;
  };
  return Object.freeze({ install, dispose });
}
