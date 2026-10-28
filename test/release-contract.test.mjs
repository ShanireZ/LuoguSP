import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHiddenIntroFeature,
} from "../src/features/hidden-intro/feature.js";
import {
  createHoverCardFeatures,
} from "../src/features/hover-card/lazy-feature.js";
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
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const pnpmWorkspace = fs.readFileSync(
  path.join(root, "pnpm-workspace.yaml"),
  "utf8",
);
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

test("pnpm release uses the guarded CDN publisher", () => {
  // 精確版本是**有意**硬編碼的絆線：packageManager 是全倉唯一的 pnpm 版本來源
  // （本機、GitHub CI、.cnb.yml 都從它取），升版必須過這一條，不許無聲漂移。
  // 同時它也釘住「精確版本」這個形態 —— 寫成 ^12 之類的範圍會當場紅。
  assert.equal(packageJson.packageManager, "pnpm@12.14.0");
  assert.equal(packageJson.scripts.release, packageJson.scripts.publish);
  assert.match(pnpmWorkspace, /allowBuilds:\s+esbuild: true/);
});

test("release metadata, README badge and update endpoints stay aligned", () => {
  assert.equal(metadata.get("version"), releaseVersion);
  assert.match(
    readme,
    new RegExp(
      `version-${metadata.get("version").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-`,
    ),
  );
  assert.equal(metadata.get("match"), "https://www.luogu.com.cn/*");
  assert.equal(
    metadata.get("grant"),
    releaseVersion === "2.13.4"
      ? "none"
      : "GM_xmlhttpRequest",
  );
  if (releaseVersion !== "2.13.4") {
    assert.equal(metadata.get("sandbox"), "raw");
    assert.equal(
      metadata.get("connect"),
      new URL(releaseManifest.origin).hostname,
    );
  }
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
    "https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js",
  );
  assert.equal(metadata.get("downloadURL"), metadata.get("updateURL"));
});

test("runtime dependencies migrate atomically to two first-party compatibility files", () => {
  const requires = [
    ...script.matchAll(/^\/\/ @require\s+(\S+)$/gm),
  ].map((match) => match[1]);
  const compatibilityUrl = (file) =>
    `${new URL(
      file.path,
      `${releaseManifest.origin.replace(/\/+$/, "")}/`,
    )}#sha256=${file.sha256}`;
  const expectedPair = [
    compatibilityUrl(releaseManifest.compat.earlyGate),
    compatibilityUrl(releaseManifest.compat.runtime),
  ];
  if (releaseVersion === "2.13.4") {
    assert.equal(requires.length, 6);
    assert.equal(requires[0], expectedPair[0]);
    assert.equal(requires.at(-1), expectedPair[1]);
  } else {
    assert.deepEqual(requires, expectedPair);
    const renderer =
      releaseManifest.optionalBundles?.markdownRenderer;
    const rendererFile =
      renderer?.path && releaseManifest.files?.[renderer.path];
    assert.equal(renderer?.apiVersion, 1);
    assert.deepEqual(rendererFile, {
      path: renderer.path,
      bytes: renderer.bytes,
      sha256: renderer.sha256,
      sri: renderer.sri,
    });
    assert.equal(
      renderer.bytes <= qualityBudget.optionalRenderer.maxBytes,
      true,
    );
    assert.equal(
      renderer.gzipBytes <=
        qualityBudget.optionalRenderer.maxGzipBytes,
      true,
    );
  }
  assert.equal(Buffer.byteLength(script) <= 5000, true);
  assert.equal(script.includes("/channels/"), false);
  assert.equal(
    new URL(cdnConfig.origins.primary).origin,
    new URL(cdnConfig.origins.bootstrap).origin,
  );
});

