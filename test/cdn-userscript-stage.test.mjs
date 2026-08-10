import test from "node:test";
import assert from "node:assert/strict";
import {
  createQaStagedMetadata,
  createStagedMetadata,
} from "../scripts/cdn/userscript-stage-lib.mjs";

const sha = "a".repeat(64);
const oldSha = "b".repeat(64);
const metadata = `// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.12.5
// @description  production
// @updateURL     https://example.test/update
// @downloadURL   https://example.test/download
// @grant        none
// @require      https://old.example/early.js#sha256=${oldSha}
// @require      https://old.example/runtime.js#sha256=${oldSha}
// @run-at       document-start
// ==/UserScript==
`;
const manifest = {
  release: "2.13.0",
  compat: {
    earlyGate: {
      path: "releases/2.13.0/compat/early.js",
      sha256: sha,
    },
    runtime: {
      path: "releases/2.13.0/compat/runtime.js",
      sha256: sha,
    },
  },
  esm: { enabled: false },
};

test("stable staging atomically emits only two pinned first-party requires", () => {
  const staged = createStagedMetadata({
    metadata,
    version: "2.13.0",
    compatibilityOrigin: "https://luogusp.round1.cc",
    manifest,
  });
  assert.match(staged.metadata, /^\/\/ @version\s+2\.13\.0$/m);
  assert.deepEqual(staged.requires, [
    `https://luogusp.round1.cc/releases/2.13.0/compat/early.js#sha256=${sha}`,
    `https://luogusp.round1.cc/releases/2.13.0/compat/runtime.js#sha256=${sha}`,
  ]);
  assert.equal(staged.metadata.includes("https://old.example/"), false);
  assert.equal(staged.metadata.includes("cdn.jsdelivr.net"), false);
  assert.match(staged.metadata, /^\/\/ @sandbox\s+raw$/m);
  assert.match(
    staged.metadata,
    /^\/\/ @connect\s+luogusp\.round1\.cc$/m,
  );
  assert.match(
    staged.metadata,
    /^\/\/ @grant\s+GM_xmlhttpRequest$/m,
  );
  assert.equal(staged.metadata.includes("/channels/"), false);
});

test("staging refuses dynamic ESM and any non-atomic require set", () => {
  assert.throws(
    () =>
      createStagedMetadata({
        metadata,
        version: "2.13.0",
        compatibilityOrigin: "https://luogusp.round1.cc",
        manifest: {
          ...manifest,
          esm: { enabled: true },
        },
      }),
    /manifest is not ready/,
  );
  assert.throws(
    () =>
      createStagedMetadata({
        metadata: metadata.replace(
          "// @run-at",
          "// @require      https://third.example/library.js\n// @run-at",
        ),
        version: "2.13.0",
        compatibilityOrigin: "https://luogusp.round1.cc",
        manifest,
      }),
    /exactly two/,
  );
});

test("staging is idempotent for an existing permission and compatibility pair", () => {
  const alreadyMigrated = metadata
    .replace("// @grant        none", [
      "// @sandbox      raw",
      "// @connect      stale.example",
      "// @grant        GM_xmlhttpRequest",
    ].join("\n"));
  const staged = createStagedMetadata({
    metadata: alreadyMigrated,
    version: "2.13.0",
    compatibilityOrigin: "https://luogusp.round1.cc",
    manifest,
  });
  assert.equal(staged.requires.length, 2);
  assert.equal(
    [...staged.metadata.matchAll(/^\/\/ @sandbox\s+/gm)].length,
    1,
  );
  assert.equal(
    [...staged.metadata.matchAll(/^\/\/ @connect\s+/gm)].length,
    1,
  );
  assert.equal(staged.metadata.includes("stale.example"), false);
});

test("QA staging keeps separate identity and the same two-require contract", () => {
  const qaVersion = "2.13.5-canary.19";
  const qaManifest = {
    ...manifest,
    release: qaVersion,
    compat: {
      earlyGate: {
        path: `releases/${qaVersion}/compat/early.js`,
        sha256: sha,
      },
      runtime: {
        path: `releases/${qaVersion}/compat/runtime.js`,
        sha256: sha,
      },
    },
  };
  const staged = createQaStagedMetadata({
    metadata,
    version: qaVersion,
    compatibilityOrigin: "https://luogusp.round1.cc",
    manifest: qaManifest,
  });

  assert.match(staged.metadata, /^\/\/ @name\s+LuoguSP QA$/m);
  assert.match(
    staged.metadata,
    /^\/\/ @namespace\s+https:\/\/github\.com\/ShanireZ\/LuoguSP\/qa$/m,
  );
  assert.match(
    staged.metadata,
    /^\/\/ @version\s+2\.13\.5-canary\.19$/m,
  );
  assert.equal(staged.metadata.includes("@updateURL"), false);
  assert.equal(staged.metadata.includes("@downloadURL"), false);
  assert.match(staged.metadata, /^\/\/ @sandbox\s+raw$/m);
  assert.match(
    staged.metadata,
    /^\/\/ @grant\s+GM_xmlhttpRequest$/m,
  );
  assert.match(
    staged.metadata,
    /^\/\/ @connect\s+luogusp\.round1\.cc$/m,
  );
  assert.equal(staged.requires.length, 2);
});
