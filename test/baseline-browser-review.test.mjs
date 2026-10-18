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

test("the approved Firefox minimum passes the actual complete Baseline guard", () => {
  const result = spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Baseline 守卫通过/u);
});

for (const [browser, staleMinimum] of [["firefox", 124], ["chrome", 123], ["edge", 123]]) {
  test(`the actual guard rejects stale ${browser} minimum ${staleMinimum}`, () => {
    const cache = join(ROOT, "node_modules", ".cache");
    mkdirSync(cache, { recursive: true });
    // 相依解析沿父目錄使用原本的鎖定套件，副本不修改任何專案原始檔。
    const fixture = mkdtempSync(join(cache, "luogusp-baseline-review-"));
    try {
      const original = readFileSync(join(ROOT, "baseline.config.json"), "utf8");
      const stale = original.replace(new RegExp(`"${browser}":\\s*"\\d+"`, "u"), `"${browser}": "${staleMinimum}"`);
      assert.notEqual(stale, original);
      writeFileSync(join(fixture, "baseline.config.json"), stale);
      copyFileSync(join(ROOT, "package.json"), join(fixture, "package.json"));
      copyFileSync(join(ROOT, "baseline-targets.mjs"), join(fixture, "baseline-targets.mjs"));
      mkdirSync(join(fixture, "scripts"));
      const fixtureChecker = join(fixture, "scripts", "check-baseline.mjs");
      copyFileSync(CHECKER, fixtureChecker);
      const result = spawnSync(process.execPath, [fixtureChecker], {
        cwd: fixture,
        encoding: "utf8",
        timeout: 20_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`${browser} 的最低版本从批准的 ${staleMinimum} 前移到 \\d+`, "u"));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
