import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { buildBrowser, ESBUILD_BASELINE_TARGETS } from "../baseline-targets.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const CHECKER = join(ROOT, "scripts/check-baseline.mjs");

function fixtureGuard(t) {
  // Resolve the locked dependencies through the parent directory.
  const cache = join(ROOT, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const fixture = mkdtempSync(join(cache, "luogusp-baseline-review-20261118-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const name of ["package.json", "baseline.config.json", "baseline-targets.mjs"])
    copyFileSync(join(ROOT, name), join(fixture, name));
  mkdirSync(join(fixture, "scripts"));
  const checker = join(fixture, "scripts/check-baseline.mjs");
  copyFileSync(CHECKER, checker);
  writeFileSync(join(fixture, "scripts/build.mjs"), [
    'import { buildBrowser } from "../baseline-targets.mjs";',
    'await buildBrowser({ write: false });',
  ].join("\n"));
  const run = () => {
    const result = spawnSync(process.execPath, [checker], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(result.error, undefined);
    return result;
  };
  return { fixture, run };
}

test("the approved browser policy passes the current and quarter-end Baseline guard", () => {
  const result = spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Baseline 守卫通过/u);
  const { snapshot } = JSON.parse(readFileSync(join(ROOT, "baseline.config.json"), "utf8"));
  assert.ok(result.stdout.includes(snapshot.reviewedThrough));
});

test("the actual guard rejects iOS missing from both frozen target lists", (t) => {
  const { fixture, run } = fixtureGuard(t);
  assert.equal(run().status, 0);
  const policyPath = join(fixture, "baseline.config.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.buildTarget.targets = policy.buildTarget.targets.filter((target) => target !== "ios16.4");
  writeFileSync(policyPath, JSON.stringify(policy));
  const targetPath = join(fixture, "baseline-targets.mjs");
  writeFileSync(targetPath, readFileSync(targetPath, "utf8").replace(/^  "ios16\.4",\r?\n/m, ""));
  const result = run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /缺少必需的 esbuild 目标 ios_saf/u);
});

test("the actual guard rejects untracked esbuild import forms even alongside a valid consumer", (t) => {
  const { fixture, run } = fixtureGuard(t);
  assert.equal(run().status, 0);
  for (const [file, source] of [
    ["alias.mjs", 'import { build as bundle } from "esbuild";\nawait bundle({ platform: "browser" });'],
    ["namespace.js", 'import * as compiler from "esbuild";\nawait compiler.build({ platform: "browser" });'],
    ["commonjs.cjs", 'const compiler = require("esbuild");\ncompiler.build({ platform: "browser" });'],
    ["dynamic.mjs", 'const compiler = await import("esbuild");\nawait compiler.build({ platform: "browser" });'],
    ["template-import.mjs", 'const compiler = await import(`esbuild`);\nawait compiler.build({ platform: "browser" });'],
  ]) {
    const path = join(fixture, "scripts", file);
    writeFileSync(path, source);
    const result = run();
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /无法核验的 esbuild 导入/u);
    assert.ok(result.stderr.includes(file));
    rmSync(path);
  }
});

test("the shared build function binds the target for direct and callback builds", async () => {
  const options = { stdin: { contents: "globalThis.fixture = /[a&&b]/v;" }, write: false };
  const [expected, untargeted, direct, [callback]] = await Promise.all([
    build({ ...options, target: ESBUILD_BASELINE_TARGETS }),
    build(options),
    buildBrowser({ ...options, target: "esnext" }),
    Promise.all([options].map(buildBrowser)),
  ]);
  const expectedScript = expected.outputFiles[0].text;
  assert.notEqual(untargeted.outputFiles[0].text, expectedScript);
  assert.equal(direct.outputFiles[0].text, expectedScript);
  assert.equal(callback.outputFiles[0].text, expectedScript);
});

test("the actual guard rejects a direct esbuild callback alongside a targeted call", (t) => {
  const { fixture, run } = fixtureGuard(t);
  const script = join(fixture, "scripts/build.mjs");
  writeFileSync(script, [
    'import { build } from "esbuild";',
    'import { ESBUILD_BASELINE_TARGETS } from "../baseline-targets.mjs";',
    'await build({ target: ESBUILD_BASELINE_TARGETS, write: false });',
    'const browserBuilds = [{ platform: "browser", write: false }];',
    'await Promise.all(browserBuilds.map(build));',
  ].join("\n"));
  const result = run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /无法核验的 esbuild/u);
});

test("the actual guard checks package-declared build entries outside scripts", (t) => {
  const { fixture, run } = fixtureGuard(t);
  const packagePath = join(fixture, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const entry = "browser builds/bundle.mjs";
  packageJson.scripts.build = 'node --no-warnings "./browser builds/bundle.mjs"';
  writeFileSync(packagePath, JSON.stringify(packageJson));
  mkdirSync(join(fixture, "browser builds"));
  const buildPath = join(fixture, entry);
  writeFileSync(buildPath, 'import { build } from "esbuild";\nawait build({ platform: "browser", write: false });');
  const direct = run();
  assert.equal(direct.status, 1, direct.stdout);
  assert.match(direct.stderr, /无法核验的 esbuild 导入/u);
  assert.ok(direct.stderr.includes(entry));
  writeFileSync(buildPath, 'import { buildBrowser } from "../baseline-targets.mjs";\nawait buildBrowser({ write: false });');
  const shared = run();
  assert.equal(shared.status, 0, shared.stderr);
  assert.match(shared.stdout, /2 个构建脚本/u);
});

function checkDeclaredHelper(t, suffix) {
  const { fixture, run } = fixtureGuard(t);
  const packagePath = join(fixture, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.scripts.build = 'node "./browser builds/bundle.mjs" --fixture-build';
  writeFileSync(packagePath, JSON.stringify(packageJson));
  const directory = join(fixture, "browser builds");
  mkdirSync(directory);
  const entry = join(directory, "bundle.mjs");
  const helper = join(directory, "helper.mjs");
  writeFileSync(entry, [
    'if (!process.argv.includes("--fixture-build")) throw new Error("Unexpected build execution");',
    'const { bundle } = await import("./bridge.mjs");',
    'const result = await bundle();',
    'process.stdout.write(result.outputFiles[0].text);',
  ].join("\n"));
  writeFileSync(join(directory, "bridge.mjs"), `export { bundle } from "./helper.mjs${suffix}";`);

  const options = '{ stdin: { contents: "globalThis.fixture = /[a&&b]/v;" }, write: false }';
  const runBuild = () => {
    const result = spawnSync(process.execPath, [entry, "--fixture-build"], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  writeFileSync(helper, [
    'import { build } from "esbuild";',
    `export const bundle = () => build(${options});`,
  ].join("\n"));
  assert.match(runBuild(), /\/\[a&&b\]\/v/u);
  const direct = run();
  assert.equal(direct.status, 1, direct.stdout);
  assert.match(direct.stderr, /browser builds\/helper\.mjs.*无法核验的 esbuild 导入/u);

  writeFileSync(helper, [
    'import { buildBrowser } from "../baseline-targets.mjs";',
    `export const bundle = () => buildBrowser(${options});`,
  ].join("\n"));
  const shared = run();
  assert.equal(shared.status, 0, shared.stderr);
  assert.match(shared.stdout, /2 个构建脚本/u);
  assert.doesNotMatch(runBuild(), /\/\[a&&b\]\/v/u);
}

test("the actual guard checks local helpers reached from declared build entries", (t) => {
  checkDeclaredHelper(t, "");
});

test("the actual guard checks local helpers imported with a query", (t) => {
  checkDeclaredHelper(t, "?mode=browser");
});

test("the actual guard checks both same-stem entries and their local helpers without writing output", (t) => {
  const { fixture, run } = fixtureGuard(t);
  const packagePath = join(fixture, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.scripts.build = "node ./browser/dual.mjs && node ./browser/dual.cjs";
  writeFileSync(packagePath, JSON.stringify(packageJson));
  mkdirSync(join(fixture, "browser"));
  writeFileSync(join(fixture, "browser/dual.mjs"), 'import "./esm-helper.mjs";');
  writeFileSync(join(fixture, "browser/dual.cjs"), 'require("./cjs-helper.cjs");');
  const helpers = [
    ["browser/esm-helper.mjs", 'import { build } from "esbuild";'],
    ["browser/cjs-helper.cjs", 'const { build } = require("esbuild");'],
  ];
  for (const [file] of helpers) writeFileSync(join(fixture, file), "");

  const shared = run();
  assert.equal(shared.status, 0, shared.stderr);
  assert.match(shared.stdout, /1 个构建脚本/u);

  for (const [file, directImport] of helpers) {
    const helper = join(fixture, file);
    writeFileSync(helper, directImport);
    const direct = run();
    assert.equal(direct.status, 1, direct.stdout);
    assert.match(direct.stderr, /无法核验的 esbuild 导入/u);
    assert.ok(direct.stderr.includes(file));
    writeFileSync(helper, "");
  }
  assert.equal(existsSync(join(fixture, "node_modules")), false);
});

function declareFixtureBuild(fixture, command, imports) {
  const path = join(fixture, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.scripts.build = command;
  if (imports) manifest.imports = imports;
  writeFileSync(path, JSON.stringify(manifest));
}

const buildCall = 'build({ stdin: { contents: "fixture()" }, write: false }).then(({ outputFiles }) => process.stdout.write(outputFiles[0].text));';
const directBuild = `import { build } from "esbuild";\n${buildCall}`;
const sharedBuild = `import { buildBrowser } from "../baseline-targets.mjs";\n${buildCall.replace("build(", "buildBrowser(")}`;

function runFixtureBuild(fixture, args) {
  const result = spawnSync(process.execPath, args, { cwd: fixture, encoding: "utf8", timeout: 20_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture\(\)/u);
}

for (const [name, command, args, builder, directory = "browser builds"] of [
  ["directory entry", 'node --no-warnings "./browser builds"', ["--no-warnings", "./browser builds"], "index.js"],
  ["omitted extension", 'node "./browser builds/bundle"', ["./browser builds/bundle"], "bundle.js"],
  ["extensionless file", 'node "./browser builds/bundle"', ["./browser builds/bundle"], "bundle"],
  ["extensionless file after a boolean option", 'node --no-warnings "./browser builds/bundle"', ["--no-warnings", "./browser builds/bundle"], "bundle"],
  ["extensionless file after a separate warning option value", 'node --disable-warning DEP0005 "./browser builds/bundle"', ["--disable-warning", "DEP0005", "./browser builds/bundle"], "bundle"],
  ["extensionless file after an inline warning option value", 'node --disable-warning=DEP0005 "./browser builds/bundle"', ["--disable-warning=DEP0005", "./browser builds/bundle"], "bundle"],
  ["extensionless file after two separate option values", 'node --title baseline --disable-warning DEP0005 "./browser builds/bundle"', ["--title", "baseline", "--disable-warning", "DEP0005", "./browser builds/bundle"], "bundle"],
  ["ESM preload", "node --import=./browser/preload.mjs ./main.mjs", ["--import=./browser/preload.mjs", "./main.mjs"], "preload.mjs", "browser"],
  ["quoted ESM preload", 'node --import="./browser builds/preload.mjs" ./main.mjs', ["--import=./browser builds/preload.mjs", "./main.mjs"], "preload.mjs"],
  ["CommonJS preload", 'node -r "./browser builds" ./main.mjs', ["-r", "./browser builds", "./main.mjs"], "index.js"],
]) {
  test(`the actual guard checks a Node ${name} outside scripts without executing it`, (t) => {
    const { fixture, run } = fixtureGuard(t);
    declareFixtureBuild(fixture, command);
    mkdirSync(join(fixture, directory));
    writeFileSync(join(fixture, "main.mjs"), "");
    const path = join(fixture, directory, builder);
    writeFileSync(path, directBuild);
    runFixtureBuild(fixture, args);

    const direct = run();
    assert.equal(direct.status, 1, direct.stdout);
    assert.match(direct.stderr, /无法核验的 esbuild 导入/u);
    assert.ok(direct.stderr.includes(`${directory}/${builder}`));
    assert.doesNotMatch(direct.stdout, /fixture\(\)/u);

    writeFileSync(path, sharedBuild);
    const shared = run();
    assert.equal(shared.status, 0, shared.stderr);
    assert.match(shared.stdout, /2 个构建脚本/u);
    assert.doesNotMatch(shared.stdout, /fixture\(\)/u);
    assert.equal(existsSync(join(fixture, "node_modules")), false);
  });
}

for (const [form, entrySource, extension = "mjs"] of [
  ["static file URL", (helper) => `import ${JSON.stringify(pathToFileURL(helper).href)};`],
  ["dynamic file URL with a query and fragment", (helper) => `await import(${JSON.stringify(pathToFileURL(helper).href + "?mode=browser#fixture")});`],
  ["Node createRequire with a local path", () => [
    'import { createRequire as requireFrom } from "node:module";',
    'const load = requireFrom(import.meta.url);',
    'load("./builder.mjs");',
  ].join("\n")],
  ["Node createRequire from a CommonJS namespace", () => [
    'const nodeModule = require("node:module");',
    'const load = nodeModule.createRequire(__filename);',
    'const example = \'load("./unreachable.mjs");\';',
    'load("./builder.mjs");',
  ].join("\n"), "cjs"],
]) {
  test(`the actual guard checks a helper reached through a ${form}`, (t) => {
    const { fixture, run } = fixtureGuard(t);
    declareFixtureBuild(fixture, `node "./browser builds/entry.${extension}" --fixture-build`);
    mkdirSync(join(fixture, "browser builds"));
    const entry = join(fixture, `browser builds/entry.${extension}`);
    const helper = join(fixture, "browser builds/builder.mjs");
    writeFileSync(entry, [
      'if (!process.argv.includes("--fixture-build")) throw new Error("Unexpected build execution");',
      entrySource(helper),
    ].join("\n"));
    writeFileSync(join(fixture, "browser builds/unreachable.mjs"), directBuild);
    writeFileSync(helper, directBuild);
    runFixtureBuild(fixture, [entry, "--fixture-build"]);
    const direct = run();
    assert.equal(direct.status, 1, direct.stderr || direct.stdout);
    assert.match(direct.stderr, /browser builds\/builder\.mjs.*无法核验的 esbuild 导入/u);
    assert.doesNotMatch(direct.stdout, /fixture\(\)/u);

    writeFileSync(helper, sharedBuild);
    const shared = run();
    assert.equal(shared.status, 0, shared.stderr);
    assert.match(shared.stdout, /2 个构建脚本/u);
    assert.doesNotMatch(shared.stdout, /fixture\(\)/u);
    assert.equal(existsSync(join(fixture, "node_modules")), false);
  });
}

test("the actual guard rejects direct esbuild CLI commands", (t) => {
  const { fixture, run } = fixtureGuard(t);
  writeFileSync(join(fixture, "input.js"), "fixture()");
  const args = ["./input.js", "--bundle", "--platform=browser"];
  runFixtureBuild(fixture, [join(ROOT, "node_modules/esbuild/bin/esbuild"), ...args]);
  for (const executable of ["esbuild", "pnpm exec esbuild", '"./node_modules/.bin/esbuild.cmd"']) {
    declareFixtureBuild(fixture, `${executable} ${args.join(" ")}`);
    const result = run();
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /无法核验的 esbuild 命令/u);
    assert.doesNotMatch(result.stdout, /fixture\(\)/u);
  }
});

for (const [condition, flags, preload = false] of [
  ["node-addons", []],
  ["default", ["--no-addons"]],
  ["default", ["--no-addons", "--no-require-module"]],
  ["module-sync", []],
  ["fixture", ["--conditions=fixture"]],
  ["fixture", ["-C", "fixture"], true],
]) {
  const mode = preload ? "from a preload" : flags.length ? `with ${flags.join(" ")}` : "by default";
  test(`the actual guard checks Node's ${condition} package imports branch ${mode}`, (t) => {
    const { fixture, run } = fixtureGuard(t);
    const args = [...flags, ...(preload ? ["--import=#browser-builder"] : []), "./browser/entry.mjs"];
    const imports = {
      module: "./browser/wrapper.mjs",
      ...(condition === "default" ? { "node-addons": "./browser/wrapper.mjs" } : {}),
      ...(flags.includes("--no-require-module") ? { "module-sync": "./browser/wrapper.mjs" } : {}),
      [condition]: "./browser/builder.mjs",
      ...(condition === "default" ? {} : { default: "./browser/wrapper.mjs" }),
    };
    declareFixtureBuild(fixture, `node ${args.join(" ")}`, { "#browser-builder": imports });
    mkdirSync(join(fixture, "browser"));
    writeFileSync(join(fixture, "browser/entry.mjs"), preload ? "" : 'import "#browser-builder";');
    writeFileSync(join(fixture, "browser/wrapper.mjs"), sharedBuild);
    const path = join(fixture, "browser/builder.mjs");
    writeFileSync(path, directBuild);
    runFixtureBuild(fixture, args);

    const direct = run();
    assert.equal(direct.status, 1, direct.stdout);
    assert.match(direct.stderr, /browser\/builder\.mjs.*无法核验的 esbuild 导入/u);
    assert.doesNotMatch(direct.stdout, /fixture\(\)/u);

    writeFileSync(path, sharedBuild);
    const shared = run();
    assert.equal(shared.status, 0, shared.stderr);
    assert.doesNotMatch(shared.stdout, /fixture\(\)/u);
  });
}

for (const [browser, staleMinimum] of [
  ["firefox", "124"],
  ["chrome", "123"],
  ["chrome", "124"],
  ["edge", "123"],
  ["firefox", "125"],
  ["firefox", "126"],
  ["safari", "17.4"],
  ["ios_saf", "17.4"],
]) {
  test(`the actual guard rejects stale ${browser} minimum ${staleMinimum}`, (t) => {
    const { fixture, run } = fixtureGuard(t);
    const policyPath = join(fixture, "baseline.config.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.approvedPolicyMinimums[browser] = staleMinimum;
    writeFileSync(policyPath, JSON.stringify(policy));
    const result = run();
    assert.equal(result.status, 1);
    const stalePattern = staleMinimum.replaceAll(".", "\\.");
    assert.match(
      result.stderr,
      new RegExp(`${browser} 的最低版本从批准的 ${stalePattern} 前移到 \\d+(?:\\.\\d+)?`, "u"),
    );
  });
}
