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

// ★ 这个函数显式接受 platform 参数，就不能用宿主平台的路径语义来拼结果：
// 在 Linux CI 上 "C:\\node\\node.exe" 不是绝对路径，resolve 会把 cwd 掺进来，
// 于是同一份代码在 Windows 通过、在 CI 失败（2026-08-12 实际发生过）。
// 用纯词法的 win32 join 后，输出只由入参决定，与宿主平台和 cwd 都无关。
test("the Windows npx shim path depends only on its inputs", () => {
  const args = ["-y", "wrangler@4.107.0", "deploy"];

  // POSIX 形态的 node 路径配 win32 平台：宿主是 Windows 时 resolve 会补上盘符，
  // 宿主是 Linux 时又会补上 cwd —— 纯词法拼接则两处都得到同一个结果。
  assert.deepEqual(
    commandInvocation("npx", args, {
      platform: "win32",
      nodeExecutable: "/usr/local/bin/node",
    }),
    [
      "/usr/local/bin/node",
      ["\\usr\\local\\bin\\node_modules\\npm\\bin\\npx-cli.js", ...args],
    ],
  );

  // 非 Windows 平台不做任何路径拼接，直接交给 PATH 里的 npx。
  assert.deepEqual(
    commandInvocation("npx", args, {
      platform: "linux",
      nodeExecutable: "/usr/local/bin/node",
    }),
    ["npx", args],
  );

  // node 与其它命令原样透传。
  assert.deepEqual(
    commandInvocation("node", ["x.mjs"], {
      platform: "win32",
      nodeExecutable: "C:\\node\\node.exe",
    }),
    ["C:\\node\\node.exe", ["x.mjs"]],
  );
  assert.deepEqual(commandInvocation("pnpm", ["install"]), [
    "pnpm",
    ["install"],
  ]);
});
