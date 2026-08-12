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
    const articleFetch = csrf
      ? createOfficialArticleWriteAdapter({
          fetch: (input, init) => realFetch.call(host, input, init),
          origin,
          URL: URLCtor,
          Request: RequestCtor,
          Headers: HeadersCtor,
          lid,
          csrf,
          onWrite,
        }).fetch
      : (input, init) => realFetch.call(host, input, init);
    const adapter = createRestrictedReplyFetchAdapter({
      fetch: articleFetch,
      origin,
      Response: ResponseCtor,
      URL: URLCtor,
      lid,
      replies,
    });
    const interceptingFetch = adapter.fetch;
    const InterceptingXhr =
      typeof realXhr === "function"
        ? createRestrictedReplyXhrAdapter({
            XMLHttpRequest: realXhr,
            URL: URLCtor,
            origin,
            lid,
            replies,
            onWrite,
          }).XMLHttpRequest
        : null;
    let active = true;
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
