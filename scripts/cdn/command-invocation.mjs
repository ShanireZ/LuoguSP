import path from "node:path";

// pnpm 在 Windows 上会把 npx / npm 解析成 .cmd shim，spawnSync 不带 shell 时跑不起来
//（Node 20 起更是直接拒绝不带 shell 地 spawn .cmd），
// 所以直接用当前 node 去执行 npm 自带的 npx-cli.js / npm-cli.js。
// ★ 路径拼接必须用调用方声明的 platform 的语义，而且要用纯词法的 join：
//   用宿主平台的 resolve 会让结果依赖宿主平台和 process.cwd()，
//   同一份代码就会在 Windows 通过、在 Linux CI 上失败（2026-08-12 实际发生过）。
const WINDOWS_CLI_SHIMS = {
  npx: "npx-cli.js",
  npm: "npm-cli.js",
};

// 发布 CLI 按工作区约定**全局安装**（见根 AGENTS.md「全局发布 CLI」），从 PATH 解析。
// 但 pnpm 全局装出来的只有 `wrangler.CMD` / `wrangler.ps1`，**没有 .exe**：
// `spawnSync("wrangler", …, { shell: false })` 得到 ENOENT，直接指 `.CMD` 则
// 被 Node 20+ 拒绝（EINVAL）。两条都实测过（2026-08-15）。
// ★ 解法是 `cmd.exe /d /s /c wrangler <args>` 而**不是** `shell: true`：
//   shell:true 虽然能跑，但要把 args 拼进命令行，既触发 DEP0190 弃用警告，
//   也让带空格的路径变得不安全；走 ComSpec 则 args 仍是数组，由 Node 自己做
//   Windows 参数转义，`shell: false` 保持不变。
//   /d 跳过 AutoRun 注册表脚本，/s 规范引号处理，/c 执行完退出。
const GLOBAL_PATH_CLIS = new Set(["wrangler", "edgeone"]);

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
  if (GLOBAL_PATH_CLIS.has(command) && platform === "win32")
    return [comSpec, ["/d", "/s", "/c", command, ...args]];
  const shim = WINDOWS_CLI_SHIMS[command];
  if (shim && platform === "win32") {
    const windows = path.win32;
    return [
      nodeExecutable,
      [
        windows.join(
          windows.dirname(nodeExecutable),
          "node_modules",
          "npm",
          "bin",
          shim,
        ),
        ...args,
      ],
    ];
  }
  if (shim) return [command, args];
  return [command, args];
}
