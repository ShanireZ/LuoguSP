import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import browserslist from "browserslist";

import { buildBrowser, ESBUILD_BASELINE_TARGETS } from "../baseline-targets.mjs";

const root = resolve(import.meta.dirname, "..");
const [policy, packageJson] = await Promise.all([
  readFile(resolve(root, "baseline.config.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
]);
const require = createRequire(import.meta.url);

const packageJsonForModule = (modulePath) => {
  let directory = dirname(modulePath);
  while (true) {
    const candidate = resolve(directory, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`找不到 ${modulePath} 所属的 package.json`);
    directory = parent;
  }
};

const packageVersion = async (packageJsonPath) =>
  JSON.parse(await readFile(packageJsonPath, "utf8")).version;

const withoutCodeComments = (source) => {
  let output = "";
  let quote = null;
  let index = 0;
  while (index < source.length) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (quote !== null) {
      output += current;
      if (current === "\\") {
        output += next;
        index += 2;
        continue;
      }
      if (current === quote) quote = null;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      output += current;
      index += 1;
      continue;
    }
    if (current === "/" && next === "/") {
      const lineEnd = source.indexOf("\n", index + 2);
      if (lineEnd === -1) break;
      output += "\n";
      index = lineEnd + 1;
      continue;
    }
    if (current === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
};

const moduleExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const isModule = (path) => !extname(path) || moduleExtension.test(path);
const withinRoot = (path) => {
  const location = relative(root, path).replaceAll("\\", "/");
  return !isAbsolute(location) && location !== ".." && !location.startsWith("../");
};
const moduleFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await moduleFiles(absolute)));
    else if (entry.isFile() && moduleExtension.test(entry.name)) files.push(absolute);
  }
  return files;
};

