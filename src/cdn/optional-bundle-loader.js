import { fetchVerifiedAsset } from "./canary-loader.js";

function cancelledError(message = "Optional bundle load was cancelled") {
  return Object.assign(new Error(message), { kind: "cancelled" });
}

function validateOptions(bundle, origins, expectedApiVersion) {
  if (
    !bundle ||
    typeof bundle.path !== "string" ||
    !/^[a-f0-9]{64}$/.test(String(bundle.sha256)) ||
    !Number.isInteger(bundle.apiVersion) ||
    !Array.isArray(origins) ||
    !origins.length ||
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

function validateModule(module, expectedApiVersion) {
  if (module?.apiVersion !== expectedApiVersion)
    throw Object.assign(
      new Error(
        `Loaded optional bundle API ${module?.apiVersion} does not match ${expectedApiVersion}`,
      ),
      { kind: "api-version" },
    );
  if (
    typeof module.renderMarkdown !== "function" ||
    typeof module.enhanceCodeBlocks !== "function"
  )
    throw Object.assign(new Error("Optional renderer API is incomplete"), {
      kind: "api-invalid",
    });
}

export function createOptionalBundleLoader(options = {}) {
  const {
    bundle,
    origins,
    expectedApiVersion,
    fetchImpl,
    timeoutMs,
    importer = (url) => import(url),
    urlApi = globalThis.URL,
    BlobImpl = globalThis.Blob,
    onEvent = () => {},
  } = options;
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
    validateOptions(bundle, origins, expectedApiVersion);
    if (signal?.aborted) throw cancelledError();
    emit({ type: "request-start", path: bundle.path });
    const asset = await fetchVerifiedAsset({
      origins,
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
      validateModule(module, expectedApiVersion);
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
