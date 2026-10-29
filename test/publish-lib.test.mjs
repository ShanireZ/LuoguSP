import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isResumablePublish,
  packageTextWithVersion,
  readmeTextWithVersion,
  userscriptMetadata,
  userscriptVersion,
  verifyStagedActivation,
} from "../scripts/publish-lib.mjs";
import * as publishHelpers from "../scripts/publish-lib.mjs";

const sha = "a".repeat(64);
test("real release preflight rejects a stale or missing translated edition", () => {
  const base = tmpdir();
  const root = mkdtempSync(path.join(base, "luogusp-readme-publication-20261029-"));
  try {
    const required = ["scripts/publish.mjs", "scripts/publish-lib.mjs", "scripts/cdn/origin-policy.mjs", "src/userscript.meta.js", "LuoguSP.user.js", "package.json", "README.md", "README.zh-CN.md", "README.zh-TW.md", "README.ja.md", "reports/quality-report.json", "cdn/channels/canary.json", "config/cdn.json"];
    for (const file of required) {
      mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
      copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), path.join(root, file));
    }
    mkdirSync(path.join(root, "cdn/releases"), {recursive: true});
    // The publisher runs this suite after promotion too. Simulate that state.
    const live = userscriptVersion(readFileSync(path.join(root, "LuoguSP.user.js"), "utf8"));
    const parts = live.split(".").map(Number);
    const promoted = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    for (const name of ["src/userscript.meta.js", "LuoguSP.user.js", "package.json", ...publishHelpers.README_EDITIONS]) {
      const file = path.join(root, name);
      writeFileSync(file, readFileSync(file, "utf8").replaceAll(live, promoted));
    }
    const run = () => spawnSync(process.execPath, ["scripts/publish.mjs", "--plan", "--version", "999.0.0"], {cwd: root, encoding: "utf8", windowsHide: true});
    assert.equal(run().status, 0);
    const file = path.join(root, "README.zh-TW.md");
    writeFileSync(file, readFileSync(file, "utf8").replaceAll(promoted, "0.0.0"));
    const stale = run();
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /README version drift: README.zh-TW.md/);
    rmSync(path.join(root, "README.ja.md"));
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /README.ja.md/);
  } finally {
    assert.equal(path.dirname(root), base);
    assert.ok(path.basename(root).startsWith("luogusp-readme-publication-20261029-"));
    rmSync(root, {recursive: true, force: true});
  }
});
test("release versions validate and update every README edition", () => {
  assert.equal(typeof publishHelpers.readmeEditionsWithVersion, "function");
  const names = ["README.md", "README.zh-CN.md", "README.zh-TW.md", "README.ja.md"];
  const badge = "[![Version: 2.14.6](https://img.shields.io/badge/version-2.14.6-blue.svg)](LuoguSP.user.js)\n";
  const texts = Object.fromEntries(names.map(name => [name, badge]));
  const changed = publishHelpers.readmeEditionsWithVersion(texts, "2.14.6", "2.14.7");
  for (const name of names) assert.match(changed[name], /Version: 2\.14\.7/);
  assert.match(texts["README.ja.md"], /2\.14\.6/);
  const absent = {...texts};delete absent["README.ja.md"];
  assert.throws(() => publishHelpers.readmeEditionsWithVersion(absent,"2.14.6","2.14.7"), /README.ja.md/);
  assert.throws(() => publishHelpers.readmeEditionsWithVersion({...texts,"README.zh-TW.md":badge.replaceAll("2.14.6","2.14.5")},"2.14.6","2.14.7"), /README.zh-TW.md/);
});
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

// ★★★ 發佈指令碼的 preflight 必須真的跑得起來。2026-08-17 的 pnpm 遷移把
// `initialPackageLock` 的讀取刪了，卻漏掉了 preflight 裡的兩處使用 —— 於是
// `pnpm release` 從那天起一開口就死在 `ReferenceError: initialPackageLock is not
// defined`，而 `pnpm check`（build:check + quality:check + node --test）一條都碰不到
// 發佈指令碼的頂層，全綠到底。整個儲存庫沒有任何一道門跑過它，所以兩天沒人知道。
// 這道門就是那道門：`--plan` 會走完全部 preflight（版本一致性、目標版本必須更新、
// 不覆蓋既有不可變發佈）再列印計畫退出，一個位元組都不寫、一個請求都不發。
test("发布脚本的 preflight 在 --plan 下跑得通，并认出当前生产版本", () => {
  const artifact = readFileSync(
    new URL("../LuoguSP.user.js", import.meta.url),
    "utf8",
  );
  const current = userscriptVersion(artifact);
  // ★ 用一個永遠不會有發佈目錄的版本號，而不是「當前版本 + 1」。這道門本身也在
  //   `pnpm release` 的 pre-deployment 測試集裡跑，而那時候「下一個補丁版本」的
  //   `cdn/releases/` 目錄**剛剛被第 1 步建出來**，`wouldPublish` 就變成了 false ——
  //   第一次發 2.14.3 時它就是這麼把發佈攔下來的。判據不能相依發佈中途的狀態。
  const next = "999.0.0";
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
  // 計畫本身不許自作主張提交或推送，也不許繞過真機 QA。
  assert.equal(plan.commit, false);
  assert.equal(plan.push, false);
  assert.equal(plan.browserQaRequiredBeforeCommit, true);
});

// 反證同一道門的另一半：已經發出去的版本號絕不能被再發一次（不可變發佈）。
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
