import { installRestrictedEarlyGate } from "../bootstrap/restricted-early-gate.js";

installRestrictedEarlyGate();
Object.defineProperty(globalThis, "__LUOGUSP_CDN_EARLY_GATE__", {
  value: Object.freeze({
    release: __LUOGUSP_CDN_RELEASE__,
    apiVersion: 1,
  }),
  configurable: true,
});
