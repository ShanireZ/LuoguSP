// Windows 上除 `node` 以外的命令行工具，一律通过 ComSpec 调用。
//
// 起因：这些工具在 PATH 上的入口是 `.CMD` / `.ps1` shim，**没有 `.exe`**。
// `spawnSync("npm", …, { shell: false })` 得到 ENOENT，直接指 `.CMD` 则被
// Node 20+ 拒绝（EINVAL）。两条都实测过（2026-08-15）。
//
// ★ 这里原先对 npm / npx 用的是另一套办法：拼出 `<node 所在目录>/node_modules/
//   npm/bin/npm-cli.js` 再用当前 node 去跑。**那套办法在 2026-08-15 失效了** ——
//   本机 Node 改由 pnpm 管理（`pnpm runtime set node -g`），而 pnpm 装的 Node
//   运行时**不附带 npm**，`node.EXE` 旁边根本没有 `node_modules/`，算出来的是一个
//   不存在的路径。npm 现在也是 pnpm 全局装的 shim，与 wrangler 同一形态。
//   ComSpec 这条路对三种情况都成立（pnpm 全局 shim、官方安装包的 npm.cmd、
//   以及任何 PATH 上的 .CMD），所以合并成一条规则，不再按工具分叉。
//
// ★ 解法是 `cmd.exe /d /s /c <cmd> <args>` 而**不是** `shell: true`：
//   shell:true 虽然能跑，但要把 args 拼进命令行，既触发 DEP0190 弃用警告，
//   也让带空格的路径变得不安全；走 ComSpec 则 args 仍是数组，由 Node 自己做
//   Windows 参数转义，调用方的 `shell: false` 保持不变。
//   /d 跳过 AutoRun 注册表脚本，/s 规范引号处理，/c 执行完退出。
//
// 非 Windows 平台上这些入口都是带 shebang 的可执行脚本，直接 spawn 即可 ——
// CI 全在 Linux 上跑，那条路径必须保持零包装。
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
