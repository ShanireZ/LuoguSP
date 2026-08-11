import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  collectReleaseIntegrityProblems,
  releaseIntegrityError,
} from "../scripts/cdn/release-integrity.mjs";

const digest = (body) => createHash("sha256").update(body).digest("hex");
const join = (...parts) => parts.join("/").replace(/\/releases\/\.\.\//, "/");

function createTree({ runtime = "runtime bytes\n" } = {}) {
  const runtimeBody = Buffer.from(runtime);
  const runtimePath = "releases/1.0.0/compat/runtime.abc.js";
  const manifest = {
    schemaVersion: 3,
    release: "1.0.0",
    files: {
      [runtimePath]: {
        path: runtimePath,
        bytes: Buffer.byteLength("runtime bytes\n"),
        sha256: digest(Buffer.from("runtime bytes\n")),
      },
    },
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest));
  const hashedName = `manifest.${digest(manifestBody).slice(0, 16)}.json`;
  const files = new Map([
    ["cdn/releases/1.0.0/manifest.json", manifestBody],
    [`cdn/releases/1.0.0/${hashedName}`, manifestBody],
    [`cdn/${runtimePath}`, runtimeBody],
  ]);
  return {
    files,
    hashedName,
    options: {
      releasesDir: "cdn/releases",
      readdir: async (path) =>
        path === "cdn/releases"
          ? ["1.0.0"]
          : ["manifest.json", hashedName, "compat"],
      readFile: async (path) => {
        const body = files.get(path);
        if (!body) throw new Error(`ENOENT ${path}`);
        return body;
      },
      digest,
      join,
    },
  };
}

test("release integrity accepts a tree whose bytes match every pinned hash", async () => {
  const tree = createTree();
  assert.deepEqual(await collectReleaseIntegrityProblems(tree.options), []);
});

test("release integrity rejects a CRLF-expanded checkout and names the cause", async () => {
  const tree = createTree({ runtime: "runtime bytes\r\n" });
  const problems = await collectReleaseIntegrityProblems(tree.options);

  assert.equal(problems.length, 1);
  assert.equal(problems[0].path, "releases/1.0.0/compat/runtime.abc.js");
  assert.match(problems[0].reason, /drifted from the manifest/);
  assert.match(problems[0].hint, /CRLF-expanded/);
  assert.match(
    releaseIntegrityError(problems).message,
    /Refusing to deploy: 1 CDN artifact/,
  );
});

test("release integrity rejects silent content edits without blaming line endings", async () => {
  const tree = createTree({ runtime: "tampered!!!!!\n" });
  const problems = await collectReleaseIntegrityProblems(tree.options);

  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /drifted from the manifest/);
  assert.equal(problems[0].hint, null);
});

test("release integrity rejects a missing pinned file", async () => {
  const tree = createTree();
  tree.files.delete("cdn/releases/1.0.0/compat/runtime.abc.js");
  const problems = await collectReleaseIntegrityProblems(tree.options);

  assert.deepEqual(
    problems.map((problem) => problem.reason),
    ["pinned file is missing"],
  );
});

test("release integrity rejects a hashed manifest that no longer matches its filename", async () => {
  const tree = createTree();
  tree.files.set(
    `cdn/releases/1.0.0/${tree.hashedName}`,
    Buffer.from('{"schemaVersion":3,"release":"1.0.0","files":{}}'),
  );
  const problems = await collectReleaseIntegrityProblems(tree.options);

  assert.deepEqual(
    problems.map((problem) => problem.reason).sort(),
    [
      "content does not match the hash in its own filename",
      "hashed manifest and manifest.json are not byte-identical",
    ],
  );
});

test("release integrity refuses an empty release tree", async () => {
  const tree = createTree();
  const problems = await collectReleaseIntegrityProblems({
    ...tree.options,
    readdir: async () => [],
  });

  assert.deepEqual(
    problems.map((problem) => problem.reason),
    ["no release directories"],
  );
});
