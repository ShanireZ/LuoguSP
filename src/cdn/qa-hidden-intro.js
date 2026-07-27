const QA_MODES = new Set([
  "native",
  "fallback",
  "fallback-primary-fail",
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
  origins,
  fetchImpl,
} = {}) {
  if (typeof fetchImpl !== "function")
    throw new TypeError("QA renderer fetch requires a fetch implementation");
  if (
    !["fallback-primary-fail", "fallback-retry"].includes(mode)
  )
    return fetchImpl;

  const configuredOrigins = Array.isArray(origins)
    ? origins.map((origin) => new URL(origin).origin)
    : [];
  let retryFailuresRemaining =
    mode === "fallback-retry" ? configuredOrigins.length : 0;

  return async (url, init) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return fetchImpl(url, init);
    }
    const originIndex = configuredOrigins.indexOf(parsed.origin);
    const isRenderer =
      originIndex !== -1 && RENDERER_PATH_PATTERN.test(parsed.pathname);
    const failPrimary =
      mode === "fallback-primary-fail" &&
      isRenderer &&
      originIndex === 0;
    const failRetryCycle =
      mode === "fallback-retry" &&
      isRenderer &&
      retryFailuresRemaining > 0;
    if (!failPrimary && !failRetryCycle)
      return fetchImpl(url, init);
    if (failRetryCycle) retryFailuresRemaining--;
    return Object.freeze({
      ok: false,
      status: 503,
      headers: Object.freeze({ get: () => null }),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
  };
}
