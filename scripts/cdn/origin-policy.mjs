const PLATFORM_DEFAULT_SUFFIXES = Object.freeze([
  ".workers.dev",
  ".edgeone.cool",
]);

function configuredOrigin(id, value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(`${id} CDN origin must be a clean HTTPS origin`);
  if (
    PLATFORM_DEFAULT_SUFFIXES.some((suffix) =>
      url.hostname.endsWith(suffix),
    )
  )
    throw new Error(`${id} CDN origin must not use a platform default domain`);
  return url.origin;
}

export function resolveConfiguredOrigins(options) {
  const { config, primaryOverride, fallbackOverride } = options || {};
  const primary = configuredOrigin(
    "primary",
    config?.origins?.primary,
  );
  const fallback = configuredOrigin(
    "fallback",
    config?.origins?.fallback,
  );
  if (new URL(primary).hostname === new URL(fallback).hostname)
    throw new Error("CDN origins must use different custom domains");

  for (const [id, override, expected] of [
    ["primary", primaryOverride, primary],
    ["fallback", fallbackOverride, fallback],
  ]) {
    if (override == null) continue;
    const actual = configuredOrigin(id, override);
    if (actual !== expected)
      throw new Error(
        `${id} override must match config/cdn.json; platform preview and default origins are disabled`,
      );
  }
  return Object.freeze({ primary, fallback });
}
