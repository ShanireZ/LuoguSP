import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { snapshotRelease } from "../scripts/cdn/release-integrity.mjs";

const digest = (body) => createHash("sha256").update(body).digest("hex");
const release = "1.0.0";
const runtime = "runtime bytes\n";
const runtimePath = `releases/${release}/compat/runtime.abc.js`;

async function createTree(t) {
  const base = await realpath(tmpdir());
  const prefix = "luogusp-release-integrity-20261115-";
  const root = await realpath(await mkdtemp(join(base, prefix)));
  assert.equal(dirname(root), base);
  assert.ok(basename(root).startsWith(prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releases = join(root, "releases");
  const releaseDir = join(releases, release);
  const manifest = {
    schemaVersion: 3,
    release,
    files: {
      [runtimePath]: {
        path: runtimePath,
        bytes: Buffer.byteLength(runtime),
        sha256: digest(runtime),
      },
    },
  };
  const body = JSON.stringify(manifest);
  const hashedPath = join(releaseDir, `manifest.${digest(body).slice(0, 16)}.json`);
  await mkdir(join(releaseDir, "compat"), { recursive: true });
  await Promise.all([
    writeFile(join(root, runtimePath), runtime),
    writeFile(join(releaseDir, "manifest.json"), body),
    writeFile(hashedPath, body),
  ]);
  return {
    asset: join(root, runtimePath),
    hashedPath,
    verify: () => snapshotRelease(releases, release),
  };
}

test("release integrity returns the verified release bytes", async (t) => {
  const tree = await createTree(t);
  const verified = await tree.verify();
  assert.equal(verified.manifest.release, release);
  assert.equal(verified.files.size, 3);
  assert.equal(verified.files.get(runtimePath).toString(), runtime);
  assert.equal(digest(verified.files.get(verified.path)), verified.sha256);
});

test("release integrity rejects a CRLF-expanded checkout and names the cause", async (t) => {
  const tree = await createTree(t);
  await writeFile(tree.asset, runtime.replace("\n", "\r\n"));
  await assert.rejects(tree.verify(), /runtime\.abc\.js: content drifted from the manifest.*CRLF-expanded/);
});

test("release integrity rejects silent content edits without blaming line endings", async (t) => {
  const tree = await createTree(t);
  await writeFile(tree.asset, runtime.toUpperCase());
  await assert.rejects(tree.verify(), (error) => {
    assert.match(error.message, /drifted from the manifest/);
    assert.doesNotMatch(error.message, /CRLF-expanded/);
    return true;
  });
});

test("release integrity rejects a missing pinned file", async (t) => {
  const tree = await createTree(t);
  await rm(tree.asset);
  await assert.rejects(tree.verify(), /pinned file or directory is missing/);
});

test("release integrity rejects copies of a manifest that differ", async (t) => {
  const tree = await createTree(t);
  await writeFile(tree.hashedPath, "{}");
  await assert.rejects(tree.verify(), /manifest.json are not byte-identical/);
});

test("release integrity rejects an incorrect hash in the manifest filename", async (t) => {
  const tree = await createTree(t);
  await rename(tree.hashedPath, join(dirname(tree.hashedPath), "manifest.0000000000000000.json"));
  await assert.rejects(tree.verify(), /does not match the hash in its own filename/);
});
