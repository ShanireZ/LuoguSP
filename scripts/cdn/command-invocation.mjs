import path from "node:path";

// pnpm 在 Windows 上会把 npx 解析成 .cmd shim，spawnSync 不带 shell 时跑不起来，
// 所以直接用当前 node 去执行 npm 自带的 npx-cli.js。
// ★ 路径拼接必须用调用方声明的 platform 的语义，而且要用纯词法的 join：
//   用宿主平台的 resolve 会让结果依赖宿主平台和 process.cwd()，
//   同一份代码就会在 Windows 通过、在 Linux CI 上失败（2026-08-12 实际发生过）。
export function commandInvocation(
  command,
  args,
  { platform = process.platform, nodeExecutable = process.execPath } = {},
) {
  if (command === "node") return [nodeExecutable, args];
  if (command === "npx" && platform === "win32") {
    const windows = path.win32;
    return [
      nodeExecutable,
      [
        windows.join(
          windows.dirname(nodeExecutable),
          "node_modules",
          "npm",
          "bin",
          "npx-cli.js",
        ),
        ...args,
      ],
    ];
  }
  if (command === "npx") return ["npx", args];
  return [command, args];
}
