import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChatShortcutFeature,
} from "../src/features/chat-shortcut/feature.js";
import {
  createHiddenIntroFeature,
} from "../src/features/hidden-intro/feature.js";
import {
  createIdeBatchFeature,
} from "../src/features/ide-batch/feature.js";
import {
  createProblemColorFeature,
} from "../src/features/problem-color/feature.js";
import {
  createRestrictedContentFeature,
} from "../src/features/restricted-content/feature.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const script = fs.readFileSync(path.join(root, "LuoguSP.user.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

const metadata = new Map(
  [...script.matchAll(/^\/\/ @(\S+)\s+(.+)$/gm)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);

test("release metadata, README badge and update endpoints stay aligned", () => {
  assert.equal(metadata.get("version"), "2.12.5");
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

test("restricted first paint stays covered until native page anchors are ready", () => {
  assert.equal(
    (script.match(/\$\{RST_LOADER_HTML\}<\/body><\/html>/g) || []).length,
    2,
  );
  assert.match(
    script,
    /if \(actionBars\.length && updateBars\.length\) rstHideLoader\(\)/,
  );
  assert.match(script, /if \(author && pubRow\) rstHideLoader\(\)/);
  assert.match(
    script,
    /html\.\$\{className\} body>\*\{visibility:hidden!important;\}/,
  );
  assert.match(
    script,
    /document\.addEventListener\("DOMContentLoaded", bootstrap, \{ once: true \}\)/,
  );
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
  assert.equal(script.includes("LUOGUSP_NODE_MODULE"), false);
  assert.equal(script.includes("module.exports"), false);
});

test("feature labels and lifecycle gates keep the same five setting keys", () => {
  const storage = Object.freeze({
    get: () => true,
    set: () => {},
    has: () => true,
  });
  const descriptors = [
    createProblemColorFeature({ storage }),
    createChatShortcutFeature({ storage }),
    createHiddenIntroFeature({ storage }),
    createIdeBatchFeature({ storage }),
    createRestrictedContentFeature({
      storage,
      restrictedLoadingGate: null,
      getPageLifecycle: () => null,
    }),
  ];
  const features = new Map(
    descriptors.map((feature) => [feature.key, feature.label]),
  );
  assert.deepEqual([...features], [
    ["addProblemsColor", "题号显示难度颜色"],
    ["addMessageLink", "私信 Ctrl+Click 打开用户个人页"],
    ["showIntro", "个人页显示个人介绍"],
    ["ideBatchSampleTest", "IDE 模式一键测试所有样例"],
    ["showRestrictedContent", "显示受限文章与剪贴板"],
  ]);
  assert.equal(
    metadata.get("description"),
    `LuoguSP：${[...features.values()].join(" / ")}`,
  );
  for (const descriptor of descriptors) {
    const { key, label } = descriptor;
    assert.equal(descriptor.storageKey, `LuoguSP.${key}`);
    assert.equal(descriptor.defaultEnabled, true);
    assert.equal(descriptor.enabled(), true);
    assert.equal(script.includes(`"${label}"`), true, label);
    assert.equal(readme.includes(`**${label}**`), true, label);
  }
});
