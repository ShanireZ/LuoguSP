import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildBrowser } from "../../baseline-targets.mjs";
import { buildMarkdownRenderer } from "../renderer/build-lib.mjs";
import {
  MARKDOWN_RENDERER_API_VERSION,
  rendererStackDependencies,
} from "../../src/rendering/renderer-dependencies.js";
import { resolveConfiguredOrigin } from "./origin-policy.mjs";
import { committedReleaseFiles } from "./committed-releases.mjs";
import { writeRelease } from "./release-transaction.mjs";
import {
  RELEASE_VERSION, parseCanaryChannel, readRegularFile, requireRegularDirectory, snapshotRelease,
} from "./release-integrity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const releasesRoot = resolve(root, "cdn/releases");
const channelsRoot = resolve(root, "cdn/channels");
const [configText, packageJsonText] = await Promise.all([
  readFile(resolve(root, "config/cdn.json"), "utf8"),
  readFile(resolve(root, "package.json"), "utf8"),
]);
const config = JSON.parse(configText);
const packageJson = JSON.parse(packageJsonText);
const cdnOrigin = resolveConfiguredOrigin({ config });
const normalizePath = (value) => value.split(sep).join("/");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const version = argument("--version");
const overwrite = process.argv.includes("--overwrite");
const verifyExisting = process.argv.includes("--verify-existing");
const dryRun = process.argv.includes("--dry-run");
const channelFile = argument("--channel-file");

if (
  typeof version !== "string" ||
  !RELEASE_VERSION.test(version)
)
  throw new Error(
    "Pass an immutable release version with --version, for example 2.13.0-canary.1",
  );
if (overwrite)
  throw new Error("--overwrite is disabled: CDN release paths are immutable");
if (dryRun && verifyExisting)
  throw new Error("--dry-run cannot be combined with --verify-existing");
if (process.argv.includes("--channel-file") && (!verifyExisting || !channelFile || channelFile.startsWith("--")))
  throw new Error("Pass --channel-file with --verify-existing to check a captured channel");

const releaseDir = resolve(releasesRoot, version);
if (
  releaseDir === releasesRoot ||
  !releaseDir.startsWith(`${releasesRoot}${sep}`)
)
  throw new Error("Refusing to write outside cdn/releases");

let existingRelease;
if (!dryRun) {
  await requireRegularDirectory(resolve(root, "cdn"));
  await requireRegularDirectory(releasesRoot);
  await requireRegularDirectory(channelsRoot);
  if (!channelFile) await readRegularFile(resolve(channelsRoot, "canary.json"));
  if (verifyExisting) {
    existingRelease = await snapshotRelease(releasesRoot, version);
  } else {
    const occupied = await lstat(releaseDir).then(() => true, (error) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    });
    if (occupied || committedReleaseFiles(root, version).has(version))
      throw new Error(`CDN release ${version} already exists; release paths are immutable`);
  }
}
const outputFiles = new Map();

const digest = (body) => createHash("sha256").update(body).digest("hex");
const sri = (body) =>
  `sha256-${createHash("sha256").update(body).digest("base64")}`;
const fileRecord = (path, body) =>
  Object.freeze({
    path,
    bytes: body.length,
    sha256: digest(body),
    sri: sri(body),
  });

async function buildCompat(entryPoint, prefix, define = {}) {
  const result = await buildBrowser({
    absWorkingDir: root,
    entryPoints: [entryPoint],
    bundle: true,
    format: "iife",
    platform: "browser",
    charset: "utf8",
    legalComments: "inline",
    minify: true,
    treeShaking: true,
    write: false,
    define: {
      __LUOGUSP_CDN_RELEASE__: JSON.stringify(version),
      ...define,
    },
  });
  if (result.outputFiles?.length !== 1)
    throw new Error(`Expected one ${prefix} compatibility output`);
  const body = Buffer.from(result.outputFiles[0].contents);
  const relativePath = `compat/${prefix}.${digest(body).slice(0, 16)}.js`;
  outputFiles.set(relativePath, body);
  return fileRecord(`releases/${version}/${relativePath}`, body);
}

