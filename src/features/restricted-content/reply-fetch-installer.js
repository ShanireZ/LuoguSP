import { createOfficialArticleWriteAdapter } from "./article-write-adapter.js";
import { createRestrictedReplyFetchAdapter } from "./reply-fetch-adapter.js";
import { createRestrictedReplyXhrAdapter } from "./reply-xhr-adapter.js";

export function createRestrictedReplyFetchInstaller(config) {
  const {
    host,
    origin,
    Response: ResponseCtor,
    URL: URLCtor,
    Request: RequestCtor,
    Headers: HeadersCtor,
    brand = Symbol("LuoguSP restricted replies"),
  } = config || {};
  if (!host || typeof host.fetch !== "function")
    throw new TypeError("Reply fetch installer requires a host fetch");
  let currentDispose = null;
  const dispose = () => {
    if (currentDispose) currentDispose();
    currentDispose = null;
  };
  const install = (lid, replies, csrf = "", onWrite = null) => {
    const installed = host.fetch && host.fetch[brand];
    if (installed && typeof installed.dispose === "function")
      installed.dispose();
    dispose();
    const realFetch = host.fetch;
    const realXhr = host.XMLHttpRequest;
    let active = true;
    const getBaseUrl = () => host.document?.baseURI ?? origin;
    const observeWrite = typeof onWrite === "function" ? (event) => {
      if (active) onWrite(event);
    } : null;
    const latestWrites = new Map();
    const beginWrite = (url) => {
      const kind = url.pathname.endsWith("/vote") ? "vote" : "favor";
      const previous = latestWrites.get(kind);
      const request = {};
      latestWrites.set(kind, request);
      return {
        observe(event) {
          if (latestWrites.get(kind) === request) observeWrite?.(event);
        },
        cancel() {
          if (latestWrites.get(kind) === request) latestWrites.set(kind, previous);
        },
      };
    };
    const articleFetch = csrf
      ? createOfficialArticleWriteAdapter({
          fetch: (input, init) => realFetch.call(host, input, init),
          origin,
          URL: URLCtor,
          Request: RequestCtor,
          Headers: HeadersCtor,
          lid,
          csrf,
          onWrite: observeWrite,
          beginWrite,
          getBaseUrl,
        }).fetch
      : (input, init) => realFetch.call(host, input, init);
    const adapter = createRestrictedReplyFetchAdapter({
      fetch: articleFetch,
      origin,
      Response: ResponseCtor,
      URL: URLCtor,
      lid,
      replies,
      getBaseUrl,
    });
    const interceptingFetch = adapter.fetch;
    const InterceptingXhr =
      typeof realXhr === "function"
        ? createRestrictedReplyXhrAdapter({
            XMLHttpRequest: realXhr,
            URL: URLCtor,
            Event: host.Event,
            ProgressEvent: host.ProgressEvent,
            origin,
            lid,
            replies,
            onWrite: observeWrite,
            beginWrite,
            isActive: () => active,
            getBaseUrl,
          }).XMLHttpRequest
        : null;
    const wrapped = function (input, init) {
      return active
        ? interceptingFetch(input, init)
        : realFetch.call(host, input, init);
    };
    const release = () => {
      active = false;
      if (host.fetch === wrapped) host.fetch = realFetch;
      if (InterceptingXhr && host.XMLHttpRequest === InterceptingXhr)
        host.XMLHttpRequest = realXhr;
      if (currentDispose === release) currentDispose = null;
    };
    Object.defineProperty(wrapped, brand, {
      value: Object.freeze({ dispose: release }),
    });
    host.fetch = wrapped;
    if (InterceptingXhr) host.XMLHttpRequest = InterceptingXhr;
    currentDispose = release;
    return release;
  };
  return Object.freeze({ install, dispose });
}
