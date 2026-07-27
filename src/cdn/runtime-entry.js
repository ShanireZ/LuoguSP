import { installRestrictedEarlyGate } from "../bootstrap/restricted-early-gate.js";
import { runLuoguSP } from "../bootstrap/run-app.js";
import {
  createQaRendererFetch,
  createQaRendererOptions,
  getQaHiddenIntroMode,
  isQaForcedFallback,
} from "./qa-hidden-intro.js";
import { createUserscriptFetch } from "./userscript-fetch.js";

function createQaProbe(release, mode) {
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
    nativeStatus: "idle",
    nativeReason: "",
    fallbackStatus: "idle",
    fallbackReason: "",
    rendererDetail: "",
    rendererTransport: "",
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
      if (
        details.status.startsWith("native-") ||
        details.status === "already-native"
      ) {
        probe.dataset.nativeStatus = details.status;
        probe.dataset.nativeReason = details.reason || "";
      }
      if (details.status.startsWith("fallback-")) {
        probe.dataset.fallbackStatus = details.status;
        probe.dataset.fallbackReason = details.reason || "";
      }
    },
    renderer(event) {
      probe.dataset.rendererStatus = event.type;
      if (event.type === "request-start")
        probe.dataset.rendererLoads = String(
          Number(probe.dataset.rendererLoads || "0") + 1,
        );
      if (event.origin) probe.dataset.rendererOrigin = event.origin;
      if (event.kind) probe.dataset.rendererFailure = event.kind;
      if (event.message || event.failures?.length)
        probe.dataset.rendererDetail = [
          event.message || "",
          ...(event.failures || []),
        ]
          .filter(Boolean)
          .join(" | ")
          .slice(0, 2000);
    },
  });
}

const runtime = Object.freeze({
  release: __LUOGUSP_CDN_RELEASE__,
  apiVersion: 1,
});
const qaMode = getQaHiddenIntroMode(runtime.release, location.href);
const qaProbe = createQaProbe(runtime.release, qaMode);
const userscriptFetch = createUserscriptFetch();
const rendererFetch = createQaRendererFetch({
  mode: qaMode,
  origins: __LUOGUSP_CDN_ORIGINS__,
  fetchImpl: userscriptFetch.fetchImpl,
});
const qaProbeElement = document.querySelector(
  "#luogusp-qa-hidden-intro",
);
if (qaProbeElement)
  qaProbeElement.dataset.rendererTransport =
    userscriptFetch.transport;
const forcedFallbackAdapter =
  isQaForcedFallback(qaMode)
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
    fetchImpl: rendererFetch,
    renderOptions: createQaRendererOptions(qaMode),
    onEvent: qaProbe?.renderer,
  }),
  hiddenIntroNativeAdapter: forcedFallbackAdapter,
  hiddenIntroDiagnosticReporter: qaProbe?.diagnostic,
});
