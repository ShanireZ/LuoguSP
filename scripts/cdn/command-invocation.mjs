// Windows 上除 `node` 以外的命令行工具，一律通過 ComSpec 呼叫。
//
// 起因：這些工具在 PATH 上的入口是 `.CMD` / `.ps1` shim，**沒有 `.exe`**。
// `spawnSync("npm", …, { shell: false })` 得到 ENOENT，直接指 `.CMD` 則被
// Node 20+ 拒絕（EINVAL）。兩條都實測過（2026-08-15）。
//
// ★ 這裡原先對 npm / npx 用的是另一套辦法：拼出 `<node 所在目录>/node_modules/
//   npm/bin/npm-cli.js` 再用當前 node 去跑。**那套辦法在 2026-08-15 失效了** ——
//   本機 Node 改由 pnpm 管理（`pnpm runtime set node -g`），而 pnpm 裝的 Node
//   執行環境**不附帶 npm**，`node.EXE` 旁邊根本沒有 `node_modules/`，算出來的是一個
//   不存在的路徑。npm 現在也是 pnpm 全域裝的 shim，與 wrangler 同一形態。
//   ComSpec 這條路對三種情況都成立（pnpm 全域 shim、官方安裝包的 npm.cmd、
//   以及任何 PATH 上的 .CMD），所以合併成一條規則，不再按工具分叉。
//
// ★ 解法是 `cmd.exe /d /s /c <cmd> <args>` 而**不是** `shell: true`：
//   shell:true 雖然能跑，但要把 args 拼進命令行，既觸發 DEP0190 棄用警告，
//   也讓帶空格的路徑變得不安全；走 ComSpec 則 args 仍是陣列，由 Node 自己做
//   Windows 參數轉義，呼叫方的 `shell: false` 保持不變。
//   /d 跳過 AutoRun 註冊表指令碼，/s 規範引號處理，/c 執行完退出。
//
// 非 Windows 平台上這些入口都是帶 shebang 的可執行指令碼，直接 spawn 即可 ——
// CI 全在 Linux 上跑，那條路徑必須保持零包裝。
export function commandInvocation(
  command,
  args,
  {
    platform = process.platform,
    nodeExecutable = process.execPath,
    comSpec = process.env.ComSpec || "cmd.exe",
  } = {},
) {
  if (command === "node") return [nodeExecutable, args];
  if (platform === "win32")
    return [comSpec, ["/d", "/s", "/c", command, ...args]];
  return [command, args];
}
