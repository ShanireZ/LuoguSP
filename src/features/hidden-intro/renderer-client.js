import { createOptionalBundleLoader } from "../../cdn/optional-bundle-loader.js";
import { MARKDOWN_RENDERER_API_VERSION } from "../../rendering/renderer-dependencies.js";

function cancelledError() {
  return Object.assign(new Error("Renderer request was cancelled"), {
    kind: "cancelled",
  });
}

function validateRenderResult(result) {
  if (
    !result ||
    typeof result.html !== "string" ||
    !["full", "lite"].includes(result.mode) ||
    !Array.isArray(result.warnings)
  )
    throw Object.assign(new Error("Renderer returned an invalid result"), {
      kind: "api-invalid",
    });
}

export function createRendererClient(options = {}) {
  const {
    renderOptions,
    loader = createOptionalBundleLoader({
      bundle: options.bundle,
      origin: options.origin,
      expectedApiVersion:
        options.expectedApiVersion || MARKDOWN_RENDERER_API_VERSION,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      importer: options.importer,
      urlApi: options.urlApi,
      BlobImpl: options.BlobImpl,
      onEvent: options.onEvent,
    }),
  } = options;

  return Object.freeze({
    async renderInto(root, source, { signal } = {}) {
      if (!root || typeof root.replaceChildren !== "function")
        throw new TypeError("Renderer target must be a DOM element");
      if (signal?.aborted) throw cancelledError();
      const loaded = await loader.load({ signal });
      if (signal?.aborted) throw cancelledError();
      const result = loaded.module.renderMarkdown(
        String(source ?? ""),
        renderOptions,
      );
      validateRenderResult(result);
      if (signal?.aborted) throw cancelledError();
      root.innerHTML = result.html;
      const warnings = [...result.warnings];
      try {
        loaded.module.enhanceCodeBlocks(root);
      } catch (error) {
        warnings.push("code-highlight-failed");
      }
      return Object.freeze({
        mode: result.mode,
        warnings: Object.freeze(warnings),
        origin: loaded.origin,
      });
    },
    getState: () => loader.getState(),
  });
}
