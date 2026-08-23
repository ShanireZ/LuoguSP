import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { ESBUILD_BASELINE_TARGETS } from "../../baseline-targets.mjs";
import { buildMarkdownRenderer } from "../renderer/build-lib.mjs";
import {
  MARKDOWN_RENDERER_API_VERSION,
  rendererStackDependencies,
} from "../../src/rendering/renderer-dependencies.js";
import { resolveConfiguredOrigin } from "./origin-policy.mjs";

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

if (
  typeof version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
)
  throw new Error(
    "Pass an immutable release version with --version, for example 2.13.0-canary.1",
  );
if (overwrite && verifyExisting)
  throw new Error("--overwrite and --verify-existing cannot be combined");
if (dryRun && (overwrite || verifyExisting))
  throw new Error(
    "--dry-run cannot be combined with --overwrite or --verify-existing",
  );

const releaseDir = resolve(releasesRoot, version);
if (
  releaseDir === releasesRoot ||
  !releaseDir.startsWith(`${releasesRoot}${sep}`)
)
  throw new Error("Refusing to write outside cdn/releases");

let releaseExists = false;
try {
  await stat(releaseDir);
  releaseExists = true;
  if (!dryRun && !overwrite && !verifyExisting)
    throw new Error(
      `CDN release ${version} already exists; release paths are immutable`,
    );
  if (overwrite) await rm(releaseDir, { recursive: true, force: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (verifyExisting && !releaseExists)
  throw new Error(
    `Cannot resume CDN release ${version}: the local immutable release is missing`,
  );
if (!verifyExisting && !dryRun) {
  await mkdir(releaseDir, { recursive: true });
  await mkdir(channelsRoot, { recursive: true });
}

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
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entryPoint],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ESBUILD_BASELINE_TARGETS,
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
  if (!verifyExisting && !dryRun) {
    await mkdir(resolve(releaseDir, "compat"), { recursive: true });
    await writeFile(resolve(releaseDir, relativePath), body);
  }
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
if (!verifyExisting && !dryRun) {
  await mkdir(resolve(releaseDir, "render"), { recursive: true });
  await writeFile(
    resolve(releaseDir, markdownRendererRelativePath),
    markdownRendererBody,
  );
}
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
// 受限内容按需块：启动包里最大的一块（实测 44506 B / 37%），却只在
// 「安全访问中心」拦截页才用得到。拆出来后启动包降到约 83 KB。
const restrictedContentResult = await build({
  absWorkingDir: root,
  entryPoints: ["src/cdn/restricted-content-bundle.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ESBUILD_BASELINE_TARGETS,
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
if (!verifyExisting && !dryRun) {
  await mkdir(resolve(releaseDir, "feature"), { recursive: true });
  await writeFile(
    resolve(releaseDir, restrictedContentRelativePath),
    restrictedContentBody,
  );
}
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
// hover 预览卡按需块：只有指针真的停在题号或用户名上才拉。
const hoverCardResult = await build({
  absWorkingDir: root,
  entryPoints: ["src/cdn/hover-card-bundle.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ESBUILD_BASELINE_TARGETS,
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
if (!verifyExisting && !dryRun) {
  await mkdir(resolve(releaseDir, "feature"), { recursive: true });
  await writeFile(resolve(releaseDir, hoverCardRelativePath), hoverCardBody);
}
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
const esmResult = await build({
  absWorkingDir: root,
  entryPoints: esmEntryPoints,
  outdir: "cdn-build",
  entryNames: "esm/[name]-[hash]",
  chunkNames: "esm/chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ESBUILD_BASELINE_TARGETS,
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
  if (!verifyExisting && !dryRun) {
    await mkdir(dirname(resolve(releaseDir, relativePath)), {
      recursive: true,
    });
    await writeFile(resolve(releaseDir, relativePath), body);
  }
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

const existingManifestBody = verifyExisting
  ? await readFile(resolve(releaseDir, "manifest.json"))
  : null;
const existingManifest = existingManifestBody
  ? JSON.parse(existingManifestBody)
  : null;
const manifest = {
  schemaVersion: 3,
  release: version,
  loaderApiVersion: 1,
  generatedAt: existingManifest?.generatedAt || new Date().toISOString(),
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
  if (JSON.stringify(existingManifest) !== JSON.stringify(manifest))
    throw new Error(
      `Cannot resume CDN release ${version}: current source build differs from the existing immutable release; increase @version`,
    );
  for (const [deploymentPath, record] of Object.entries(files)) {
    const localPath = resolve(root, "cdn", deploymentPath);
    if (
      localPath === releaseDir ||
      !localPath.startsWith(`${releaseDir}${sep}`)
    )
      throw new Error(
        `Cannot resume CDN release ${version}: manifest path escapes the release directory`,
      );
    const body = await readFile(localPath);
    if (
      body.length !== record.bytes ||
      digest(body) !== record.sha256 ||
      sri(body) !== record.sri
    )
      throw new Error(
        `Cannot resume CDN release ${version}: local asset integrity failed for ${deploymentPath}`,
      );
  }
  const existingManifestSha256 = digest(existingManifestBody);
  const existingManifestPath = `releases/${version}/manifest.${existingManifestSha256.slice(0, 16)}.json`;
  const [pinnedManifest, channelBody] = await Promise.all([
    readFile(resolve(root, "cdn", existingManifestPath)),
    readFile(resolve(channelsRoot, "canary.json"), "utf8"),
  ]);
  const channel = JSON.parse(channelBody);
  if (
    !pinnedManifest.equals(existingManifestBody) ||
    channel.release !== version ||
    channel.manifestPath !== existingManifestPath ||
    channel.manifestSha256 !== existingManifestSha256
  )
    throw new Error(
      `Cannot resume CDN release ${version}: local manifest or canary channel integrity failed`,
    );
  console.log(
    `Verified existing immutable CDN release ${version} against the current source build.`,
  );
  process.exit(0);
}
const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const manifestSha256 = digest(manifestBody);
const manifestPath = `releases/${version}/manifest.${manifestSha256.slice(0, 16)}.json`;
if (!dryRun) {
  await writeFile(resolve(releaseDir, "manifest.json"), manifestBody);
  await writeFile(
    resolve(releaseDir, `manifest.${manifestSha256.slice(0, 16)}.json`),
    manifestBody,
  );
}

const channel = {
  schemaVersion: 2,
  channel: "canary",
  release: version,
  manifestPath,
  manifestSha256,
  origin: manifest.origin,
  updatedAt: new Date().toISOString(),
};
if (!dryRun)
  await writeFile(
    resolve(channelsRoot, "canary.json"),
    `${JSON.stringify(channel, null, 2)}\n`,
    "utf8",
  );

console.log(
  JSON.stringify(
    {
      release: version,
      dryRun,
      releaseDir: normalizePath(relative(root, releaseDir)),
      manifestPath,
      manifestSha256,
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
