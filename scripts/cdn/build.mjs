import {
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  dirname,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const releasesRoot = resolve(root, "cdn/releases");
const channelsRoot = resolve(root, "cdn/channels");
const config = JSON.parse(
  await readFile(resolve(root, "config/cdn.json"), "utf8"),
);
const normalizePath = (value) => value.split(sep).join("/");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const version = argument("--version");
const overwrite = process.argv.includes("--overwrite");

if (
  typeof version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
)
  throw new Error(
    "Pass an immutable release version with --version, for example 2.13.0-canary.1",
  );

const releaseDir = resolve(releasesRoot, version);
if (
  releaseDir === releasesRoot ||
  !releaseDir.startsWith(`${releasesRoot}${sep}`)
)
  throw new Error("Refusing to write outside cdn/releases");

try {
  await stat(releaseDir);
  if (!overwrite)
    throw new Error(
      `CDN release ${version} already exists; release paths are immutable`,
    );
  await rm(releaseDir, { recursive: true, force: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(releaseDir, { recursive: true });
await mkdir(channelsRoot, { recursive: true });

const digest = (body) =>
  createHash("sha256").update(body).digest("hex");
const sri = (body) =>
  `sha256-${createHash("sha256").update(body).digest("base64")}`;
const fileRecord = (path, body) =>
  Object.freeze({
    path,
    bytes: body.length,
    sha256: digest(body),
    sri: sri(body),
  });

async function buildCompat(entryPoint, prefix) {
  const result = await build({
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
    },
  });
  if (result.outputFiles?.length !== 1)
    throw new Error(`Expected one ${prefix} compatibility output`);
  const body = Buffer.from(result.outputFiles[0].contents);
  const relativePath =
    `compat/${prefix}.${digest(body).slice(0, 16)}.js`;
  await mkdir(resolve(releaseDir, "compat"), { recursive: true });
  await writeFile(resolve(releaseDir, relativePath), body);
  return fileRecord(
    `releases/${version}/${relativePath}`,
    body,
  );
}

const compatEarlyGate = await buildCompat(
  "src/cdn/early-gate-entry.js",
  "early-gate",
);
const compatRuntime = await buildCompat(
  "src/cdn/runtime-entry.js",
  "runtime",
);

const esmEntryPoints = {
  "canary-loader": "src/cdn/canary-loader.js",
  "early-gate-api": "src/bootstrap/restricted-early-gate.js",
  "app-core": "src/cdn/app-core.js",
  settings: "src/features/settings/feature.js",
  "problem-color": "src/features/problem-color/feature.js",
  "chat-shortcut": "src/features/chat-shortcut/feature.js",
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
};
for (const output of esmResult.outputFiles || []) {
  const relativePath = normalizePath(relative(outputRoot, output.path));
  if (relativePath.startsWith("../"))
    throw new Error(`Unexpected ESM output path: ${output.path}`);
  const body = Buffer.from(output.contents);
  await mkdir(
    dirname(resolve(releaseDir, relativePath)),
    { recursive: true },
  );
  await writeFile(resolve(releaseDir, relativePath), body);
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
  esmEntries[entry] =
    `releases/${version}/${normalizePath(
      relative("cdn-build", outputPath),
    )}`;
}

const manifest = {
  schemaVersion: 1,
  release: version,
  loaderApiVersion: 1,
  generatedAt: new Date().toISOString(),
  origins: [
    config.origins.primary,
    config.origins.fallback,
  ],
  compat: {
    earlyGate: compatEarlyGate,
    runtime: compatRuntime,
  },
  esm: {
    enabled: false,
    status: "canary",
    entries: esmEntries,
  },
  files,
};
const manifestBody = Buffer.from(
  `${JSON.stringify(manifest, null, 2)}\n`,
);
const manifestSha256 = digest(manifestBody);
const manifestPath =
  `releases/${version}/manifest.${manifestSha256.slice(0, 16)}.json`;
await writeFile(resolve(releaseDir, "manifest.json"), manifestBody);
await writeFile(
  resolve(releaseDir, `manifest.${manifestSha256.slice(0, 16)}.json`),
  manifestBody,
);

const channel = {
  schemaVersion: 1,
  channel: "canary",
  release: version,
  manifestPath,
  manifestSha256,
  origins: manifest.origins,
  updatedAt: new Date().toISOString(),
};
await writeFile(
  resolve(channelsRoot, "canary.json"),
  `${JSON.stringify(channel, null, 2)}\n`,
  "utf8",
);

await cp(
  resolve(root, "deploy/edgeone/edgeone.json"),
  resolve(root, "cdn/edgeone.json"),
);
console.log(
  JSON.stringify(
    {
      release: version,
      releaseDir: normalizePath(relative(root, releaseDir)),
      manifestPath,
      manifestSha256,
      compat: manifest.compat,
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
