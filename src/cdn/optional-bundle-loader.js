import { fetchVerifiedAsset } from "./canary-loader.js";

function cancelledError(message = "Optional bundle load was cancelled") {
  return Object.assign(new Error(message), { kind: "cancelled" });
}

function validateOptions(bundle, origin, expectedApiVersion) {
  if (
    !bundle ||
    typeof bundle.path !== "string" ||
    !/^[a-f0-9]{64}$/.test(String(bundle.sha256)) ||
    !Number.isInteger(bundle.apiVersion) ||
    typeof origin !== "string" ||
    !origin ||
    !Number.isInteger(expectedApiVersion)
  )
    throw new TypeError("Invalid optional bundle configuration");
  if (bundle.apiVersion !== expectedApiVersion)
    throw Object.assign(
      new Error(
        `Optional bundle API ${bundle.apiVersion} does not match ${expectedApiVersion}`,
      ),
      { kind: "api-version" },
    );
}

// markdown 渲染器的导出契约。这里保留成默认值，是为了让既有调用方
// （hidden-intro/renderer-client.js）不必改一行；新的可选块用 `exports` 传自己的。
const MARKDOWN_RENDERER_EXPORTS = Object.freeze([
  "renderMarkdown",
  "enhanceCodeBlocks",
]);

function validateModule(module, expectedApiVersion, requiredExports) {
  if (module?.apiVersion !== expectedApiVersion)
    throw Object.assign(
      new Error(
        `Loaded optional bundle API ${module?.apiVersion} does not match ${expectedApiVersion}`,
      ),
      { kind: "api-version" },
    );
  // 缺哪个导出要报出来 —— 「API 不完整」这五个字对排查毫无帮助。
  const missing = requiredExports.filter(
    (name) => typeof module[name] !== "function",
  );
  if (missing.length)
    throw Object.assign(
      new Error(`Optional bundle API is incomplete: ${missing.join(", ")}`),
      { kind: "api-invalid", missing },
    );
}

export function createOptionalBundleLoader(options = {}) {
  const {
    bundle,
    origin,
    expectedApiVersion,
    exports: requiredExports = MARKDOWN_RENDERER_EXPORTS,
    fetchImpl,
    timeoutMs,
    importer = (url) => import(url),
    urlApi = globalThis.URL,
    BlobImpl = globalThis.Blob,
    onEvent = () => {},
  } = options;
  // 契约在构造时定死：调用方后来改 options 也影响不了已建好的 loader。
  const contract = Object.freeze(
    (Array.isArray(requiredExports) ? requiredExports : [])
      .filter((name) => typeof name === "string" && name)
      .slice(),
  );
  let loaded = null;
  let pending = null;
  const emit = (event) => {
    try {
      onEvent(Object.freeze(event));
    } catch (error) {
      // QA/diagnostic observers must never change loader behavior.
    }
  };

  const execute = async (signal) => {
    validateOptions(bundle, origin, expectedApiVersion);
    if (signal?.aborted) throw cancelledError();
    emit({ type: "request-start", path: bundle.path });
    const asset = await fetchVerifiedAsset({
      origin,
      path: bundle.path,
      sha256: bundle.sha256,
      signal,
      fetchImpl,
      timeoutMs,
    });
    if (
      typeof BlobImpl !== "function" ||
      typeof urlApi?.createObjectURL !== "function" ||
      typeof urlApi?.revokeObjectURL !== "function"
    )
      throw Object.assign(
        new Error("Verified module execution is unavailable"),
        { kind: "execution-policy" },
      );
    const objectUrl = urlApi.createObjectURL(
      new BlobImpl([asset.bytes], { type: "text/javascript" }),
    );
    try {
      const module = await importer(objectUrl);
      if (signal?.aborted) throw cancelledError();
      validateModule(module, expectedApiVersion, contract);
      emit({
        type: "loaded",
        origin: asset.origin,
        path: bundle.path,
      });
      return Object.freeze({
        module,
        origin: asset.origin,
        path: bundle.path,
        sha256: bundle.sha256,
      });
    } catch (error) {
      if (error?.kind) throw error;
      throw Object.assign(
        new Error(
          `Verified optional bundle execution failed: ${error?.message || error}`,
        ),
        { kind: "execution-policy", cause: error },
      );
    } finally {
      urlApi.revokeObjectURL(objectUrl);
    }
  };

  const load = ({ signal } = {}) => {
    if (signal?.aborted) return Promise.reject(cancelledError());
    if (loaded) return Promise.resolve(loaded);
    if (!pending) {
      const request = execute(signal);
      pending = request;
      request.then(
        (result) => {
          if (pending === request) {
            loaded = result;
            pending = null;
          }
        },
        (error) => {
          if (pending === request) {
            pending = null;
            emit({
              type: "load-failed",
              kind: error?.kind || "unknown",
              message: error?.message || String(error),
              failures: Array.isArray(error?.failures)
                ? [...error.failures]
                : [],
              path: bundle?.path || null,
            });
          }
        },
      );
    }
    return pending;
  };

  return Object.freeze({
    load,
    getState: () =>
      Object.freeze({
        status: loaded ? "loaded" : pending ? "loading" : "idle",
        origin: loaded?.origin || null,
      }),
  });
}
