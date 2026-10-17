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

    // ★★ 規則是「**部署裡最多一個 canary，且必須是頻道指向的那個**」。
    //    頻道指向的**不一定是 canary** —— `build.mjs` 把頻道寫成「剛建置的那個版本」，
    //    所以轉正式版時它就指向 2.14.0 這種穩定版，此時**一個 canary 都不該留**
    //    （舊 canary 本來就該隨轉正一起下線）。
    //    ★ 這一支是 2.14.0 轉正時才第一次跑到的：原斷言寫死 `[channel.release]`，
    //      在穩定版那一支必紅，把發佈攔在了預檢上 —— 攔得對，只是斷言沒覆蓋到。
    const channelIsCanary = channel.release.includes("-canary.");
    assert.deepEqual(stagedCanaries, channelIsCanary ? [channel.release] : []);
    // 正式版無論如何都要在：老使用者的 @require 釘著它們。
    assert.equal(stagedReleases.includes("2.13.10"), true);
    assert.equal(stagedReleases.includes(channel.release), true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

// ★★ 緊接著守衛的下一行就是 `rm(output, { recursive: true, force: true })`，
//    而**源目錄也叫 `cdn`**。顯式 `--output` 此前唯一的判據是 `basename === "cdn"`，
//    於是 `--output cdn` 會把 `cdn/releases` 整個刪掉 —— 那正是這個指令碼
//    存在的全部理由（那批位元組被使用者已安裝指令碼的 `@require #sha256=` 釘死）。
test("CDN staging refuses to overwrite the repository's own cdn/ source tree", async () => {
  const before = await readdir(path.join(root, "cdn/releases"));
  for (const target of ["cdn", path.join(root, "cdn"), "cdn/releases/../"]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/cdn/prepare.mjs", "--output", target],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(
      result.status,
      0,
      `--output ${target} 必须被挡下，否则会删掉不可变发布产物`,
    );
    assert.match(
      `${result.stdout}${result.stderr}`,
      /Refusing to replace an unexpected deployment directory/,
    );
  }
  assert.deepEqual(
    await readdir(path.join(root, "cdn/releases")),
    before,
    "cdn/releases 必须一个都没少",
  );
});
