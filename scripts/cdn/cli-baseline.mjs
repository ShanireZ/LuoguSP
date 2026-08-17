// 发布 CLI 从「npx 钉死某个精确版本」改成「用全局装好的那个」（工作区约定，
// 见根 AGENTS.md）。少了精确 pin，就少了一条保证：这个仓库发布的是**不可变**
// CDN 产物，字节被用户已安装脚本的 `@require #sha256=` 钉死，用一个行为未知的
// wrangler 去传是不能接受的。
// 所以 `config/cdn.json` 的 `cli.wrangler.minimum` 从「精确版本」改判为
// 「**已验证可用的下限**」，发布前实测一次全局版本并做下限断言，低于下限直接失败。
// 这与 DpMaster 的全局模型是同一套思路（基线声明 + 漂移巡检），只是这里因为
// 产物不可变，把巡检换成了发布路径上的硬门。

export function parseCliVersion(output) {
  // wrangler 会先打一堆 banner，版本号在 ` ⛅️ wrangler 4.123.0` 这样的行里；
  // 取**最后**一个 x.y.z，避免 banner 里的其它数字（如 compatibility date）抢先。
  const matches = [...String(output).matchAll(/\b(\d+)\.(\d+)\.(\d+)\b/g)];
  if (!matches.length) return null;
  const [, major, minor, patch] = matches[matches.length - 1];
  return `${major}.${minor}.${patch}`;
}

function ordinal(version) {
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ""));
  if (!parsed) return null;
  return parsed.slice(1, 4).map(Number);
}

// 纯数值比较，不引依赖：这里只可能是三段发布版本号。
export function satisfiesMinimum(actual, minimum) {
  const left = ordinal(actual);
  const right = ordinal(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function assertCliBaseline({ name, output, minimum }) {
  const actual = parseCliVersion(output);
  if (!actual)
    throw new Error(
      `Unable to read the global ${name} version — got: ${String(output)
        .trim()
        .slice(0, 200)}`,
    );
  if (!satisfiesMinimum(actual, minimum))
    throw new Error(
      `The global ${name} is ${actual}, below the verified baseline ${minimum}. ` +
        `Upgrade it (\`pnpm add -g ${name}\`) or lower cli.${name}.minimum in config/cdn.json only after re-verifying a release.`,
    );
  return actual;
}
