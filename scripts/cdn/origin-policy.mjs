const PLATFORM_DEFAULT_SUFFIXES = Object.freeze([
  ".workers.dev",
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

export function resolveConfiguredOrigin(options) {
  const { config, originOverride } = options || {};
  const primary = configuredOrigin(
    "primary",
    config?.origins?.primary,
  );
  if (originOverride == null) return primary;
  const actual = configuredOrigin("origin", originOverride);
  if (actual !== primary)
    throw new Error(
      "origin override must match config/cdn.json; platform preview and default origins are disabled",
    );
  return primary;
}

export function resolveBootstrapOrigin(config) {
  const primary = resolveConfiguredOrigin({ config });
  const bootstrap = configuredOrigin(
    "bootstrap",
    config?.origins?.bootstrap,
  );
  if (bootstrap !== primary)
    throw new Error("bootstrap CDN origin must match primary");
  return bootstrap;
}

export function resolveLegacyOrigins(config) {
  const primary = resolveConfiguredOrigin({ config });
  const values = config?.origins?.legacy;
  if (!Array.isArray(values))
    throw new Error("legacy CDN origins must be an array");
  const origins = values.map((value, index) =>
    configuredOrigin(`legacy[${index}]`, value),
  );
  if (new Set(origins).size !== origins.length)
    throw new Error("legacy CDN origins must be unique");
  if (origins.includes(primary))
    throw new Error("legacy CDN origins must differ from primary");
  return Object.freeze(origins);
}

export function resolveSupportedOrigins(config) {
  return Object.freeze([
    resolveConfiguredOrigin({ config }),
    ...resolveLegacyOrigins(config),
  ]);
}
