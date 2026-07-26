const textEncoder = new TextEncoder();

function joinUrl(origin, path) {
  return `${String(origin).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function abortError(message) {
  return Object.assign(new Error(message), { kind: "cancelled" });
}

export async function sha256Hex(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle)
    throw new Error("Web Crypto SHA-256 is unavailable");
  const bytes =
    typeof value === "string" ? textEncoder.encode(value) : value;
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchVerifiedAsset(options) {
  const {
    origins,
    path,
    sha256,
    signal,
    fetchImpl = fetch,
    timeoutMs = 8000,
  } = options || {};
  if (
    !Array.isArray(origins) ||
    !origins.length ||
    typeof path !== "string" ||
    !path ||
    !/^[a-f0-9]{64}$/.test(String(sha256))
  )
    throw new TypeError("Invalid verified asset request");

  const failures = [];
  for (const origin of origins) {
    if (signal?.aborted) throw abortError("CDN load was cancelled");
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
    const url = joinUrl(origin, path);
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const actual = await sha256Hex(bytes);
      if (actual !== sha256)
        throw new Error(`SHA-256 mismatch: ${actual}`);
      return Object.freeze({
        bytes,
        origin,
        url,
        contentType: response.headers.get("content-type") || "",
      });
    } catch (error) {
      if (signal?.aborted) throw abortError("CDN load was cancelled");
      failures.push(`${url}: ${error?.message || error}`);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }
  throw Object.assign(
    new Error(`All CDN origins failed for ${path}: ${failures.join(" | ")}`),
    { kind: "cdn-unavailable", failures },
  );
}

export async function loadVerifiedManifest(options) {
  const asset = await fetchVerifiedAsset(options);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(asset.bytes));
  } catch (error) {
    throw Object.assign(new Error("CDN manifest is not valid JSON"), {
      kind: "manifest-invalid",
      cause: error,
    });
  }
  if (
    manifest?.schemaVersion !== 1 ||
    typeof manifest.release !== "string" ||
    !manifest.esm?.entries ||
    !manifest.files
  )
    throw Object.assign(new Error("CDN manifest schema is invalid"), {
      kind: "manifest-invalid",
    });
  return Object.freeze({ manifest, origin: asset.origin, url: asset.url });
}

export async function importVerifiedModule(options) {
  const {
    manifest,
    entry,
    origins,
    signal,
    fetchImpl,
    timeoutMs,
    importer = (url) => import(url),
    urlApi = URL,
  } = options || {};
  const path = manifest?.esm?.entries?.[entry];
  const file = path && manifest.files?.[path];
  if (!file)
    throw new TypeError(`Unknown CDN module entry: ${entry}`);
  const asset = await fetchVerifiedAsset({
    origins,
    path,
    sha256: file.sha256,
    signal,
    fetchImpl,
    timeoutMs,
  });
  const objectUrl = urlApi.createObjectURL(
    new Blob([asset.bytes], { type: "text/javascript" }),
  );
  try {
    const module = await importer(objectUrl);
    return Object.freeze({
      module,
      origin: asset.origin,
      path,
      sha256: file.sha256,
    });
  } catch (error) {
    throw Object.assign(
      new Error(`Verified module execution failed: ${error?.message || error}`),
      {
        kind: "execution-policy",
        cause: error,
        origin: asset.origin,
        path,
      },
    );
  } finally {
    urlApi.revokeObjectURL(objectUrl);
  }
}