for (const [name, dependencyVersion] of Object.entries(
  rendererStackDependencies,
)) {
  if (packageJson.dependencies?.[name] !== dependencyVersion)
    throw new Error(
      `Renderer dependency ${name} must be pinned to ${dependencyVersion}`,
    );
}
const markdownRendererBody = await buildMarkdownRenderer({ root });
const markdownRendererRelativePath = `render/markdown-renderer.${digest(markdownRendererBody).slice(0, 16)}.js`;
outputFiles.set(markdownRendererRelativePath, markdownRendererBody);
const markdownRendererFile = fileRecord(
  `releases/${version}/${markdownRendererRelativePath}`,
  markdownRendererBody,
);
const markdownRendererBundle = Object.freeze({
  apiVersion: MARKDOWN_RENDERER_API_VERSION,
  path: markdownRendererFile.path,
  bytes: markdownRendererFile.bytes,
  gzipBytes: gzipSync(markdownRendererBody, { level: 9 }).length,
  sha256: markdownRendererFile.sha256,
  sri: markdownRendererFile.sri,
  dependencies: rendererStackDependencies,
});
// 受限內容按需塊：啟動包裡最大的一塊（實測 44506 B / 37%），卻只在
// 「安全訪問中心」攔截頁才用得到。拆出來後啟動包降到約 83 KB。
const restrictedContentResult = await buildBrowser({
  absWorkingDir: root,
  entryPoints: ["src/cdn/restricted-content-bundle.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  minify: true,
  treeShaking: true,
  write: false,
});
if (restrictedContentResult.outputFiles?.length !== 1)
  throw new Error("Expected one restricted content bundle output");
const restrictedContentBody = Buffer.from(
  restrictedContentResult.outputFiles[0].contents,
);
const restrictedContentRelativePath = `feature/restricted-content.${digest(restrictedContentBody).slice(0, 16)}.js`;
outputFiles.set(restrictedContentRelativePath, restrictedContentBody);
const restrictedContentFile = fileRecord(
  `releases/${version}/${restrictedContentRelativePath}`,
  restrictedContentBody,
);
const restrictedContentBundle = Object.freeze({
  apiVersion: 1,
  path: restrictedContentFile.path,
  bytes: restrictedContentFile.bytes,
  gzipBytes: gzipSync(restrictedContentBody, { level: 9 }).length,
  sha256: restrictedContentFile.sha256,
  sri: restrictedContentFile.sri,
});
// hover 預覽卡按需塊：只有指針真的停在題號或使用者名上才拉。
const hoverCardResult = await buildBrowser({
  absWorkingDir: root,
  entryPoints: ["src/cdn/hover-card-bundle.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  minify: true,
  treeShaking: true,
  write: false,
});
if (hoverCardResult.outputFiles?.length !== 1)
  throw new Error("Expected one hover card bundle output");
const hoverCardBody = Buffer.from(hoverCardResult.outputFiles[0].contents);
const hoverCardRelativePath = `feature/hover-card.${digest(hoverCardBody).slice(0, 16)}.js`;
outputFiles.set(hoverCardRelativePath, hoverCardBody);
const hoverCardFile = fileRecord(
  `releases/${version}/${hoverCardRelativePath}`,
  hoverCardBody,
);
const hoverCardBundle = Object.freeze({
  apiVersion: 1,
  path: hoverCardFile.path,
  bytes: hoverCardFile.bytes,
  gzipBytes: gzipSync(hoverCardBody, { level: 9 }).length,
  sha256: hoverCardFile.sha256,
  sri: hoverCardFile.sri,
});
const compatEarlyGate = await buildCompat(
  "src/cdn/early-gate-entry.js",
  "early-gate",
);
const compatRuntime = await buildCompat(
  "src/cdn/runtime-entry.js",
  "runtime",
  {
    __LUOGUSP_MARKDOWN_RENDERER_BUNDLE__: JSON.stringify(
      markdownRendererBundle,
    ),
    __LUOGUSP_RESTRICTED_CONTENT_BUNDLE__: JSON.stringify(
      restrictedContentBundle,
    ),
    __LUOGUSP_HOVER_CARD_BUNDLE__: JSON.stringify(hoverCardBundle),
    __LUOGUSP_CDN_ORIGIN__: JSON.stringify(
      cdnOrigin,
    ),
  },
);

const esmEntryPoints = {
  "canary-loader": "src/cdn/canary-loader.js",
  "early-gate-api": "src/bootstrap/restricted-early-gate.js",
  "app-core": "src/cdn/app-core.js",
  settings: "src/features/settings/feature.js",
  "problem-color": "src/features/problem-color/feature.js",
  "hidden-intro": "src/features/hidden-intro/feature.js",
  "ide-batch": "src/features/ide-batch/feature.js",
  "restricted-content": "src/features/restricted-content/feature.js",
};
const esmResult = await buildBrowser({
  absWorkingDir: root,
  entryPoints: esmEntryPoints,
  outdir: "cdn-build",
  entryNames: "esm/[name]-[hash]",
  chunkNames: "esm/chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  charset: "utf8",
  legalComments: "inline",
  minify: true,
  treeShaking: true,
  metafile: true,
  write: false,
});

const outputRoot = resolve(root, "cdn-build");
const files = {
  [compatEarlyGate.path]: compatEarlyGate,
  [compatRuntime.path]: compatRuntime,
  [markdownRendererFile.path]: markdownRendererFile,
  [restrictedContentFile.path]: restrictedContentFile,
  [hoverCardFile.path]: hoverCardFile,
};
for (const output of esmResult.outputFiles || []) {
  const relativePath = normalizePath(relative(outputRoot, output.path));
  if (relativePath.startsWith("../"))
    throw new Error(`Unexpected ESM output path: ${output.path}`);
  const body = Buffer.from(output.contents);
  outputFiles.set(relativePath, body);
  const deploymentPath = `releases/${version}/${relativePath}`;
  files[deploymentPath] = fileRecord(deploymentPath, body);
}

const entryBySource = new Map(
  Object.entries(esmEntryPoints).map(([name, source]) => [
    normalizePath(source),
    name,
  ]),
);
const esmEntries = {};
for (const [outputPath, metadata] of Object.entries(
  esmResult.metafile.outputs,
)) {
  if (!metadata.entryPoint) continue;
  const entry = entryBySource.get(normalizePath(metadata.entryPoint));
  if (!entry)
    throw new Error(`Unknown ESM entry point: ${metadata.entryPoint}`);
  esmEntries[entry] = `releases/${version}/${normalizePath(
    relative("cdn-build", outputPath),
  )}`;
}

const manifest = {
  schemaVersion: 3,
  release: version,
  loaderApiVersion: 1,
  generatedAt: existingRelease?.manifest.generatedAt || new Date().toISOString(),
  origin: cdnOrigin,
  compat: {
    earlyGate: compatEarlyGate,
    runtime: compatRuntime,
  },
  optionalBundles: {
    markdownRenderer: markdownRendererBundle,
    restrictedContent: restrictedContentBundle,
    hoverCard: hoverCardBundle,
  },
  esm: {
    enabled: false,
    status: "canary",
    entries: esmEntries,
  },
  files,
};
if (verifyExisting) {
  if (JSON.stringify(existingRelease.manifest) !== JSON.stringify(manifest))
    throw new Error(
      `Cannot resume CDN release ${version}: current source build differs from the existing immutable release; increase @version`,
    );
  try {
    const channelBody = await readRegularFile(resolve(root, channelFile ?? "cdn/channels/canary.json"));
    parseCanaryChannel(channelBody, { version, origin: cdnOrigin, release: existingRelease });
  } catch (error) {
    throw new Error(
      `Cannot resume CDN release ${version}: local manifest or canary channel integrity failed`,
      { cause: error },
    );
  }
  console.log(
    `Verified existing immutable CDN release ${version} against the current source build.`,
  );
  process.exit(0);
}
const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const manifestSha256 = digest(manifestBody);
const manifestPath = `releases/${version}/manifest.${manifestSha256.slice(0, 16)}.json`;
outputFiles.set("manifest.json", manifestBody);
outputFiles.set(`manifest.${manifestSha256.slice(0, 16)}.json`, manifestBody);

const channel = {
  schemaVersion: 2,
  channel: "canary",
  release: version,
  manifestPath,
  manifestSha256,
  origin: manifest.origin,
  updatedAt: new Date().toISOString(),
};
const transaction = dryRun ? undefined : await writeRelease({
  releasesRoot,
  version,
  channelPath: resolve(channelsRoot, "canary.json"),
  channelBody: `${JSON.stringify(channel, null, 2)}\n`,
  files: outputFiles,
});

console.log(
  JSON.stringify(
    {
      release: version,
      dryRun,
      releaseDir: normalizePath(relative(root, releaseDir)),
      manifestPath,
      manifestSha256,
      transaction,
      compat: manifest.compat,
      optionalBundles: manifest.optionalBundles,
      esmEntries,
      files: Object.keys(files).length,
      bytes: Object.values(files).reduce(
        (total, file) => total + file.bytes,
        0,
      ),
    },
    null,
    2,
  ),
);
