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
const cdnConfig = JSON.parse(
  fs.readFileSync(path.join(root, "config/cdn.json"), "utf8"),
);
const qualityBudget = JSON.parse(
  fs.readFileSync(
    path.join(root, "config/quality-budget.json"),
    "utf8",
  ),
);
const releaseVersion =
  script.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
const releaseManifest = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      `cdn/releases/${releaseVersion}/manifest.json`,
    ),
    "utf8",
  ),
);
const runtimeScript = fs.readFileSync(
  path.join(root, "cdn", releaseManifest.compat.runtime.path),
  "utf8",
);
const restrictedFeatureSource = fs.readFileSync(
  path.join(root, "src/features/restricted-content/feature.js"),
  "utf8",
);
const restrictedEarlyGateSource = fs.readFileSync(
  path.join(root, "src/bootstrap/restricted-early-gate.js"),
  "utf8",
);
const runAppSource = fs.readFileSync(
  path.join(root, "src/bootstrap/run-app.js"),
  "utf8",
);

const metadata = new Map(
  [...script.matchAll(/^\/\/ @(\S+)\s+(.+)$/gm)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);

test("release metadata, README badge and update endpoints stay aligned", () => {
  assert.equal(metadata.get("version"), releaseVersion);
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

test("runtime dependencies pin bootstrap compatibility files around third-party UI libraries", () => {
  const requires = [
    ...script.matchAll(/^\/\/ @require\s+(\S+)$/gm),
  ].map((match) => match[1]);
  const compatibilityUrl = (file) =>
    `${new URL(
      file.path,
      `${cdnConfig.origins.bootstrap.replace(/\/+$/, "")}/`,
    )}#sha256=${file.sha256}`;
  assert.deepEqual(requires, [
    compatibilityUrl(releaseManifest.compat.earlyGate),
    ...qualityBudget.requires.resources.map(
      (resource) => resource.url,
    ),
    compatibilityUrl(releaseManifest.compat.runtime),
  ]);
  assert.equal(Buffer.byteLength(script) <= 5000, true);
  assert.equal(script.includes("/channels/"), false);
  const nonBootstrapOrigin = [
    cdnConfig.origins.primary,
    cdnConfig.origins.fallback,
  ].find(
    (origin) =>
      new URL(origin).origin !==
      new URL(cdnConfig.origins.bootstrap).origin,
  );
  assert.equal(script.includes(nonBootstrapOrigin), false);
});

test("restricted first paint stays covered until native page anchors are ready", () => {
  assert.equal(
    (
      restrictedFeatureSource.match(
        /\$\{RST_LOADER_HTML\}<\/body><\/html>/g,
      ) || []
    ).length,
    2,
  );
  assert.match(
    restrictedFeatureSource,
    /if \(actionBars\.length && updateBars\.length\) rstHideLoader\(\)/,
  );
  assert.match(
    restrictedFeatureSource,
    /if \(author && pubRow\) rstHideLoader\(\)/,
  );
  assert.match(
    restrictedEarlyGateSource,
    /html\.\$\{className\} body>\*\{visibility:hidden!important;\}/,
  );
  assert.match(
    runAppSource,
    /document\.addEventListener\("DOMContentLoaded", bootstrap, \{\s*once: true,\s*\}\)/,
  );
});

test("restricted article document keeps its JSON serializer dependency explicit", () => {
  assert.match(
    restrictedFeatureSource,
    /import \{\s*createRestrictedDocumentCommitter,\s*serializeJsonForScript,\s*\} from "\.\/document-committer\.js";/,
  );
  assert.equal(
    (restrictedFeatureSource.match(/serializeJsonForScript\(/g) || []).length,
    2,
  );
});

test("Phase 7 removes temporary compatibility facades and keeps one document committer", () => {
  for (const facade of [
    "function addProblemsColor(",
    "function watchIdeBatch(",
    "restrictedPageInfo",
    "function startFeatures(",
  ])
    assert.equal(runtimeScript.includes(facade), false, facade);

  assert.equal(
    (
      restrictedFeatureSource.match(
        /open:\s*\(\)\s*=>\s*document\.open\(\)/g,
      ) || []
    ).length,
    1,
  );
  assert.equal(
    (
      restrictedFeatureSource.match(
        /write:\s*\(html\)\s*=>\s*document\.write\(html\)/g,
      ) || []
    ).length,
    1,
  );
  assert.equal(
    (
      restrictedFeatureSource.match(
        /close:\s*\(\)\s*=>\s*document\.close\(\)/g,
      ) || []
    ).length,
    1,
  );
  assert.equal(runtimeScript.includes("LUOGUSP_NODE_MODULE"), false);
  assert.equal(runtimeScript.includes("module.exports"), false);
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
    assert.equal(runtimeScript.includes(label), true, label);
    assert.equal(readme.includes(`**${label}**`), true, label);
  }
});
