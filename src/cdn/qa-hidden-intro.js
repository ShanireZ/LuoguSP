const QA_MODES = new Set([
  "native",
  "fallback",
  "fallback-retry",
  "fallback-lite",
]);

const RENDERER_PATH_PATTERN =
  /\/render\/markdown-renderer\.[a-f0-9]{16}\.js$/;

export function getQaHiddenIntroMode(release, href) {
  if (!String(release).includes("-")) return null;
  let mode;
  try {
    mode = new URL(href).searchParams.get("luogusp-qa");
  } catch (error) {
    return null;
  }
  return QA_MODES.has(mode) ? mode : null;
}

export function isQaForcedFallback(mode) {
  return typeof mode === "string" && mode.startsWith("fallback");
}

export function createQaRendererOptions(mode) {
  return mode === "fallback-lite"
    ? Object.freeze({ forceFullFailure: true })
    : undefined;
}

export function createQaRendererFetch({
  mode,
  origin,
  fetchImpl,
} = {}) {
  if (typeof fetchImpl !== "function")
    throw new TypeError("QA renderer fetch requires a fetch implementation");
  if (mode !== "fallback-retry")
    return fetchImpl;

  const configuredOrigin = new URL(origin).origin;
  let failFirstRequest = true;

  return async (url, init) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return fetchImpl(url, init);
    }
    const isConfiguredOrigin = parsed.origin === configuredOrigin;
    const isRenderer =
      isConfiguredOrigin &&
      RENDERER_PATH_PATTERN.test(parsed.pathname);
    if (!isRenderer || !failFirstRequest)
      return fetchImpl(url, init);
    failFirstRequest = false;
    return Object.freeze({
      ok: false,
      status: 503,
      headers: Object.freeze({ get: () => null }),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
  };
}
