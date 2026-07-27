import { installRestrictedEarlyGate } from "../bootstrap/restricted-early-gate.js";
import { runLuoguSP } from "../bootstrap/run-app.js";

const runtime = Object.freeze({
  release: __LUOGUSP_CDN_RELEASE__,
  apiVersion: 1,
});
Object.defineProperty(globalThis, "__LUOGUSP_CDN_RUNTIME__", {
  value: runtime,
  configurable: true,
});
runLuoguSP(installRestrictedEarlyGate(), {
  hiddenIntroRendererConfig: Object.freeze({
    bundle: __LUOGUSP_MARKDOWN_RENDERER_BUNDLE__,
    origins: __LUOGUSP_CDN_ORIGINS__,
  }),
});
