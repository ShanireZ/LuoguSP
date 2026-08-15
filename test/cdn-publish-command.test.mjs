import test from "node:test";
import assert from "node:assert/strict";
import { commandInvocation } from "../scripts/cdn/command-invocation.mjs";

const COMSPEC = "C:\\Windows\\system32\\cmd.exe";
const win = (args) =>
  commandInvocation(args[0], args.slice(1), {
    platform: "win32",
    comSpec: COMSPEC,
    nodeExecutable: "C:\\node\\node.exe",
  });

// Windows 上 PATH 里的这些入口都是 `.CMD` / `.ps1`，没有 `.exe`：裸 spawn 得
// ENOENT，直接指 `.CMD` 被 Node 20+ 拒绝（EINVAL）。两条都实测过。
// ★ 刻意**不用** `shell: true`：那样要把 args 拼成命令行，既触发 DEP0190，
//   也让带空格的路径不安全；走 ComSpec 则 args 仍是数组。
test("Windows 上的命令行工具一律走 ComSpec，且 args 保持数组", () => {
  assert.deepEqual(win(["wrangler", "deploy", "--config", "a.jsonc"]), [
    COMSPEC,
    ["/d", "/s", "/c", "wrangler", "deploy", "--config", "a.jsonc"],
  ]);
  assert.deepEqual(win(["npm", "ci", "--dry-run"]), [
    COMSPEC,
    ["/d", "/s", "/c", "npm", "ci", "--dry-run"],
  ]);
  assert.deepEqual(win(["edgeone", "makers", "deploy"]), [
    COMSPEC,
    ["/d", "/s", "/c", "edgeone", "makers", "deploy"],
  ]);

  // 带空格的路径必须仍是**独立一个 arg**，不能被拼进命令行字符串。
  const spaced = win(["wrangler", "--config", "a b/c.jsonc"]);
  assert.ok(spaced[1].includes("a b/c.jsonc"));
});

// ★★★ 反证：这条规则替换掉的是「用当前 node 跑 npm 自带的 npm-cli.js」。
//    那套办法 2026-08-15 失效了 —— 本机 Node 改由 pnpm 管理，pnpm 装的 Node
//    **不附带 npm**，`node.EXE` 旁边没有 `node_modules/`，算出来是个不存在的
//    路径。所以这里钉死：结果里**不许**再出现 npm-cli.js / npx-cli.js 那种拼接。
test("不许退回「拼 node_modules/npm/bin/*-cli.js」那套已失效的办法", () => {
  for (const command of ["npm", "npx"]) {
    const [executable, args] = win([command, "--version"]);
    assert.equal(executable, COMSPEC);
    assert.doesNotMatch(args.join(" "), /node_modules|-cli\.js/);
  }
});

// node 自身是真 `.exe`，直接 spawn，不套 ComSpec —— 套了反而丢掉调用方
// 指定的解释器（发布脚本要用**当前**这个 node 跑子脚本）。
test("node 原样透传当前解释器，不套 ComSpec", () => {
  assert.deepEqual(
    commandInvocation("node", ["scripts/cdn/build.mjs"], {
      platform: "win32",
      comSpec: COMSPEC,
      nodeExecutable: "C:\\node\\node.exe",
    }),
    ["C:\\node\\node.exe", ["scripts/cdn/build.mjs"]],
  );
  assert.deepEqual(commandInvocation("node", ["x.mjs"]), [
    process.execPath,
    ["x.mjs"],
  ]);
});

// CI 全在 Linux 上跑：那里这些入口是带 shebang 的可执行脚本，必须零包装 ——
// 一旦这里也套上 ComSpec，CI 会在「cmd.exe 找不到」上整片挂掉。
test("非 Windows 平台零包装", () => {
  for (const command of ["npm", "wrangler", "edgeone"])
    assert.deepEqual(
      commandInvocation(command, ["--version"], { platform: "linux" }),
      [command, ["--version"]],
    );
});