test("restricted first paint stays covered until native page anchors are ready", () => {
  assert.equal(
    (restrictedFeatureSource.match(/html: columbaHtml\(/g) || []).length,
    2,
  );
  assert.match(restrictedFeatureSource, /bodySuffix: RST_LOADER_HTML/);
  assert.match(
    fs.readFileSync(
      path.join(
        root,
        "src/features/restricted-content/columba-scaffold.js",
      ),
      "utf8",
    ),
    /\$\{bodySuffix \|\| ""\}<\/body><\/html>/,
  );
  assert.match(
    restrictedFeatureSource,
    /if \(actionBars\.length && updateBars\.length\) rstHideLoader\(\)/,
  );
  assert.match(
    restrictedFeatureSource,
    /const chrome = findPasteChrome\(document\);\s*if \(!chrome\) return;[\s\S]*rstHideLoader\(\);/,
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

// Source/runtime UI labels, localized metadata and the English README describe
// the same six features. Check each representation without rewriting release bytes.
const SOURCE_LABELS = Object.freeze([
  "题号显示难度颜色",
  "题目悬停显示预览卡",
  "用户名/头像悬停显示预览卡",
  "个人页显示个人介绍",
  "受限文章与剪贴板解限",
  "IDE 模式一键测试所有样例",
]);
const SHIPPED_LABELS = SOURCE_LABELS;
const DESCRIPTION_LABELS = Object.freeze([
  "題號顯示難度顏色",
  "題目懸停顯示預覽卡",
  "使用者名稱/頭像懸停顯示預覽卡",
  "個人頁顯示個人介紹",
  "受限文章與剪貼板解限",
  "IDE 模式一鍵測試所有樣例",
]);

test("description and README follow the current source feature set", () => {
  assert.equal(
    metadata.get("description"),
    `LuoguSP：${DESCRIPTION_LABELS.join(" / ")}`,
  );
  const readmeLabels = [
    "Problem difficulty colors",
    "Problem hover previews",
    "User hover previews",
    "Profile introductions",
    "Restricted articles and pastes",
    "IDE sample batch testing",
  ];
  for (const label of readmeLabels)
    assert.equal(readme.includes(`**${label}**`), true, label);
});

test("the shipped runtime still contains every label it was released with", () => {
  for (const label of SHIPPED_LABELS)
    assert.equal(runtimeScript.includes(label), true, label);
});

// 當前原始碼裡的描述符：鍵、預設值、儲存鍵的形狀不變。
test("source feature descriptors keep their shape", () => {
  const storage = Object.freeze({
    get: () => true,
    set: () => {},
    has: () => true,
  });
  const hoverCards = createHoverCardFeatures({ storage });
  const descriptors = [
    createProblemColorFeature({ storage }),
    hoverCards.problem,
    hoverCards.user,
    createHiddenIntroFeature({ storage }),
    createRestrictedContentFeature({
      storage,
      restrictedLoadingGate: null,
      getPageLifecycle: () => null,
    }),
    createIdeBatchFeature({ storage }),
  ];
  assert.deepEqual(descriptors.map((feature) => [feature.key, feature.label]), [
    ["addProblemsColor", "题号显示难度颜色"],
    ["showProblemHoverCards", "题目悬停显示预览卡"],
    ["showUserHoverCards", "用户名/头像悬停显示预览卡"],
    ["showIntro", "个人页显示个人介绍"],
    ["showRestrictedContent", "受限文章与剪贴板解限"],
    ["ideBatchSampleTest", "IDE 模式一键测试所有样例"],
  ]);
  for (const descriptor of descriptors) {
    assert.equal(descriptor.storageKey, `LuoguSP.${descriptor.key}`);
    assert.equal(descriptor.defaultEnabled, true);
    assert.equal(descriptor.enabled(), true);
  }
});

// ★★★ `reports/browser-qa.json` 曾經是**手寫**的：儲存庫裡沒有任何東西能生成它，
//    於是「改了產物就得重跑 QA」在操作上等於「補不回來」。現在它由
//    `pnpm qa:browser` 生成，這條守衛盯著它別再退回手寫。
test("browser QA report is machine generated and covers this artifact", () => {
  const report = JSON.parse(
    fs.readFileSync(path.join(root, "reports", "browser-qa.json"), "utf8"),
  );
  assert.match(String(report.generatedBy), /qa:browser/);
  assert.equal(report.status, "passed");
  // 它驗的是**產物**（@require 指向的那份已發佈 release），不是工作區原始碼 ——
  // 所以報告裡必須把那兩條 URL 記下來，否則事後說不清跑的是哪一版。
  assert.equal(Array.isArray(report.requireUrls), true);
  assert.equal(report.requireUrls.length, 2);
  for (const url of report.requireUrls)
    assert.match(url, /#sha256=[0-9a-f]{64}$/, url);
  // 覆蓋範圍必須寫清楚，別讓人誤以為它驗過按需塊和保存站。
  assert.equal(report.limitations.length > 0, true);
});
