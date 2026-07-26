import { installRestrictedEarlyGate } from "./bootstrap/restricted-early-gate.js";
import { runLuoguSP } from "./bootstrap/run-app.js";

runLuoguSP(installRestrictedEarlyGate());
