import { installRestrictedEarlyGate } from "../bootstrap/restricted-early-gate.js";
import { runLuoguSP } from "../bootstrap/run-app.js";
import {
  createQaRendererFetch,
  createQaRendererOptions,
  getQaHiddenIntroMode,
  isQaForcedFallback,
  updateQaRendererProbeDataset,
} from "./qa-hidden-intro.js";
import { createUserscriptFetch } from "./userscript-fetch.js";
import { createOptionalBundleLoader } from "./optional-bundle-loader.js";

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
    rendererFailure: "",
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
      updateQaRendererProbeDataset(probe.dataset, event);
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
  origin: __LUOGUSP_CDN_ORIGIN__,
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
// 受限内容功能块：只在真的落到「安全访问中心」拦截页时才拉（见 features/restricted-content/lazy-feature.js）。
const restrictedContentLoader = createOptionalBundleLoader({
  bundle: __LUOGUSP_RESTRICTED_CONTENT_BUNDLE__,
  origin: __LUOGUSP_CDN_ORIGIN__,
  expectedApiVersion: 1,
  exports: ["createRestrictedContentFeature"],
  fetchImpl: userscriptFetch.fetchImpl,
});
const hoverCardLoader = createOptionalBundleLoader({
  bundle: __LUOGUSP_HOVER_CARD_BUNDLE__,
  origin: __LUOGUSP_CDN_ORIGIN__,
  expectedApiVersion: 1,
  exports: ["createHoverCardFeature"],
  fetchImpl: userscriptFetch.fetchImpl,
});
runLuoguSP(installRestrictedEarlyGate(), {
  hoverCardLoadBundle: () =>
    hoverCardLoader.load().then((result) => result.module),
  // 卡片数据全部同源，用页面自己的 fetch（带 Cookie 与 CSRF）。
  hoverCardFetchPage: (path, signal, init) =>
    fetch(path, { credentials: "same-origin", ...(init || {}), signal }),
  restrictedContentLoadBundle: () =>
    restrictedContentLoader.load().then((result) => result.module),
  hiddenIntroRendererConfig: Object.freeze({
    bundle: __LUOGUSP_MARKDOWN_RENDERER_BUNDLE__,
    origin: __LUOGUSP_CDN_ORIGIN__,
    fetchImpl: rendererFetch,
    renderOptions: createQaRendererOptions(qaMode),
    onEvent: qaProbe?.renderer,
  }),
  hiddenIntroNativeAdapter: forcedFallbackAdapter,
  hiddenIntroDiagnosticReporter: qaProbe?.diagnostic,
});
