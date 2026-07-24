"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "LuoguSP.user.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

const metadata = new Map(
  [...script.matchAll(/^\/\/ @(\S+)\s+(.+)$/gm)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);

test("release metadata, README badge and update endpoints stay aligned", () => {
  assert.equal(metadata.get("version"), "2.12.2");
  assert.match(
    readme,
    new RegExp(
      `version-${metadata.get("version").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-`,
    ),
  );
  assert.equal(metadata.get("match"), "https://www.luogu.com.cn/*");
  assert.equal(metadata.get("grant"), "none");
  assert.equal(metadata.get("run-at"), "document-start");
  assert.equal(
    metadata.get("homepageURL"),
    "https://github.com/ShanireZ/LuoguSP",
  );
  assert.equal(
    metadata.get("supportURL"),
    "https://github.com/ShanireZ/LuoguSP/issues",
  );
  assert.equal(
    metadata.get("updateURL"),
    "https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js",
  );
  assert.equal(metadata.get("downloadURL"), metadata.get("updateURL"));
});

test("runtime dependencies and browser privileges do not expand", () => {
  const requires = [
    ...script.matchAll(/^\/\/ @require\s+(\S+)$/gm),
  ].map((match) => match[1]);
  assert.deepEqual(requires, [
    "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js",
    "https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js",
    "https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js",
    "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js",
  ]);
});

test("Phase 7 removes temporary compatibility facades and keeps one document committer", () => {
  for (const facade of [
    "function addProblemsColor(",
    "function watchIdeBatch(",
    "restrictedPageInfo",
    "function startFeatures(",
  ])
    assert.equal(script.includes(facade), false, facade);

  assert.equal(
    (script.match(/open:\s*\(\)\s*=>\s*document\.open\(\)/g) || []).length,
    1,
  );
  assert.equal(
    (script.match(/write:\s*\(html\)\s*=>\s*document\.write\(html\)/g) || [])
      .length,
    1,
  );
  assert.equal(
    (script.match(/close:\s*\(\)\s*=>\s*document\.close\(\)/g) || []).length,
    1,
  );
});

test("feature labels and lifecycle gates keep the same five setting keys", () => {
  const keys = [
    "addProblemsColor",
    "addMessageLink",
    "showIntro",
    "ideBatchSampleTest",
    "showRestrictedContent",
  ];
  for (const key of keys) {
    const matches = script.match(
      new RegExp(`STORAGE_PREFIX\\}${key}`, "g"),
    );
    assert.equal(matches && matches.length, 2, key);
  }
});
