import { installRestrictedEarlyGate } from "../bootstrap/restricted-early-gate.js";
import { runLuoguSP } from "../bootstrap/run-app.js";

function createQaProbe(release) {
  if (!String(release).includes("-")) return null;
  const mode = new URL(location.href).searchParams.get("luogusp-qa");
  if (!mode) return null;
  const probe = document.createElement("meta");
  probe.id = "luogusp-qa-hidden-intro";
  probe.name = "luogusp-qa-hidden-intro";
  Object.assign(probe.dataset, {
    release,
    mode,
    status: "idle",
    reason: "",
    rendererLoads: "0",
    rendererStatus: "idle",
    rendererOrigin: "",
  });
  const attach = () => {
    if (!probe.isConnected)
      (document.head || document.documentElement)?.appendChild(probe);
  };
  attach();
  if (!probe.isConnected)
    document.addEventListener("DOMContentLoaded", attach, { once: true });
  return Object.freeze({
    mode,
    diagnostic(details) {
      probe.dataset.status = details.status;
      probe.dataset.reason = details.reason || "";
    },
    renderer(event) {
      probe.dataset.rendererStatus = event.type;
      if (event.type === "request-start")
        probe.dataset.rendererLoads = String(
          Number(probe.dataset.rendererLoads || "0") + 1,
        );
      if (event.origin) probe.dataset.rendererOrigin = event.origin;
      if (event.kind) probe.dataset.rendererFailure = event.kind;
    },
  });
}

const runtime = Object.freeze({
  release: __LUOGUSP_CDN_RELEASE__,
  apiVersion: 1,
});
const qaProbe = createQaProbe(runtime.release);
const forcedFallbackAdapter =
  qaProbe?.mode === "fallback"
    ? Object.freeze({
        attach: async () =>
          Object.freeze({
            status: "native-unsupported",
            reason: "qa-forced-fallback",
          }),
      })
    : undefined;
Object.defineProperty(globalThis, "__LUOGUSP_CDN_RUNTIME__", {
  value: runtime,
  configurable: true,
});
runLuoguSP(installRestrictedEarlyGate(), {
  hiddenIntroRendererConfig: Object.freeze({
    bundle: __LUOGUSP_MARKDOWN_RENDERER_BUNDLE__,
    origins: __LUOGUSP_CDN_ORIGINS__,
    onEvent: qaProbe?.renderer,
  }),
  hiddenIntroNativeAdapter: forcedFallbackAdapter,
  hiddenIntroDiagnosticReporter: qaProbe?.diagnostic,
});
