import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import browserslist from "browserslist";

import { ESBUILD_BASELINE_TARGETS } from "../baseline-targets.mjs";

const root = resolve(import.meta.dirname, "..");
const [policy, packageJson] = await Promise.all([
  readFile(resolve(root, "baseline.config.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
]);

const versionParts = (value) =>
  value
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));

const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
};

const minimumsFor = (query) => {
  const minimums = new Map();
  for (const target of browserslist(query, { path: root, env: "production" })) {
    const [browser, rawVersion = ""] = target.split(" ");
    const version = rawVersion.split("-")[0];
    if (!browser || !/^\d+(?:\.\d+)*$/.test(version)) continue;
    const current = minimums.get(browser);
    if (!current || compareVersions(version, current) < 0)
      minimums.set(browser, version);
  }
  return minimums;
};

const targetErrors = (query, requiredBrowsers, approvedMinimums) => {
  const minimums = minimumsFor(query);
  const errors = [];
  for (const browser of requiredBrowsers) {
    const actual = minimums.get(browser);
    if (!actual) {
      errors.push(`缺少必需浏览器 ${browser}`);
      continue;
    }
    const approved = approvedMinimums[browser];
    if (!approved) errors.push(`没有记录 ${browser} 的批准最低版本`);
    else if (compareVersions(actual, approved) > 0)
      errors.push(`${browser} 的最低版本从批准的 ${approved} 前移到 ${actual}`);
  }
  return errors;
};

assert.equal(packageJson.devDependencies.browserslist, policy.snapshot.browserslist);
assert.equal(packageJson.devDependencies.esbuild, policy.snapshot.esbuild);
assert.deepEqual(ESBUILD_BASELINE_TARGETS, policy.buildTarget.targets);

const requiredPolicyBrowsers = [
  ...policy.requiredBrowsers,
  ...(policy.downstream.enabled ? policy.downstream.requiredBrowsers : []),
];
assert.deepEqual(
  targetErrors(
    policy.policyQuery,
    requiredPolicyBrowsers,
    policy.approvedPolicyMinimums,
  ),
  [],
  "Baseline Widely with downstream 查询发生未批准前移或缺失核心引擎",
);

const targetBrowserNames = {
  chrome: "chrome",
  edge: "edge",
  firefox: "firefox",
  safari: "safari",
  ios: "ios_saf",
};
for (const target of ESBUILD_BASELINE_TARGETS) {
  const match = target.match(/^([a-z]+)(\d+(?:\.\d+)*)$/);
  assert.ok(match, `无法解析 esbuild 目标 ${target}`);
  const browser = targetBrowserNames[match[1]];
  assert.ok(browser, `esbuild 目标 ${target} 没有 Baseline 浏览器映射`);
  const policyMinimum = policy.approvedPolicyMinimums[browser];
  assert.ok(
    compareVersions(match[2], policyMinimum) <= 0,
    `${target} 比批准的 ${browser} ${policyMinimum} 更激进`,
  );
}

const buildConsumers = [
  ["scripts/build.mjs", "../baseline-targets.mjs"],
  ["scripts/analyze-cdn-chunks.mjs", "../baseline-targets.mjs"],
  ["scripts/cdn/build.mjs", "../../baseline-targets.mjs"],
  ["scripts/cdn/stage-userscript.mjs", "../../baseline-targets.mjs"],
  ["scripts/renderer/build-lib.mjs", "../../baseline-targets.mjs"],
  ["scripts/renderer/check.mjs", "../../baseline-targets.mjs"],
  ["scripts/qa/stage-hidden-intro.mjs", "../../baseline-targets.mjs"],
];
for (const [file, importPath] of buildConsumers) {
  const source = await readFile(resolve(root, file), "utf8");
  assert.ok(
    source.includes(
      `import { ESBUILD_BASELINE_TARGETS } from "${importPath}";`,
    ),
    `${file} 没有消费共享 Baseline 目标`,
  );
  const buildCalls = source.match(/\bbuild\(\{/g)?.length ?? 0;
  const targetUses = source.match(/target:\s*ESBUILD_BASELINE_TARGETS,/g)?.length ?? 0;
  assert.ok(buildCalls > 0, `${file} 不再包含可识别的 esbuild 调用`);
  assert.equal(targetUses, buildCalls, `${file} 有 esbuild 调用未声明 target`);
}

const negativeErrors = targetErrors(
  policy.negativeQuery,
  policy.requiredBrowsers,
  policy.approvedPolicyMinimums,
);
for (const browser of ["firefox", "safari"]) {
  assert.ok(
    negativeErrors.some((error) => error.includes(`缺少必需浏览器 ${browser}`)),
    `反例 ${JSON.stringify(policy.negativeQuery)} 已不再缺少 ${browser}；必须重新审查 Newly 准入`,
  );
}

console.log(
  `Baseline 守卫通过：${buildConsumers.length} 个构建脚本统一使用 ${ESBUILD_BASELINE_TARGETS.join(", ")}`,
);