function* commandSegments(command) {
  let words = [];
  for (const [, word] of command.matchAll(/((?:[^\s"'&|;()<>]+|"[^"]*"|'[^']*')+)|[&|;()<>]/g)) {
    if (word !== undefined) {
      words.push(word.replace(/"([^"]*)"|'([^']*)'/g, (_, double, single) => double ?? single));
    } else if (words.length) {
      yield words;
      words = [];
    }
  }
  if (words.length) yield words;
}

const executableName = (token = "") => token.replaceAll("\\", "/").split("/").at(-1)
  .replace(/\.(?:bat|cmd|exe|ps1)$/iu, "").toLowerCase();
const isEsbuild = (command) => /^esbuild(?:@[^/]+)?$/u.test(executableName(command));

const invocation = (words) => {
  const start = words.findIndex((word) => !/^\w+=/u.test(word));
  let args = start === -1 ? [] : words.slice(start);
  if (["npm", "npx", "pnpm", "yarn", "bun", "bunx"].includes(executableName(args[0]))) {
    args = args.slice(1);
    while (args[0]?.startsWith("-") || ["exec", "dlx"].includes(args[0])) args = args.slice(1);
  }
  return args;
};

const nodeOptions = (args) => {
  const conditions = new Set(["node"]);
  const preloads = [];
  let addons = true;
  let requireModule = true;
  let entry;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      entry = args[index + 1];
      break;
    }
    if (arg === "-" || /^(?:-e|-p|--eval|--print)(?:=|$)/u.test(arg)) break;
    if (!arg.startsWith("-")) {
      entry = arg;
      break;
    }
    const option = arg.match(/^(--import|--require|-r|--conditions|-C)(?:=(.*))?$/u);
    if (option) {
      const [, flag, inline] = option;
      const value = inline ?? args[++index];
      if (!value) continue;
      if (flag === "--conditions" || flag === "-C") conditions.add(value);
      else preloads.push([flag === "--import" ? "import" : "require", value]);
    }
    if (arg === "--no-addons") addons = false;
    if (arg === "--no-require-module" || arg === "--no-experimental-require-module")
      requireModule = false;
    if (arg === "--require-module" || arg === "--experimental-require-module") requireModule = true;
  }
  if (addons) conditions.add("node-addons");
  if (requireModule) conditions.add("module-sync");
  return { entry, preloads, conditions: [...conditions].sort() };
};

const nodeEntry = (path) => {
  try {
    // Node's main entry uses the CommonJS file and directory lookup first.
    return require.resolve(resolve(root, path));
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    return null;
  }
};

const existingFile = async (path) => {
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    return null;
  }
};

const packageModuleGraphs = async (scripts) => {
  const graphs = new Map();
  for (const [name, command] of Object.entries(scripts)) {
    for (const words of commandSegments(command)) {
      const [tool, ...args] = invocation(words);
      const { entry, preloads, conditions } = nodeOptions(executableName(tool) === "node" ? args : []);
      const directCli = isEsbuild(tool) || (entry &&
        /(?:^|[/\\])node_modules[/\\](?:\.bin[/\\]|esbuild[/\\]bin[/\\])esbuild(?:\.(?:bat|cmd|exe|ps1))?$/iu.test(entry));
      assert.ok(!directCli, `package.json 的 ${name} 使用了无法核验的 esbuild 命令。请从 baseline-targets.mjs 导入 buildBrowser。`);

      const key = JSON.stringify(conditions);
      if (!graphs.has(key)) graphs.set(key, { conditions, entries: new Set(), aliases: new Set() });
      const graph = graphs.get(key);
      const add = (path) => {
        if (path && withinRoot(path) && isModule(path)) graph.entries.add(path);
      };
      if (entry) add(nodeEntry(entry));
      for (const [mode, specifier] of preloads) {
        if (specifier.startsWith("#")) {
          const literal = JSON.stringify(specifier);
          graph.aliases.add(mode === "import" ? `import ${literal};` : `require(${literal});`);
        } else if (mode === "import" && specifier.startsWith("file:")) {
          add(await existingFile(fileURLToPath(specifier)));
        } else if (isAbsolute(specifier) || /^\.\.?[/\\]/u.test(specifier)) {
          add(mode === "require" ? nodeEntry(specifier) :
            await existingFile(fileURLToPath(new URL(specifier, pathToFileURL(`${root}/`)))));
        }
      }
      // Keep explicit local file arguments, including additional node --test entries.
      for (const word of words) {
        if (word.startsWith("-") || !moduleExtension.test(word)) continue;
        const path = resolve(root, word);
        if (withinRoot(path)) add(await existingFile(path));
      }
    }
  }
  return [...graphs.values()];
};

const importedModuleFiles = async ({ entries, aliases, conditions }) => {
  if (entries.size === 0 && aliases.size === 0) return [];
  const inputs = new Set();
  // Use esbuild's input graph to inspect declared entry points without running them.
  await buildBrowser({
    absWorkingDir: root,
    // Different source extensions can otherwise map to the same output path.
    entryPoints: [...entries].map((path, index) => ({ in: path, out: `entry-${index}` })),
    ...(aliases.size ? { stdin: { contents: [...aliases].join("\n"), resolveDir: root } } : {}),
    bundle: true,
    format: "esm",
    platform: "node",
    // Explicit Node conditions omit esbuild's bundler-only implicit "module" branch.
    conditions,
    loader: { "": "js" },
    packages: "external",
    outdir: "node_modules/.cache/baseline-inputs",
    write: false,
    plugins: [{
      name: "baseline-inputs",
      setup(graph) {
        // File loads expose the physical path separately from any import suffix.
        graph.onLoad({ filter: /.*/, namespace: "file" }, ({ path }) => {
          inputs.add(path);
        });
      },
    }],
  });
  return [...inputs].filter((path) => withinRoot(path) && isModule(path));
};

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

assert.equal(policy.runtime, "browser-tool");
assert.equal(policy.featureTarget, "newly");
assert.equal(policy.buildTarget.strategy, "explicit-browsers");
assert.equal(policy.downstream.enabled, true);
assert.ok(policy.downstream.reason?.trim(), "downstream 必须记录理由");
assert.ok(policy.criticalFallback?.trim(), "criticalFallback 不得为空");
assert.ok(policy.verification?.length > 0, "verification 不得为空");
assert.match(policy.snapshot.approvedAt, /^\d{4}-\d{2}-\d{2}$/u);
const approvedAt = Date.parse(`${policy.snapshot.approvedAt}T00:00:00Z`);
const normalizedApprovedAt = Number.isFinite(approvedAt)
  ? new Date(approvedAt).toISOString().slice(0, 10)
  : "";
const now = new Date();
const todayAt = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
assert.ok(
  Number.isFinite(approvedAt) &&
    normalizedApprovedAt === policy.snapshot.approvedAt &&
    approvedAt <= todayAt &&
    todayAt - approvedAt <= 92 * 24 * 60 * 60 * 1000,
  "Baseline 快照日期无效或已超过季度复核期",
);
const approvedDate = new Date(approvedAt);
const nextQuarterMonth = (Math.floor(approvedDate.getUTCMonth() / 3) + 1) * 3;
const quarterEnd = new Date(Date.UTC(approvedDate.getUTCFullYear(), nextQuarterMonth, 0))
  .toISOString().slice(0, 10);
assert.equal(policy.snapshot.reviewedThrough, quarterEnd, "Baseline 复核必须覆盖快照所在季度的末日");
assert.deepEqual(ESBUILD_BASELINE_TARGETS, policy.buildTarget.targets);

const browserslistPackage = require.resolve("browserslist/package.json");
const browserslistRequire = createRequire(browserslistPackage);
const actualSnapshot = {
  browserslist: await packageVersion(browserslistPackage),
  esbuild: await packageVersion(require.resolve("esbuild/package.json")),
  baselineBrowserMapping: await packageVersion(
    packageJsonForModule(browserslistRequire.resolve("baseline-browser-mapping")),
  ),
  caniuseLite: await packageVersion(
    packageJsonForModule(browserslistRequire.resolve("caniuse-lite")),
  ),
};
for (const key of [
  "browserslist",
  "esbuild",
  "baselineBrowserMapping",
  "caniuseLite",
]) {
  assert.equal(
    actualSnapshot[key],
    policy.snapshot[key],
    `Baseline 数据快照 ${key} 发生变化，必须人工复核`,
  );
}
assert.match(
  packageJson.scripts.check,
  /^pnpm run baseline:check\b/,
  "完整检查必须先执行 Baseline 守卫",
);

const requiredPolicyBrowsers = [
  ...policy.requiredBrowsers,
  ...(policy.downstream.enabled ? policy.downstream.requiredBrowsers : []),
];
assert.equal(policy.policyQuery, "baseline widely available with downstream");
for (const query of [policy.policyQuery, `baseline widely available on ${quarterEnd} with downstream`]) {
  assert.deepEqual(
    targetErrors(query, requiredPolicyBrowsers, policy.approvedPolicyMinimums),
    [],
    `Baseline 查询 ${query} 发生未批准前移或缺失核心引擎`,
  );
}

const targetBrowserNames = {
  chrome: "chrome",
  edge: "edge",
  firefox: "firefox",
  safari: "safari",
  ios: "ios_saf",
};
const coveredBuildBrowsers = new Set();
for (const target of ESBUILD_BASELINE_TARGETS) {
  const match = target.match(/^([a-z]+)(\d+(?:\.\d+)*)$/);
  assert.ok(match, `无法解析 esbuild 目标 ${target}`);
  const browser = targetBrowserNames[match[1]];
  assert.ok(browser, `esbuild 目标 ${target} 没有 Baseline 浏览器映射`);
  assert.ok(!coveredBuildBrowsers.has(browser), `重复声明 esbuild 目标 ${browser}`);
  coveredBuildBrowsers.add(browser);
  const policyMinimum = policy.approvedPolicyMinimums[browser];
  assert.ok(
    compareVersions(match[2], policyMinimum) <= 0,
    `${target} 比批准的 ${browser} ${policyMinimum} 更激进`,
  );
}
for (const browser of Object.values(targetBrowserNames))
  assert.ok(coveredBuildBrowsers.has(browser), `缺少必需的 esbuild 目标 ${browser}`);

const buildConsumers = [];
const targetModule = resolve(root, "baseline-targets.mjs");
const [scripts, declaredGraphs] = await Promise.all([
  moduleFiles(resolve(root, "scripts")),
  packageModuleGraphs(packageJson.scripts),
]);
const importedModules = (await Promise.all(declaredGraphs.map(importedModuleFiles))).flat();
for (const absolute of new Set([...scripts, ...importedModules])) {
  if (absolute === targetModule) continue;
  const source = withoutCodeComments(await readFile(absolute, "utf8"));
  const references = source.match(/\b(?:from\s*|(?:import|require)\s*(?:\(\s*)?)["'\x60]esbuild(?:\/[^"'\x60\n]+)?["'\x60]/g);
  const file = relative(root, absolute).replaceAll("\\", "/");
  assert.ok(
    !references,
    `${file} 使用了无法核验的 esbuild 导入。请从 baseline-targets.mjs 导入 buildBrowser。`,
  );
  let importPath = relative(dirname(absolute), targetModule).replaceAll(
    "\\",
    "/",
  );
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  if (source.includes(`import { buildBrowser } from "${importPath}";`)) buildConsumers.push(file);
}
assert.ok(buildConsumers.length > 0, "未发现任何 esbuild 浏览器构建消费点");

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
  `Baseline 守卫通过：政策复核至 ${quarterEnd}；${buildConsumers.length} 个构建脚本统一使用 ${ESBUILD_BASELINE_TARGETS.join(", ")}`,
);
