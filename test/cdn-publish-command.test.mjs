import test from "node:test";
import assert from "node:assert/strict";
import { commandInvocation } from "../scripts/cdn/command-invocation.mjs";

test("CDN publishing uses the PATH npx shim under pnpm on Windows", () => {
  const args = ["-y", "wrangler@4.107.0", "deploy"];
  const nodeExecutable = "C:\\node\\node.exe";

  assert.deepEqual(
    commandInvocation("npx", args, { platform: "win32", nodeExecutable }),
    [
      nodeExecutable,
      ["C:\\node\\node_modules\\npm\\bin\\npx-cli.js", ...args],
    ],
  );
  assert.deepEqual(commandInvocation("node", ["prepare.mjs"]), [
    process.execPath,
    ["prepare.mjs"],
  ]);
});
