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
  assert.equal(packageJson.packageManager, "pnpm@11.18.0");
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

// 这一组合同盯两件不同的事，别混在一起：
//
//  A. **当前源码**的功能集 —— `@description` 与 README 必须跟着它走。
//     （防止再次漂移：功能改了名、加了开关，文案不跟着改就没人发现。）
//  B. **已经发出去的 2.13.10** 的 runtime 里确实含有的标签 —— 只有这部分能对
//     正式版产物做包含断言。
//
// ★ 两者现在**故意不一致**：hover 卡的两个开关与受限内容的新名字都还在 canary 里，
//   正式版 runtime 里没有那几行字。owner 2026-08-14 要求文案先行，
//   所以 `@description` 已经写成了源码的样子，转 2.14.0 时 B 组会自动追上。
// ★ 改 `@description` 不会让真机 QA 的戳失效 —— 那个戳用的是**行为哈希**，
//   只豁免这一行（见 scripts/artifact-behaviour-hash.mjs）。
const SOURCE_LABELS = Object.freeze([
  "题号显示难度颜色",
  "题目悬停显示预览卡",
  "用户名/头像悬停显示预览卡",
  "个人页显示个人介绍",
  "受限文章与剪贴板解限",
  "IDE 模式一键测试所有样例",
]);
const SHIPPED_LABELS = Object.freeze([
  "题号显示难度颜色",
  "个人页显示个人介绍",
  "IDE 模式一键测试所有样例",
  // ★ 正式版 runtime 里是**旧名字**。改名只在源码里，转正式版才会一起发出去。
  "显示受限文章与剪贴板",
]);

test("description and README follow the current source feature set", () => {
  assert.equal(
    metadata.get("description"),
    `LuoguSP：${SOURCE_LABELS.join(" / ")}`,
  );
  for (const label of SOURCE_LABELS)
    assert.equal(readme.includes(`**${label}**`), true, label);
});

test("the shipped runtime still contains every label it was released with", () => {
  for (const label of SHIPPED_LABELS)
    assert.equal(runtimeScript.includes(label), true, label);
});

// 当前源码里的描述符：键、默认值、存储键的形状不变。
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

// ★★★ `reports/browser-qa.json` 曾经是**手写**的：仓库里没有任何东西能生成它，
//    于是「改了产物就得重跑 QA」在操作上等于「补不回来」。现在它由
//    `npm run qa:browser` 生成，这条守卫盯着它别再退回手写。
test("browser QA report is machine generated and covers this artifact", () => {
  const report = JSON.parse(
    fs.readFileSync(path.join(root, "reports", "browser-qa.json"), "utf8"),
  );
  assert.match(String(report.generatedBy), /qa:browser/);
  assert.equal(report.status, "passed");
  // 它验的是**产物**（@require 指向的那份已发布 release），不是工作区源码 ——
  // 所以报告里必须把那两条 URL 记下来，否则事后说不清跑的是哪一版。
  assert.equal(Array.isArray(report.requireUrls), true);
  assert.equal(report.requireUrls.length, 2);
  for (const url of report.requireUrls)
    assert.match(url, /#sha256=[0-9a-f]{64}$/, url);
  // 覆盖范围必须写清楚，别让人误以为它验过按需块和保存站。
  assert.equal(report.limitations.length > 0, true);
});
