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

// Windows 上 PATH 裡的這些入口都是 `.CMD` / `.ps1`，沒有 `.exe`：裸 spawn 得
// ENOENT，直接指 `.CMD` 被 Node 20+ 拒絕（EINVAL）。兩條都實測過。
// ★ 刻意**不用** `shell: true`：那樣要把 args 拼成命令行，既觸發 DEP0190，
//   也讓帶空格的路徑不安全；走 ComSpec 則 args 仍是陣列。
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

  // 帶空格的路徑必須仍是**獨立一個 arg**，不能被拼進命令行字串。
  const spaced = win(["wrangler", "--config", "a b/c.jsonc"]);
  assert.ok(spaced[1].includes("a b/c.jsonc"));
});

// ★★★ 反證：這條規則替換掉的是「用當前 node 跑 npm 自帶的 npm-cli.js」。
//    那套辦法 2026-08-15 失效了 —— 本機 Node 改由 pnpm 管理，pnpm 裝的 Node
//    **不附帶 npm**，`node.EXE` 旁邊沒有 `node_modules/`，算出來是個不存在的
//    路徑。所以這裡釘死：結果裡**不許**再出現 npm-cli.js / npx-cli.js 那種拼接。
test("不许退回「拼 node_modules/npm/bin/*-cli.js」那套已失效的办法", () => {
  for (const command of ["npm", "npx"]) {
    const [executable, args] = win([command, "--version"]);
    assert.equal(executable, COMSPEC);
    assert.doesNotMatch(args.join(" "), /node_modules|-cli\.js/);
  }
});

// node 自身是真 `.exe`，直接 spawn，不套 ComSpec —— 套了反而丟掉呼叫方
// 指定的解釋器（發佈指令碼要用**當前**這個 node 跑子指令碼）。
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

// CI 全在 Linux 上跑：那裡這些入口是帶 shebang 的可執行指令碼，必須零包裝 ——
// 一旦這裡也套上 ComSpec，CI 會在「cmd.exe 找不到」上整片掛掉。
test("非 Windows 平台零包装", () => {
  for (const command of ["npm", "wrangler", "edgeone"])
    assert.deepEqual(
      commandInvocation(command, ["--version"], { platform: "linux" }),
      [command, ["--version"]],
    );
});
