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
const skipBrowserQa = process.argv.includes("--skip-browser-qa");
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

const [
  artifact,
  metadata,
  budgetText,
  browserQaText,
] = await Promise.all([
  readFile(resolve(root, "LuoguSP.user.js")),
  readFile(resolve(root, "src/userscript.meta.js"), "utf8"),
  readFile(resolve(root, "config/quality-budget.json"), "utf8"),
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
const metadataVersion =
  metadata.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
if (!/^\d+\.\d+\.\d+$/.test(metadataVersion || ""))
  throw new Error("CDN-backed metadata must use a stable version");
const manifest = JSON.parse(
  await readFile(
    resolve(
      root,
      `cdn/releases/${metadataVersion}/manifest.json`,
    ),
    "utf8",
  ),
);
if (
  manifest.release !== metadataVersion ||
  manifest.esm?.enabled !== false
)
  throw new Error("Production CDN manifest is not stable");
const releaseOrigin = new URL(manifest.origin).origin;
const localResource = async (file, { integrityFragment = true } = {}) => {
  const body = await readFile(resolve(root, "cdn", file.path));
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (
    body.length !== file.bytes ||
    sha256 !== file.sha256
  )
    throw new Error(`Local CDN artifact hash drift: ${file.path}`);
  const url = new URL(
    file.path,
    `${releaseOrigin.replace(/\/+$/, "")}/`,
  ).toString();
  return {
    url: integrityFragment
      ? `${url}#sha256=${file.sha256}`
      : url,
    bytes: body.length,
    gzipBytes: gzipSync(body, { level: 9 }).length,
    sha256,
  };
};
const expectedStartupResources = [
  await localResource(manifest.compat.earlyGate),
  await localResource(manifest.compat.runtime),
];
const expectedRequireUrls = expectedStartupResources.map(
  (resource) => resource.url,
);
const rendererDescriptor =
  manifest.optionalBundles?.markdownRenderer;
const rendererFile =
  rendererDescriptor?.path &&
  manifest.files?.[rendererDescriptor.path];
if (
  !rendererDescriptor ||
  !rendererFile ||
  rendererDescriptor.apiVersion !== 1 ||
  rendererDescriptor.path !== rendererFile.path ||
  rendererDescriptor.bytes !== rendererFile.bytes ||
  rendererDescriptor.sha256 !== rendererFile.sha256 ||
  rendererDescriptor.sri !== rendererFile.sri
)
  throw new Error(
    "Production manifest does not pin a complete optional renderer",
  );
// 受限内容按需块。正式版产物指向的 release 可能还没有这个块（2.14.0 之前都没有），
// 所以这里按「清单声明了才校验」处理；块必须存在这件事由
// test/restricted-lazy-bundle.test.mjs 的结构守卫无条件盯着。
const restrictedDescriptor = manifest.optionalBundles?.restrictedContent || null;
const restrictedFile =
  restrictedDescriptor?.path && manifest.files?.[restrictedDescriptor.path];
if (restrictedDescriptor && !restrictedFile)
  throw new Error(
    "Production manifest declares a restricted content bundle it does not pin",
  );
if (
  restrictedDescriptor &&
  (restrictedDescriptor.apiVersion !== 1 ||
    restrictedDescriptor.bytes !== restrictedFile.bytes ||
    restrictedDescriptor.sha256 !== restrictedFile.sha256 ||
    restrictedDescriptor.sri !== restrictedFile.sri)
)
  throw new Error(
    "Production manifest does not pin a complete restricted content bundle",
  );
const expectedOptionalRestrictedContent = restrictedDescriptor
  ? {
      ...(await localResource(restrictedFile, { integrityFragment: false })),
      apiVersion: restrictedDescriptor.apiVersion,
      declaredGzipBytes: restrictedDescriptor.gzipBytes,
    }
  : null;
if (
  expectedOptionalRestrictedContent &&
  expectedOptionalRestrictedContent.gzipBytes !==
    expectedOptionalRestrictedContent.declaredGzipBytes
)
  throw new Error("Optional restricted content gzip size drift");

// hover 卡按需块：同 restrictedContent，「清单声明了才校验」。
const hoverDescriptor = manifest.optionalBundles?.hoverCard || null;
const hoverFile =
  hoverDescriptor?.path && manifest.files?.[hoverDescriptor.path];
if (hoverDescriptor && !hoverFile)
  throw new Error(
    "Production manifest declares a hover card bundle it does not pin",
  );
if (
  hoverDescriptor &&
  (hoverDescriptor.apiVersion !== 1 ||
    hoverDescriptor.bytes !== hoverFile.bytes ||
    hoverDescriptor.sha256 !== hoverFile.sha256 ||
    hoverDescriptor.sri !== hoverFile.sri)
)
  throw new Error(
    "Production manifest does not pin a complete hover card bundle",
  );
const expectedOptionalHoverCard = hoverDescriptor
  ? {
      ...(await localResource(hoverFile, { integrityFragment: false })),
      apiVersion: hoverDescriptor.apiVersion,
      declaredGzipBytes: hoverDescriptor.gzipBytes,
    }
  : null;
if (
  expectedOptionalHoverCard &&
  expectedOptionalHoverCard.gzipBytes !==
    expectedOptionalHoverCard.declaredGzipBytes
)
  throw new Error("Optional hover card gzip size drift");

// ★★★ 这道门原先**只量正式版产物**（按 `LuoguSP.user.js` 的 @version 取 manifest），
// canary 完全不在测量范围内。后果在 2026-08-14 真实发生过两次：
//   一次是启动 @require 超预算 4601 B 零症状地过了两轮；
//   一次是 hover 块超预算 76 B 发出去了，`quality budgets passed` 照样打印。
// 「永远红不了的门等于没有门」—— 所以这里把**当前 canary 频道**的可选块也量进来。
// ★ 判据仍是「清单声明了就必须钉全」而不是「必须存在」：没有 canary 频道就跳过。
const canaryOptionalBundles = await (async () => {
  let channel;
  try {
    channel = JSON.parse(
      await readFile(resolve(root, "cdn/channels/canary.json"), "utf8"),
    );
  } catch (error) {
    return null;
  }
  if (!channel || typeof channel.manifestPath !== "string") return null;
  let canaryManifest;
  try {
    canaryManifest = JSON.parse(
      await readFile(resolve(root, "cdn", channel.manifestPath), "utf8"),
    );
  } catch (error) {
    return null;
  }
  const bundles = canaryManifest.optionalBundles || {};
  const measured = {};
  for (const [name, descriptor] of Object.entries(bundles)) {
    const file = descriptor?.path && canaryManifest.files?.[descriptor.path];
    if (!file)
      throw new Error(
        `Canary manifest declares a ${name} bundle it does not pin`,
      );
    measured[name] = await localResource(file, { integrityFragment: false });
  }
  return { release: channel.release, bundles: measured };
})();

const expectedOptionalRenderer = {
  ...(await localResource(rendererFile, {
    integrityFragment: false,
  })),
  apiVersion: rendererDescriptor.apiVersion,
  declaredGzipBytes: rendererDescriptor.gzipBytes,
  dependencies: rendererDescriptor.dependencies,
};
if (
  expectedOptionalRenderer.gzipBytes !==
  expectedOptionalRenderer.declaredGzipBytes
)
  throw new Error("Optional renderer gzip size drift");

const fetchResource = async (url) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (!response.ok) {
        lastError = new Error(
          `Unable to fetch CDN resource ${response.status}: ${url}`,
        );
        if (response.status < 500 || attempt === 5)
          throw lastError;
        continue;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 5)
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, attempt * 250),
        );
    }
  }
  throw lastError;
};

