import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalizePath = (path) => path.split(sep).join("/");
const writeReport = process.argv.includes("--write-report");
const virtualEntries = {
  "virtual:early-gate": `
    export { createRestrictedLoadingGate } from "./src/features/restricted-content/loading-gate.js";
  `,
  "virtual:app-core": `
    export { createBrowserRouteAdapter } from "./src/core/browser-route-adapter.js";
    export { createPageLifecycle } from "./src/core/page-lifecycle.js";
    export { defineConfigurableFeature } from "./src/app/feature-descriptor.js";
  `,
};

const result = await build({
  absWorkingDir: root,
  entryPoints: {
    "early-gate": "virtual:early-gate",
    "app-core": "virtual:app-core",
    settings: "src/features/settings/feature.js",
    "problem-color": "src/features/problem-color/feature.js",
      "hidden-intro": "src/features/hidden-intro/feature.js",
    "ide-batch": "src/features/ide-batch/feature.js",
    "restricted-content": "src/features/restricted-content/feature.js",
  },
  outdir: "analysis",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  minify: true,
  treeShaking: true,
  metafile: true,
  write: false,
  plugins: [
    {
      name: "virtual-analysis-entries",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^virtual:/ }, (args) => ({
          path: args.path,
          namespace: "virtual-analysis",
        }));
        buildApi.onLoad(
          { filter: /.*/, namespace: "virtual-analysis" },
          (args) => ({
            contents: virtualEntries[args.path],
            loader: "js",
            resolveDir: root,
          }),
        );
      },
    },
  ],
});

const outputFiles = new Map(
  result.outputFiles.map((file) => {
    const key = normalizePath(relative(root, file.path));
    const body = Buffer.from(file.contents);
    return [
      key,
      {
        path: key,
        bytes: body.length,
        gzipBytes: gzipSync(body, { level: 9 }).length,
      },
    ];
  }),
);

const outputMeta = result.metafile.outputs;
function reachable(entryOutput) {
  const visited = new Set();
  const visit = (path) => {
    if (visited.has(path)) return;
    visited.add(path);
    for (const item of outputMeta[path]?.imports || []) visit(item.path);
  };
  visit(entryOutput);
  return [...visited];
}

const entries = {};
for (const [path, metadata] of Object.entries(outputMeta)) {
  if (!metadata.entryPoint) continue;
  const entryName = path.replace(/^analysis\//, "").replace(/\.js$/, "");
  const paths = reachable(path);
  entries[entryName] = {
    entryPoint: metadata.entryPoint,
    files: paths,
    bytes: paths.reduce(
      (total, outputPath) => total + outputFiles.get(outputPath).bytes,
      0,
    ),
    gzipBytes: paths.reduce(
      (total, outputPath) =>
        total + outputFiles.get(outputPath).gzipBytes,
      0,
    ),
    requestCount: paths.length,
  };
}

const files = [...outputFiles.values()].sort((a, b) =>
  a.path.localeCompare(b.path),
);
const report = {
  generatedAt: new Date().toISOString(),
  model: {
    format: "ESM",
    minified: true,
    splitting: true,
    caveat:
      "Preflight graph only. It does not implement a production loader or include network latency, CSP, SRI, rollback, or Tampermonkey cache behavior.",
  },
  entries,
  files,
  allOutputs: {
    files: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    gzipBytes: files.reduce(
      (total, file) => total + file.gzipBytes,
      0,
    ),
  },
};

if (writeReport) {
  await mkdir(resolve(root, "reports"), { recursive: true });
  await writeFile(
    resolve(root, "reports/cdn-chunk-analysis.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

console.log(JSON.stringify(report, null, 2));
