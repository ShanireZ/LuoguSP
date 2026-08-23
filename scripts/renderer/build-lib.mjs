import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ESBUILD_BASELINE_TARGETS } from "../../baseline-targets.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const sha256 = (body) => createHash("sha256").update(body).digest("hex");

export const sri = (body) =>
  `sha256-${createHash("sha256").update(body).digest("base64")}`;

export async function buildMarkdownRenderer({ root = defaultRoot } = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/rendering/markdown-renderer-entry.js"],
    outfile: "markdown-renderer.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ESBUILD_BASELINE_TARGETS,
    charset: "utf8",
    legalComments: "inline",
    minify: true,
    treeShaking: true,
    write: false,
  });
  if (result.outputFiles?.length !== 1)
    throw new Error("Expected one markdown renderer bundle");
  return Buffer.from(result.outputFiles[0].contents);
}