let startupResources = expectedStartupResources;
let optionalRenderer = expectedOptionalRenderer;
if (fetchRequires) {
  startupResources = await Promise.all(
    requireUrls.map(async (url) => {
      const body = await fetchResource(url);
      return {
        url,
        bytes: body.length,
        gzipBytes: gzipSync(body, { level: 9 }).length,
        sha256: createHash("sha256").update(body).digest("hex"),
      };
    }),
  );
  const rendererBody = await fetchResource(
    expectedOptionalRenderer.url,
  );
  optionalRenderer = {
    ...expectedOptionalRenderer,
    bytes: rendererBody.length,
    gzipBytes: gzipSync(rendererBody, { level: 9 }).length,
    sha256: createHash("sha256")
      .update(rendererBody)
      .digest("hex"),
  };
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
    status: browserQa.status || "unknown",
    checkedAt: browserQa.checkedAt,
    artifactSha256: browserQa.artifactSha256,
    maxStartupMs: Math.max(
      ...browserQa.startupMeasurements.map((sample) => sample.ms),
    ),
    luoguSpConsoleErrorCount: browserQa.console.luoguSpErrorCount,
    failures: Array.isArray(browserQa.failures)
      ? browserQa.failures.map(
          (failure) => failure.summary || failure.id || String(failure),
        )
      : [],
  },
  startupRequires: {
    count: requireUrls.length,
    totalBytes: startupResources.reduce(
      (total, resource) => total + resource.bytes,
      0,
    ),
    totalGzipBytes: startupResources.reduce(
      (total, resource) => total + resource.gzipBytes,
      0,
    ),
    resources: startupResources,
    measuredOnline: fetchRequires,
  },
  optionalRestrictedContent: expectedOptionalRestrictedContent,
  optionalHoverCard: expectedOptionalHoverCard,
  canaryOptionalBundles,
  optionalRenderer: {
    ...optionalRenderer,
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
  if (!skipBrowserQa) {
    if (report.browserQa.status !== "passed")
      failures.push(
        `browser QA status ${report.browserQa.status}: ${
          report.browserQa.failures.join("; ") ||
          "no passing browser QA report"
        }`,
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
  }
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
  if (
    JSON.stringify(requireUrls) !==
    JSON.stringify(expectedRequireUrls)
  )
    failures.push(
      "@require URLs differ from the pinned production manifest",
    );
  if (
    report.startupRequires.count !==
    budget.startupRequires.count
  )
    failures.push(
      `startup @require count ${report.startupRequires.count} != ${budget.startupRequires.count}`,
    );
  if (
    report.startupRequires.totalBytes >
    budget.startupRequires.maxTotalBytes
  )
    failures.push(
      `startup @require bytes ${report.startupRequires.totalBytes} > ${budget.startupRequires.maxTotalBytes}`,
    );
  if (
    report.startupRequires.totalGzipBytes >
    budget.startupRequires.maxTotalGzipBytes
  )
    failures.push(
      `startup @require gzip bytes ${report.startupRequires.totalGzipBytes} > ${budget.startupRequires.maxTotalGzipBytes}`,
    );
  if (
    report.optionalRenderer.bytes >
    budget.optionalRenderer.maxBytes
  )
    failures.push(
      `optional renderer bytes ${report.optionalRenderer.bytes} > ${budget.optionalRenderer.maxBytes}`,
    );
  if (
    report.optionalRenderer.gzipBytes >
    budget.optionalRenderer.maxGzipBytes
  )
    failures.push(
      `optional renderer gzip bytes ${report.optionalRenderer.gzipBytes} > ${budget.optionalRenderer.maxGzipBytes}`,
    );
  if (report.optionalRestrictedContent) {
    if (
      report.optionalRestrictedContent.bytes >
      budget.optionalRestrictedContent.maxBytes
    )
      failures.push(
        `optional restricted content bytes ${report.optionalRestrictedContent.bytes} > ${budget.optionalRestrictedContent.maxBytes}`,
      );
    if (
      report.optionalRestrictedContent.gzipBytes >
      budget.optionalRestrictedContent.maxGzipBytes
    )
      failures.push(
        `optional restricted content gzip bytes ${report.optionalRestrictedContent.gzipBytes} > ${budget.optionalRestrictedContent.maxGzipBytes}`,
      );
  }
  if (report.optionalHoverCard) {
    if (report.optionalHoverCard.bytes > budget.optionalHoverCard.maxBytes)
      failures.push(
        `optional hover card bytes ${report.optionalHoverCard.bytes} > ${budget.optionalHoverCard.maxBytes}`,
      );
    if (
      report.optionalHoverCard.gzipBytes > budget.optionalHoverCard.maxGzipBytes
    )
      failures.push(
        `optional hover card gzip bytes ${report.optionalHoverCard.gzipBytes} > ${budget.optionalHoverCard.maxGzipBytes}`,
      );
  }
  // canary 的可选块走同一套预算。名字→预算键的映射写死，映射不到的块**要报出来**，
  // 否则新增一个块又会变成「没人量」。
  if (report.canaryOptionalBundles) {
    const budgetKeys = {
      markdownRenderer: "optionalRenderer",
      restrictedContent: "optionalRestrictedContent",
      hoverCard: "optionalHoverCard",
    };
    for (const [name, measured] of Object.entries(
      report.canaryOptionalBundles.bundles,
    )) {
      const key = budgetKeys[name];
      if (!key || !budget[key]) {
        failures.push(`canary bundle ${name} has no budget entry`);
        continue;
      }
      if (measured.bytes > budget[key].maxBytes)
        failures.push(
          `canary ${name} bytes ${measured.bytes} > ${budget[key].maxBytes}`,
        );
      if (measured.gzipBytes > budget[key].maxGzipBytes)
        failures.push(
          `canary ${name} gzip bytes ${measured.gzipBytes} > ${budget[key].maxGzipBytes}`,
        );
    }
  }
  if (fetchRequires) {
    for (const actual of startupResources) {
      const expected = expectedStartupResources.find(
        (resource) => resource.url === actual.url,
      );
      if (
        !expected ||
        expected.bytes !== actual.bytes ||
        expected.gzipBytes !== actual.gzipBytes ||
        (expected.sha256 && expected.sha256 !== actual.sha256)
      )
        failures.push(`@require size drift: ${actual.url}`);
    }
    if (
      optionalRenderer.bytes !== expectedOptionalRenderer.bytes ||
      optionalRenderer.gzipBytes !==
        expectedOptionalRenderer.gzipBytes ||
      optionalRenderer.sha256 !==
        expectedOptionalRenderer.sha256
    )
      failures.push(
        `optional renderer drift: ${optionalRenderer.url}`,
      );
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
    `artifact=${report.artifact.bytes}B gzip=${report.artifact.gzipBytes}B parse-median=${report.artifact.parseMedianMs.toFixed(3)}ms browser-startup-max=${skipBrowserQa ? "deferred" : `${report.browserQa.maxStartupMs.toFixed(3)}ms`} create-app=${report.architecture.createAppLines} lines startup-requires=${report.startupRequires.count}/${report.startupRequires.totalBytes}B optional-renderer=${report.optionalRenderer.bytes}B`,
  );
}
