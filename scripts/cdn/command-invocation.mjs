import { dirname, resolve } from "node:path";

export function commandInvocation(
  command,
  args,
  { platform = process.platform, nodeExecutable = process.execPath } = {},
) {
  if (command === "node") return [nodeExecutable, args];
  if (command === "npx" && platform === "win32")
    return [
      nodeExecutable,
      [
        resolve(dirname(nodeExecutable), "node_modules/npm/bin/npx-cli.js"),
        ...args,
      ],
    ];
  if (command === "npx") return ["npx", args];
  return [command, args];
}
