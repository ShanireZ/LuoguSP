import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { resolveBootstrapOrigin } from "../cdn/origin-policy.mjs";
import { createQaStagedMetadata } from "../cdn/userscript-stage-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const version = argument("--version");
if (!/^\d+\.\d+\.\d+-canary\.[0-9A-Za-z.-]+$/.test(version || ""))
  throw new Error("Pass a canary release version with --version");

const releaseRoot = resolve(root, "cdn/releases");
const releaseDirectory = resolve(releaseRoot, version);
if (
  releaseDirectory === releaseRoot ||
  !releaseDirectory.startsWith(`${releaseRoot}${sep}`)
)
  throw new Error("Refusing to read outside cdn/releases");

const [metadata, manifestText, configText] =
  await Promise.all([
    readFile(resolve(root, "src/userscript.meta.js"), "utf8"),
    readFile(resolve(releaseDirectory, "manifest.json"), "utf8"),
    readFile(resolve(root, "config/cdn.json"), "utf8"),
  ]);
const manifest = JSON.parse(manifestText);
const config = JSON.parse(configText);
const staged = createQaStagedMetadata({
  metadata,
  version,
  compatibilityOrigin: resolveBootstrapOrigin(config),
  manifest,
});

const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/cdn/loader-entry.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  minify: true,
  treeShaking: true,
  banner: { js: staged.metadata.trimEnd() },
  write: false,
});
if (result.outputFiles?.length !== 1)
  throw new Error("Expected one QA userscript output");

const outputDirectory = resolve(root, "dist/qa");
const outputPath = resolve(
  outputDirectory,
  `LuoguSP-QA.${version}.user.js`,
);
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, result.outputFiles[0].contents);
console.log(
  JSON.stringify(
    {
      release: version,
      output: outputPath,
      bytes: result.outputFiles[0].contents.length,
      firstParty: staged.firstParty,
      requires: staged.requires.length,
      qaIdentity: true,
      productionModified: false,
    },
    null,
    2,
  ),
);
