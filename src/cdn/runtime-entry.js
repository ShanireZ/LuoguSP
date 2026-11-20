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

function createQaProbe(release, mode, rendererTransport) {
  if (!mode) return null;
  const probe = document.createElement("meta");
  probe.id = probe.name = "luogusp-qa-hidden-intro";
  const { dataset } = probe;
  Object.assign(dataset, {
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
    rendererTransport,
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
    diagnostic({ status, reason }) {
      dataset.status = status;
      dataset.reason = reason || "";
      if (
        status.startsWith("native-") ||
        status === "already-native"
      ) {
        dataset.nativeStatus = status;
        dataset.nativeReason = dataset.reason;
      }
      if (status.startsWith("fallback-")) {
        dataset.fallbackStatus = status;
        dataset.fallbackReason = dataset.reason;
      }
    },
    renderer(event) {
      updateQaRendererProbeDataset(dataset, event);
    },
  });
}

const runtime = Object.freeze({
  release: __LUOGUSP_CDN_RELEASE__,
  apiVersion: 1,
});
const qaMode = getQaHiddenIntroMode(runtime.release, location.href);
const userscriptFetch = createUserscriptFetch();
const qaProbe = createQaProbe(runtime.release, qaMode, userscriptFetch.transport);
const origin = __LUOGUSP_CDN_ORIGIN__;
const bundleFromPin = ([apiVersion, asset, sha256]) =>
  ({ apiVersion, path: `releases/${runtime.release}/${asset}.${sha256.slice(0, 16)}.js`, sha256 });
const rendererFetch = createQaRendererFetch({
  mode: qaMode,
  origin,
  fetchImpl: userscriptFetch.fetchImpl,
});
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
const loadFeature = (pin, factory) => {
  const loader = createOptionalBundleLoader({
    bundle: bundleFromPin(pin),
    origin,
    expectedApiVersion: 1,
    exports: [factory],
    fetchImpl: userscriptFetch.fetchImpl,
  });
  return () => loader.load().then((result) => result.module);
};
runLuoguSP(installRestrictedEarlyGate(), {
  hoverCardLoadBundle: loadFeature(__LUOGUSP_HOVER_CARD_BUNDLE__, "createHoverCardFeature"),
  // 卡片資料全部同源，用頁面自己的 fetch（帶 Cookie 與 CSRF）。
  hoverCardFetchPage: (path, signal, init) =>
    fetch(path, { credentials: "same-origin", ...(init || {}), signal }),
  restrictedContentLoadBundle: loadFeature(__LUOGUSP_RESTRICTED_CONTENT_BUNDLE__, "createRestrictedContentFeature"),
  hiddenIntroRendererConfig: Object.freeze({
    bundle: bundleFromPin(__LUOGUSP_MARKDOWN_RENDERER_BUNDLE__),
    origin,
    fetchImpl: rendererFetch,
    renderOptions: createQaRendererOptions(qaMode),
    onEvent: qaProbe?.renderer,
  }),
  hiddenIntroNativeAdapter: forcedFallbackAdapter,
  hiddenIntroDiagnosticReporter: qaProbe?.diagnostic,
});
