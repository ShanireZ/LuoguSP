import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildMarkdownRenderer, sha256 } from "./build-lib.mjs";
import { rendererStackDependencies } from "../../src/rendering/renderer-dependencies.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
for (const [name, version] of Object.entries(rendererStackDependencies)) {
  if (packageJson.dependencies?.[name] !== version)
    throw new Error(`Renderer dependency ${name} must be pinned to ${version}`);
}

const first = await buildMarkdownRenderer({ root });
const second = await buildMarkdownRenderer({ root });
if (!first.equals(second))
  throw new Error("Markdown renderer bundle is not reproducible");
const source = first.toString("utf8");
for (const globalName of [
  "window.marked",
  "window.DOMPurify",
  "window.katex",
  "window.hljs",
]) {
  if (source.includes(globalName))
    throw new Error(`Markdown renderer still depends on ${globalName}`);
}

const runtime = await build({
  absWorkingDir: root,
  entryPoints: ["src/cdn/runtime-entry.js"],
  outfile: "runtime.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  metafile: true,
  write: false,
});
const thirdPartyInputs = Object.keys(runtime.metafile.inputs)
  .map((path) => path.replace(/\\/g, "/"))
  .filter((path) =>
    [
      "node_modules/katex/",
      "node_modules/marked/",
      "node_modules/dompurify/",
      "node_modules/highlight.js/",
    ].some((segment) => path.includes(segment)),
  );
if (thirdPartyInputs.length)
  throw new Error(
    `Renderer dependencies leaked into startup runtime: ${thirdPartyInputs.join(", ")}`,
  );

console.log(
  `renderer=${first.length}B sha256=${sha256(first)} runtime-third-party-inputs=0`,
);
