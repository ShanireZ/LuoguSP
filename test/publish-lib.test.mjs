import test from "node:test";
import assert from "node:assert/strict";
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

test("publish helpers synchronize package and lockfile versions", () => {
  const packageText = packageTextWithVersion(
    JSON.stringify({
      name: "luogusp",
      version: "2.0.0",
      packages: { "": { version: "2.0.0" } },
    }),
    "3.0.0",
  );
  const document = JSON.parse(packageText);
  assert.equal(document.version, "3.0.0");
  assert.equal(document.packages[""].version, "3.0.0");
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
