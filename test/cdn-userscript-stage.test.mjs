import test from "node:test";
import assert from "node:assert/strict";
import {
  createQaStagedMetadata,
  createStagedMetadata,
} from "../scripts/cdn/userscript-stage-lib.mjs";

const thirdParty = [
  "https://third.example/katex.js",
  "https://third.example/marked.js",
  "https://third.example/purify.js",
  "https://third.example/highlight.js",
];
const metadata = `// ==UserScript==
// @name         LuoguSP
// @version      2.12.5
// @grant        none
${thirdParty.map((url) => `// @require      ${url}`).join("\n")}
// @run-at       document-start
// ==/UserScript==
`;
const sha = "a".repeat(64);
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

test("staged userscript pins the bootstrap compatibility files around third-party requires", () => {
  const staged = createStagedMetadata({
    metadata,
    version: "2.13.0",
    compatibilityOrigin: "https://spcdn.betaoi.cc",
    manifest,
    thirdPartyRequireUrls: thirdParty,
  });
  assert.match(staged.metadata, /^\/\/ @version\s+2\.13\.0$/m);
  assert.equal(staged.requires.length, 6);
  assert.equal(
    staged.requires[0],
    `https://spcdn.betaoi.cc/releases/2.13.0/compat/early.js#sha256=${sha}`,
  );
  assert.deepEqual(staged.requires.slice(1, 5), thirdParty);
  assert.equal(
    staged.requires[5],
    `https://spcdn.betaoi.cc/releases/2.13.0/compat/runtime.js#sha256=${sha}`,
  );
  assert.equal(staged.metadata.includes("/channels/"), false);
  assert.equal(staged.metadata.includes("spcdn.betaoi.cn"), false);
});

test("staging refuses a dynamic ESM manifest or changed third-party requires", () => {
  assert.throws(
    () =>
      createStagedMetadata({
        metadata,
        version: "2.13.0",
        compatibilityOrigin: "https://spcdn.betaoi.cc",
        manifest: {
          ...manifest,
          esm: { enabled: true },
        },
        thirdPartyRequireUrls: thirdParty,
      }),
    /manifest is not ready/,
  );
  assert.throws(
    () =>
      createStagedMetadata({
        metadata: metadata.replace(thirdParty[0], "https://changed.example"),
        version: "2.13.0",
        compatibilityOrigin: "https://spcdn.betaoi.cc",
        manifest,
        thirdPartyRequireUrls: thirdParty,
      }),
    /expected third-party/,
  );
});

test("staging replaces an existing compatibility pair for the next stable release", () => {
  const oldSha = "b".repeat(64);
  const productionMetadata = metadata.replace(
    thirdParty.map((url) => `// @require      ${url}`).join("\n"),
    [
      `// @require      https://old.example/early.js#sha256=${oldSha}`,
      ...thirdParty.map((url) => `// @require      ${url}`),
      `// @require      https://old.example/runtime.js#sha256=${oldSha}`,
    ].join("\n"),
  );
  const staged = createStagedMetadata({
    metadata: productionMetadata,
    version: "2.13.0",
    compatibilityOrigin: "https://spcdn.betaoi.cc",
    manifest,
    thirdPartyRequireUrls: thirdParty,
  });
  assert.equal(staged.requires.length, 6);
  assert.equal(
    staged.metadata.includes("https://old.example/"),
    false,
  );
  assert.deepEqual(staged.requires.slice(1, 5), thirdParty);
});

test("QA staging uses a separate identity and cannot auto-update production", () => {
  const qaVersion = "2.13.5-canary.2";
  const qaMetadata = `// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.13.4
// @description  production
// @updateURL     https://example.test/update
// @downloadURL   https://example.test/download
// @grant        none
${thirdParty.map((url) => `// @require      ${url}`).join("\n")}
// @run-at       document-start
// ==/UserScript==
`;
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
    metadata: qaMetadata,
    version: qaVersion,
    compatibilityOrigin: "https://spcdn.betaoi.cc",
    manifest: qaManifest,
    thirdPartyRequireUrls: thirdParty,
  });

  assert.match(staged.metadata, /^\/\/ @name\s+LuoguSP QA$/m);
  assert.match(
    staged.metadata,
    /^\/\/ @namespace\s+https:\/\/github\.com\/ShanireZ\/LuoguSP\/qa$/m,
  );
  assert.match(
    staged.metadata,
    /^\/\/ @version\s+2\.13\.5-canary\.2$/m,
  );
  assert.equal(staged.metadata.includes("@updateURL"), false);
  assert.equal(staged.metadata.includes("@downloadURL"), false);
  assert.equal(staged.requires.length, 6);
});
