import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isResumablePublish,
  packageTextWithVersion,
  readmeTextWithVersion,
  userscriptMetadata,
  userscriptVersion,
  verifyStagedActivation,
} from "../scripts/publish-lib.mjs";

const sha = "a".repeat(64);
const rendererPath =
  "releases/3.0.0/render/markdown-renderer.aaaaaaaaaaaaaaaa.js";
const rendererFile = {
  path: rendererPath,
  bytes: 123,
  sha256: sha,
  sri: "sha256-YQ==",
};
const manifest = {
  release: "3.0.0",
  compat: {
    earlyGate: {
      path: "releases/3.0.0/compat/early.js",
      sha256: sha,
    },
    runtime: {
      path: "releases/3.0.0/compat/runtime.js",
      sha256: sha,
    },
  },
  optionalBundles: {
    markdownRenderer: {
      apiVersion: 1,
      ...rendererFile,
      gzipBytes: 100,
    },
  },
  files: {
    [rendererPath]: rendererFile,
  },
  esm: { enabled: false },
};
const config = {
  origins: {
    primary: "https://luogusp.round1.cc",
    bootstrap: "https://luogusp.round1.cc",
  },
};
const early =
  `https://luogusp.round1.cc/${manifest.compat.earlyGate.path}#sha256=${sha}`;
const runtime =
  `https://luogusp.round1.cc/${manifest.compat.runtime.path}#sha256=${sha}`;
const artifact = `// ==UserScript==
// @version      3.0.0
// @require      ${early}
// @require      ${runtime}
// ==/UserScript==
(()=>{})();
`;

test("publish helpers derive the stable version and production header", () => {
  assert.equal(userscriptVersion(artifact), "3.0.0");
  assert.equal(
    userscriptMetadata(artifact).endsWith("// ==/UserScript==\n"),
    true,
  );
  assert.throws(
    () => userscriptVersion(artifact.replace("3.0.0", "3.0.0-beta.1")),
    /stable @version/,
  );
});

test("publish helpers synchronize the package version and the README badge", () => {
  const packageText = packageTextWithVersion(
    JSON.stringify({ name: "luogusp", version: "2.0.0" }),
    "3.0.0",
  );
  const document = JSON.parse(packageText);
  assert.equal(document.version, "3.0.0");
  const readme = readmeTextWithVersion(
    "[![Version: 2.0.0](https://img.shields.io/badge/version-2.0.0-blue.svg)](LuoguSP.user.js)\n",
    "3.0.0",
  );
  assert.match(readme, /Version: 3\.0\.0/);
  assert.match(readme, /badge\/version-3\.0\.0-/);
});

test("publish resumes only the same blocked release after deployment started", () => {
  assert.equal(
    isResumablePublish(
      {
        status: "blocked",
        release: "3.0.0",
        deploymentStarted: true,
      },
      "3.0.0",
    ),
    true,
  );
  assert.equal(
    isResumablePublish(
      {
        status: "blocked",
        release: "3.0.0",
        deploymentStarted: false,
      },
      "3.0.0",
    ),
    false,
  );
  assert.equal(
    isResumablePublish(
      {
        status: "ready-for-browser-qa",
        release: "3.0.0",
        deploymentStarted: true,
      },
      "3.0.0",
    ),
    false,
  );
});

test("publish promotion accepts only the verified compatibility runtime", () => {
  const result = verifyStagedActivation({
    artifact,
    version: "3.0.0",
    manifest,
    config,
  });
  assert.equal(result.requires.length, 2);
  assert.equal(result.requires[0], early);
  assert.equal(result.requires.at(-1), runtime);
  assert.throws(
    () =>
      verifyStagedActivation({
        artifact: artifact.replace(runtime, `${runtime}0`),
        version: "3.0.0",
        manifest,
        config,
      }),
    /does not pin/,
  );
  assert.throws(
    () =>
      verifyStagedActivation({
        artifact: artifact.replace(
          "(()=>{})();",
          'import("/channels/canary.json")',
        ),
        version: "3.0.0",
        manifest,
        config,
      }),
    /must not execute mutable channel code/,
  );
  assert.throws(
    () =>
      verifyStagedActivation({
        artifact,
        version: "3.0.0",
        manifest: {
          ...manifest,
          optionalBundles: {},
        },
        config,
      }),
    /complete optional renderer/,
  );
});

// ★★★ 发布脚本的 preflight 必须真的跑得起来。2026-08-17 的 pnpm 迁移把
// `initialPackageLock` 的读取删了，却漏掉了 preflight 里的两处使用 —— 于是
// `pnpm release` 从那天起一开口就死在 `ReferenceError: initialPackageLock is not
// defined`，而 `pnpm check`（build:check + quality:check + node --test）一条都碰不到
// 发布脚本的顶层，全绿到底。整个仓库没有任何一道门跑过它，所以两天没人知道。
// 这道门就是那道门：`--plan` 会走完全部 preflight（版本一致性、目标版本必须更新、
// 不覆盖既有不可变发布）再打印计划退出，一个字节都不写、一个请求都不发。
test("发布脚本的 preflight 在 --plan 下跑得通，并认出下一个补丁版本", () => {
  const artifact = readFileSync(
    new URL("../LuoguSP.user.js", import.meta.url),
    "utf8",
  );
  const current = userscriptVersion(artifact);
  const [major, minor, patch] = current.split(".").map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  const result = spawnSync(
    process.execPath,
    ["scripts/publish.mjs", "--plan", "--version", next],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    },
  );
  assert.equal(
    result.status,
    0,
    `--plan 退出码 ${result.status}：\n${result.stderr}`,
  );
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.version, next);
  assert.equal(plan.currentVersion, current);
  assert.equal(plan.wouldPublish, true);
  // 计划本身不许自作主张提交或推送，也不许绕过真机 QA。
  assert.equal(plan.commit, false);
  assert.equal(plan.push, false);
  assert.equal(plan.browserQaRequiredBeforeCommit, true);
});

// 反证同一道门的另一半：已经发出去的版本号绝不能被再发一次（不可变发布）。
test("发布脚本拒绝重发已存在的版本", () => {
  const artifact = readFileSync(
    new URL("../LuoguSP.user.js", import.meta.url),
    "utf8",
  );
  const result = spawnSync(
    process.execPath,
    ["scripts/publish.mjs", "--plan", "--version", userscriptVersion(artifact)],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be newer than current production/);
});
