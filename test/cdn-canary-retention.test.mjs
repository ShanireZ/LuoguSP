import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

async function scratchDirectory(t) {
  const base = await realpath(tmpdir());
  const prefix = "luogusp-cdn-path-20261115-";
  const temporaryRoot = await realpath(await mkdtemp(path.join(base, prefix)));
  assert.equal(path.dirname(temporaryRoot), base);
  assert.ok(path.basename(temporaryRoot).startsWith(prefix));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  return temporaryRoot;
}

function prepare(cwd, output) {
  return spawnSync(
    process.execPath,
    ["scripts/cdn/prepare.mjs", ...(output ? ["--output", output] : [])],
    { cwd, encoding: "utf8" },
  );
}

async function stageFixture(t) {
  const scratch = await scratchDirectory(t);
  const repo = path.join(scratch, "FixtureRepo");
  const release = "1.2.3";
  const source = path.join(repo, "cdn");
  const releases = path.join(source, "releases");
  const artifacts = path.join(releases, release);
  const channels = path.join(source, "channels");
  const scripts = path.join(repo, "scripts", "cdn");
  await Promise.all([artifacts, channels, scripts].map((dir) =>
    mkdir(dir, { recursive: true }),
  ));
  const file = `releases/${release}/pinned.js`;
  const body = "// Immutable staging fixture\n";
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const manifest = JSON.stringify({ files: {
    [file]: { bytes: Buffer.byteLength(body), sha256: digest(body) },
  } });
  await Promise.all([
    ...["prepare.mjs", "release-integrity.mjs"].map((name) =>
      copyFile(path.join(root, "scripts", "cdn", name), path.join(scripts, name)),
    ),
    writeFile(path.join(source, file), body),
    writeFile(path.join(artifacts, "manifest.json"), manifest),
    writeFile(path.join(artifacts, `manifest.${digest(manifest).slice(0, 16)}.json`), manifest),
    writeFile(path.join(channels, "canary.json"), JSON.stringify({ release })),
  ]);
  return { scratch, repo, source, file, body };
}

async function refusesToStage({ repo, source, file, body }, output) {
  const result = prepare(repo, output);
  assert.ifError(result.error);
  assert.equal(await readFile(path.join(source, file), "utf8"), body);
  assert.deepEqual((await readdir(source)).sort(), ["channels", "releases"]);
  assert.notEqual(result.status, 0, `should refuse to stage ${output}`);
  assert.match(result.stderr, /Refusing to replace an unexpected deployment directory/);
}

async function linkDirectory(t, target, link) {
  try {
    await symlink(target, link, isWindows ? "junction" : "dir");
    return true;
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    t.skip(`Creating a directory link is unavailable (${error.code})`);
    return false;
  }
}

test("CDN staging keeps only the current canary release", async (t) => {
  const output = path.join(await scratchDirectory(t), "cdn");

  const result = prepare(root, output);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const channel = JSON.parse(
    await readFile(path.join(root, "cdn/channels/canary.json"), "utf8"),
  );
  const stagedReleases = await readdir(path.join(output, "releases"));
  const stagedCanaries = stagedReleases.filter((release) =>
    release.includes("-canary."),
  );

  const channelIsCanary = channel.release.includes("-canary.");
  assert.deepEqual(stagedCanaries, channelIsCanary ? [channel.release] : []);
  // Existing installs still pin older stable releases.
  assert.equal(stagedReleases.includes("2.13.10"), true);
  assert.equal(stagedReleases.includes(channel.release), true);
});

// Run destructive regression probes only against a disposable source tree.
test("CDN staging refuses to overwrite its source tree", async (t) => {
  const fixture = await stageFixture(t);
  for (const target of ["cdn", fixture.source, "cdn/releases/../"]) {
    await refusesToStage(fixture, target);
  }
});

test("CDN staging rejects a Windows case alias of its source tree", {
  skip: !isWindows,
}, async (t) => {
  const fixture = await stageFixture(t);
  const alias = path.join(fixture.scratch, "fixturerepo", "cdn");
  assert.equal(await realpath(alias), await realpath(fixture.source));
  await refusesToStage(fixture, alias);
});

test("CDN staging rejects an intermediate directory link to its source tree", async (t) => {
  const fixture = await stageFixture(t);
  const alias = path.join(fixture.scratch, "repo-link");
  if (!await linkDirectory(t, fixture.repo, alias)) return;
  await refusesToStage(fixture, path.join(alias, "cdn"));
});

test("CDN staging rejects a missing output nested under a source alias", async (t) => {
  const fixture = await stageFixture(t);
  const alias = path.join(fixture.scratch, "repo-link");
  if (!await linkDirectory(t, fixture.repo, alias)) return;
  await refusesToStage(fixture, path.join(alias, "cdn", "not-yet", "nested", "cdn"));
});

test("CDN staging rejects an output link to a source ancestor", async (t) => {
  const fixture = await stageFixture(t);
  const alias = path.join(fixture.scratch, "cdn");
  if (!await linkDirectory(t, fixture.repo, alias)) return;
  await refusesToStage(fixture, alias);
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
});

test("CDN staging accepts the default and a separate scratch directory", async (t) => {
  const { repo, file, body, scratch } = await stageFixture(t);
  const output = path.join(scratch, "outside", "nested", "cdn");
  for (const target of [undefined, output]) {
    const result = prepare(repo, target);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const stagedFile = path.join(target || path.join(repo, "dist", "cdn"), file);
    assert.equal(await readFile(stagedFile, "utf8"), body);
  }
  await writeFile(path.join(output, "stale"), "left by a previous stage");
  const result = prepare(repo, output);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  await assert.rejects(lstat(path.join(output, "stale")), { code: "ENOENT" });
});
