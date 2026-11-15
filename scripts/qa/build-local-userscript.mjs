import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ESBUILD_BASELINE_TARGETS } from "../../baseline-targets.mjs";
import { MARKDOWN_RENDERER_API_VERSION } from "../../src/rendering/renderer-dependencies.js";
import { buildMarkdownRenderer } from "../renderer/build-lib.mjs";

const root = new URL("../../", import.meta.url);
const buildOptions = {
  absWorkingDir: fileURLToPath(root),
  platform: "browser", target: ESBUILD_BASELINE_TARGETS,
  bundle: true, write: false, minify: true, charset: "utf8", legalComments: "none",
};
const compile = async (entry, format, options) => (await build({
  ...buildOptions, entryPoints: [entry], format, ...options,
})).outputFiles[0].text;

export async function buildLocalUserscript(version = "0.0.0-canary.local") {
  const read = (path) => readFile(new URL(path, root), "utf8");
  const meta = await read("src/userscript.meta.js");
  const stable = /^\/\/ @version\s+(\S+)/m.exec(meta)[1];
  const manifest = JSON.parse(await read(`cdn/releases/${stable}/manifest.json`));
  const { origin } = manifest;
  const assets = Object.create(null);
  function embed(directory, name, text, apiVersion = 1) {
    const sha256 = createHash("sha256").update(text).digest("hex");
    const path = `releases/${version}/${directory}/${name}.${sha256.slice(0, 16)}.js`;
    assets[`${origin}/${path}`] = text;
    return { path, sha256, apiVersion };
  }
  const [hoverSource, restrictedSource, rendererBytes] = await Promise.all([
    compile("src/cdn/hover-card-bundle.js", "esm"),
    compile("src/cdn/restricted-content-bundle.js", "esm"),
    buildMarkdownRenderer(),
  ]);
  const hover = embed("feature", "hover-card", hoverSource);
  const restricted = embed("feature", "restricted-content", restrictedSource);
  const renderer = embed("render", "markdown-renderer", rendererBytes.toString("utf8"), MARKDOWN_RENDERER_API_VERSION);
  const runtime = await compile("src/cdn/runtime-entry.js", "iife", {
    define: {
      __LUOGUSP_CDN_RELEASE__: JSON.stringify(version),
      __LUOGUSP_CDN_ORIGIN__: JSON.stringify(origin),
      __LUOGUSP_HOVER_CARD_BUNDLE__: JSON.stringify(hover),
      __LUOGUSP_RESTRICTED_CONTENT_BUNDLE__: JSON.stringify(restricted),
      __LUOGUSP_MARKDOWN_RENDERER_BUNDLE__: JSON.stringify(renderer),
    },
    plugins: [{
      name: "embed-qa-feature-bundles",
      setup(builder) {
        builder.onLoad({ filter: /runtime-entry\.js$/ }, async () => {
          const source = await read("src/cdn/runtime-entry.js");
          const marker = "const userscriptFetch = createUserscriptFetch();";
          if (!source.includes(marker)) throw new Error("Missing runtime transport declaration");
          return {
            resolveDir: fileURLToPath(new URL("src/cdn/", root)),
            contents: source.replace(marker, () => `
              const transport = createUserscriptFetch();
              const embedded = ${JSON.stringify(assets)};
              const userscriptFetch = {
                ...transport,
                fetchImpl(url, init) {
                  const contents = embedded[String(url)];
                  return contents === undefined ? transport.fetchImpl.call(globalThis, url, init) :
                    Promise.resolve(new Response(contents, { headers: { "content-type": "text/javascript" } }));
                },
              };
            `),
          };
        });
      },
    }],
  });
  const metadata = meta
    .replace(/^\/\/ @name\s+.*$/m, "// @name         LuoguSP Canary (Local)")
    .replace(/^\/\/ @namespace\s+(\S+)/m, "// @namespace    $1/canary/local")
    .replace(/^\/\/ @version\s+.*$/m, `// @version      ${version}`)
    .replace(/^\/\/ @(?:require|updateURL|downloadURL)\s+.*\r?\n/gm, "")
    .replace("// ==/UserScript==", "// @downloadURL  none\n// ==/UserScript==");
  return [metadata.trimEnd(), runtime].join("\n\n");
}
