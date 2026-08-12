import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("CDN staging keeps only the current canary release", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "luogusp-cdn-retention-"),
  );
  const output = path.join(temporaryRoot, "cdn");

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/cdn/prepare.mjs", "--output", output],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const channel = JSON.parse(
      await readFile(path.join(root, "cdn/channels/canary.json"), "utf8"),
    );
    const stagedReleases = await readdir(path.join(output, "releases"));
    const stagedCanaries = stagedReleases.filter((release) =>
      release.includes("-canary."),
    );

    assert.deepEqual(stagedCanaries, [channel.release]);
    assert.equal(stagedReleases.includes("2.13.10"), true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
