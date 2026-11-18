import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../baseline-targets.mjs";
import { resolveSupportedOrigins } from "./cdn/origin-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "LuoguSP.user.js");
const metadataPath = resolve(root, "src/userscript.meta.js");
const configPath = resolve(root, "config/cdn.json");
const checkOnly = process.argv.includes("--check");

const [metadataText, configText] = await Promise.all([
  readFile(metadataPath, "utf8"),
  readFile(configPath, "utf8"),
]);
const metadata = metadataText.trimEnd();
const config = JSON.parse(configText);
if (
  !metadata.startsWith("// ==UserScript==") ||
  !metadata.endsWith("// ==/UserScript==")
)
  throw new Error("src/userscript.meta.js must contain one userscript header");

const requireUrls = [
  ...metadata.matchAll(/^\/\/ @require\s+(\S+)$/gm),
].map((match) => match[1]);
const supportedOrigins = new Set(resolveSupportedOrigins(config));
const firstPartyRequires = requireUrls.filter((value) => {
  const url = new URL(value);
  return (
    supportedOrigins.has(url.origin) &&
    url.pathname.startsWith("/releases/")
  );
});
if (firstPartyRequires.length !== 2)
  throw new Error(
    "Production metadata must contain two first-party CDN @require entries",
  );
if (
  firstPartyRequires.some(
    (value) => !/#sha256=[a-f0-9]{64}$/.test(value),
  )
)
  throw new Error("First-party CDN @require entries must pin SHA-256");
const entryPoint = "src/cdn/loader-entry.js";

const result = await buildBrowser({
  absWorkingDir: root,
  entryPoints: [entryPoint],
  outfile: "LuoguSP.user.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  minify: true,
  treeShaking: true,
  banner: { js: metadata },
  write: false,
});

if (!result.outputFiles || result.outputFiles.length !== 1)
  throw new Error("Expected esbuild to produce exactly one userscript");

const generated = result.outputFiles[0].contents;
if (checkOnly) {
  const committed = await readFile(outputPath);
  if (!committed.equals(generated)) {
    console.error(
      "LuoguSP.user.js is stale. Run `pnpm build` and commit the result.",
    );
    process.exitCode = 1;
  } else {
    console.log("LuoguSP.user.js matches a clean reproducible build.");
  }
} else {
  await writeFile(outputPath, generated);
  console.log(`Built LuoguSP.user.js from ${entryPoint}.`);
}
