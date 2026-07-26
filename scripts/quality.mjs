import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const fetchRequires = process.argv.includes("--fetch-requires");
const writeReport = process.argv.includes("--write-report");
const normalizePath = (path) => path.split(sep).join("/");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else if (entry.isFile() && entry.name.endsWith(".js")) paths.push(path);
  }
  return paths;
}

function sourceMetrics(source) {
  const lines = source.split(/\r?\n/);
  const branchPattern =
    /\b(?:if|for|while|case|catch)\b|&&|\|\||\?(?![?.])/g;
  const functionPattern =
    /\bfunction\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;
  return {
    lines: lines.length,
    nonBlankLines: lines.filter((line) => line.trim()).length,
    functions: (source.match(functionPattern) || []).length,
    branchPoints: (source.match(branchPattern) || []).length,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const [artifact, metadata, budgetText, browserQaText] = await Promise.all([
  readFile(resolve(root, "LuoguSP.user.js")),
  readFile(resolve(root, "src/userscript.meta.js"), "utf8"),
  readFile(resolve(root, "quality-budget.json"), "utf8"),
  readFile(resolve(root, "reports/browser-qa.json"), "utf8"),
]);
const budget = JSON.parse(budgetText);
const browserQa = JSON.parse(browserQaText);
const artifactText = artifact.toString("utf8");
const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
const parseSamples = [];
for (let index = 0; index < 25; index++) {
  const start = performance.now();
  new Script(artifactText);
  parseSamples.push(performance.now() - start);
}

const sourcePaths = await walk(resolve(root, "src"));
const files = [];
for (const path of sourcePaths) {
  const source = await readFile(path, "utf8");
  const info = await stat(path);
  files.push({
    path: normalizePath(relative(root, path)),
    bytes: info.size,
    ...sourceMetrics(source),
  });
}

const featureDirectories = {};
for (const file of files) {
  const match = file.path.match(/^src\/features\/([^/]+)\//);
  if (!match) continue;
  const feature =
    featureDirectories[match[1]] ||
    (featureDirectories[match[1]] = {
      files: 0,
      bytes: 0,
      lines: 0,
      nonBlankLines: 0,
      functions: 0,
      branchPoints: 0,
    });
  feature.files++;
  feature.bytes += file.bytes;
  feature.lines += file.lines;
  feature.nonBlankLines += file.nonBlankLines;
  feature.functions += file.functions;
  feature.branchPoints += file.branchPoints;
}

const coreBrowserGlobalReferences = [];
for (const file of files.filter((item) => item.path.startsWith("src/core/"))) {
  const source = await readFile(resolve(root, file.path), "utf8");
  for (const match of source.matchAll(
    /\b(?:window|document|localStorage)\s*(?:\.|\[)/g,
  )) {
    coreBrowserGlobalReferences.push({
      path: file.path,
      offset: match.index,
      token: match[0],
    });
  }
}

const requireUrls = [
  ...metadata.matchAll(/^\/\/ @require\s+(\S+)$/gm),
].map((match) => match[1]);
let requireResources = budget.requires.resources;
if (fetchRequires) {
  requireResources = await Promise.all(
    requireUrls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Unable to fetch @require ${response.status}: ${url}`);
      const body = Buffer.from(await response.arrayBuffer());
      return {
        url,
        bytes: body.length,
        gzipBytes: gzipSync(body, { level: 9 }).length,
      };
    }),
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  artifact: {
    sha256: artifactSha256,
    bytes: artifact.length,
    gzipBytes: gzipSync(artifact, { level: 9 }).length,
    lines: artifactText.split(/\r?\n/).length,
    parseMedianMs: median(parseSamples),
  },
  browserQa: {
    checkedAt: browserQa.checkedAt,
    artifactSha256: browserQa.artifactSha256,
    maxStartupMs: Math.max(
      ...browserQa.startupMeasurements.map((sample) => sample.ms),
    ),
    luoguSpConsoleErrorCount: browserQa.console.luoguSpErrorCount,
  },
  requires: {
    count: requireUrls.length,
    totalBytes: requireResources.reduce(
      (total, resource) => total + resource.bytes,
      0,
    ),
    totalGzipBytes: requireResources.reduce(
      (total, resource) => total + resource.gzipBytes,
      0,
    ),
    resources: requireResources,
    measuredOnline: fetchRequires,
  },
  architecture: {
    createAppLines:
      files.find(
        (file) => file.path === "src/app/create-luogusp-app.js",
      )?.lines || 0,
    maxFeatureFileLines: Math.max(
      ...files
        .filter((file) => file.path.startsWith("src/features/"))
        .map((file) => file.lines),
    ),
    coreBrowserGlobalReferences,
    featureDirectories,
  },
  sourceFiles: files,
};

if (writeReport) {
  await mkdir(resolve(root, "reports"), { recursive: true });
  await writeFile(
    resolve(root, "reports/quality-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

if (check) {
  const failures = [];
  if (report.artifact.bytes > budget.artifact.maxBytes)
    failures.push(
      `artifact bytes ${report.artifact.bytes} > ${budget.artifact.maxBytes}`,
    );
  if (report.artifact.gzipBytes > budget.artifact.maxGzipBytes)
    failures.push(
      `artifact gzip bytes ${report.artifact.gzipBytes} > ${budget.artifact.maxGzipBytes}`,
    );
  if (report.artifact.parseMedianMs > budget.artifact.maxParseMedianMs)
    failures.push(
      `parse median ${report.artifact.parseMedianMs.toFixed(3)}ms > ${budget.artifact.maxParseMedianMs}ms`,
    );
  if (report.browserQa.artifactSha256 !== report.artifact.sha256)
    failures.push(
      "browser QA artifact hash differs from the current userscript",
    );
  if (report.browserQa.maxStartupMs > budget.browserQa.maxStartupMs)
    failures.push(
      `browser startup ${report.browserQa.maxStartupMs.toFixed(3)}ms > ${budget.browserQa.maxStartupMs}ms`,
    );
  if (
    report.browserQa.luoguSpConsoleErrorCount >
    budget.browserQa.maxLuoguSpConsoleErrors
  )
    failures.push(
      `browser LuoguSP console errors ${report.browserQa.luoguSpConsoleErrorCount} > ${budget.browserQa.maxLuoguSpConsoleErrors}`,
    );
  if (
    report.architecture.createAppLines >
    budget.architecture.maxCreateAppLines
  )
    failures.push(
      `createLuoguSPApp file lines ${report.architecture.createAppLines} > ${budget.architecture.maxCreateAppLines}`,
    );
  if (
    report.architecture.maxFeatureFileLines >
    budget.architecture.maxFeatureFileLines
  )
    failures.push(
      `feature file lines ${report.architecture.maxFeatureFileLines} > ${budget.architecture.maxFeatureFileLines}`,
    );
  if (
    coreBrowserGlobalReferences.length >
    budget.architecture.maxCoreBrowserGlobalReferences
  )
    failures.push(
      `core browser-global references ${coreBrowserGlobalReferences.length} > ${budget.architecture.maxCoreBrowserGlobalReferences}`,
    );
  const expectedUrls = budget.requires.resources.map(
    (resource) => resource.url,
  );
  if (JSON.stringify(requireUrls) !== JSON.stringify(expectedUrls))
    failures.push("@require URLs differ from quality-budget.json");
  if (fetchRequires) {
    for (const actual of requireResources) {
      const expected = budget.requires.resources.find(
        (resource) => resource.url === actual.url,
      );
      if (
        !expected ||
        expected.bytes !== actual.bytes ||
        expected.gzipBytes !== actual.gzipBytes
      )
        failures.push(`@require size drift: ${actual.url}`);
    }
  }
  if (failures.length) {
    failures.forEach((failure) => console.error(`quality gate: ${failure}`));
    process.exitCode = 1;
  } else {
    console.log("LuoguSP quality budgets passed.");
  }
}

if (!check) console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `artifact=${report.artifact.bytes}B gzip=${report.artifact.gzipBytes}B parse-median=${report.artifact.parseMedianMs.toFixed(3)}ms browser-startup-max=${report.browserQa.maxStartupMs.toFixed(3)}ms create-app=${report.architecture.createAppLines} lines requires=${report.requires.count}/${report.requires.totalBytes}B`,
  );
}
