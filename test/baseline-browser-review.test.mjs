import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

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
    'import { build } from "esbuild";',
    'import { ESBUILD_BASELINE_TARGETS } from "../baseline-targets.mjs";',
    'await build({ target: ESBUILD_BASELINE_TARGETS, write: false });',
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

test("the actual guard counts formatted calls and rejects unchecked build options", (t) => {
  const { fixture, run } = fixtureGuard(t);
  const script = join(fixture, "scripts/build.mjs");
  const original = readFileSync(script, "utf8");
  writeFileSync(script, original + '\nawait build ( { platform: "browser", write: false });');
  const omitted = run();
  assert.equal(omitted.status, 1);
  assert.match(omitted.stderr, /esbuild 调用未声明 target/u);
  writeFileSync(script, original + '\nawait build(options);');
  const unknown = run();
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /无法核验的 esbuild 调用/u);
});

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
