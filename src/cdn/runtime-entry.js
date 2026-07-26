import { installRestrictedEarlyGate } from "../bootstrap/restricted-early-gate.js";
import { runLuoguSP } from "../bootstrap/run-app.js";

runLuoguSP(installRestrictedEarlyGate());
Object.defineProperty(globalThis, "__LUOGUSP_CDN_RUNTIME__", {
  value: Object.freeze({
    release: __LUOGUSP_CDN_RELEASE__,
    apiVersion: 1,
  }),
  configurable: true,
});
