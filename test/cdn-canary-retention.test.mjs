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

    // ★★ 规则是「**部署里最多一个 canary，且必须是频道指向的那个**」。
    //    频道指向的**不一定是 canary** —— `build.mjs` 把频道写成「刚构建的那个版本」，
    //    所以转正式版时它就指向 2.14.0 这种稳定版，此时**一个 canary 都不该留**
    //    （旧 canary 本来就该随转正一起下线）。
    //    ★ 这一支是 2.14.0 转正时才第一次跑到的：原断言写死 `[channel.release]`，
    //      在稳定版那一支必红，把发布拦在了预检上 —— 拦得对，只是断言没覆盖到。
    const channelIsCanary = channel.release.includes("-canary.");
    assert.deepEqual(stagedCanaries, channelIsCanary ? [channel.release] : []);
    // 正式版无论如何都要在：老用户的 @require 钉着它们。
    assert.equal(stagedReleases.includes("2.13.10"), true);
    assert.equal(stagedReleases.includes(channel.release), true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
