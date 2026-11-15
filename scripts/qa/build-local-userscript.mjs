import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ESBUILD_BASELINE_TARGETS } from "../../baseline-targets.mjs";

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
  async function bundle(name, entry) {
    const text = await compile(entry, "esm");
    const sha256 = createHash("sha256").update(text).digest("hex");
    const path = `releases/${version}/feature/${name}.${sha256.slice(0, 16)}.js`;
    assets[`${origin}/${path}`] = text;
    return { path, sha256, apiVersion: 1 };
  }
  const [hover, restricted] = await Promise.all([
    bundle("hover-card", "src/cdn/hover-card-bundle.js"),
    bundle("restricted-content", "src/cdn/restricted-content-bundle.js"),
  ]);
  const runtime = await compile("src/cdn/runtime-entry.js", "iife", {
    define: {
      __LUOGUSP_CDN_RELEASE__: JSON.stringify(version),
      __LUOGUSP_CDN_ORIGIN__: JSON.stringify(origin),
      __LUOGUSP_HOVER_CARD_BUNDLE__: JSON.stringify(hover),
      __LUOGUSP_RESTRICTED_CONTENT_BUNDLE__: JSON.stringify(restricted),
      __LUOGUSP_MARKDOWN_RENDERER_BUNDLE__: JSON.stringify(manifest.optionalBundles.markdownRenderer),
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
                  return contents === undefined ? transport.fetchImpl(url, init) :
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
