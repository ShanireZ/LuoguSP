import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "LuoguSP.user.js");
const metadataPath = resolve(root, "src/userscript.meta.js");
const checkOnly = process.argv.includes("--check");

const metadata = (await readFile(metadataPath, "utf8")).trimEnd();
if (
  !metadata.startsWith("// ==UserScript==") ||
  !metadata.endsWith("// ==/UserScript==")
)
  throw new Error("src/userscript.meta.js must contain one userscript header");

const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/entry.js"],
  outfile: "LuoguSP.user.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  charset: "utf8",
  legalComments: "inline",
  treeShaking: false,
  banner: { js: metadata },
  metafile: true,
  write: false,
});

if (!result.outputFiles || result.outputFiles.length !== 1)
  throw new Error("Expected esbuild to produce exactly one userscript");

const generated = result.outputFiles[0].contents;
if (checkOnly) {
  const committed = await readFile(outputPath);
  if (!committed.equals(generated)) {
    console.error(
      "LuoguSP.user.js is stale. Run `npm run build` and commit the result.",
    );
    process.exitCode = 1;
  } else {
    console.log("LuoguSP.user.js matches a clean reproducible build.");
  }
} else {
  await writeFile(outputPath, generated);
  console.log("Built LuoguSP.user.js from src/entry.js.");
}
