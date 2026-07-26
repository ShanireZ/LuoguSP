import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roundsArgument = process.argv.find((value) =>
  value.startsWith("--rounds="),
);
const rounds = Math.max(
  2,
  Number(roundsArgument ? roundsArgument.split("=")[1] : 6) || 6,
);
const writeReport = process.argv.includes("--write-report");
const remoteCommit = execFileSync(
  "git",
  ["rev-parse", "origin/main"],
  { cwd: root, encoding: "utf8" },
).trim();

const targets = [
  {
    id: "gitee-raw-main",
    url: "https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js",
    mutability: "branch",
  },
  {
    id: "github-raw-main",
    url: "https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js",
    mutability: "branch",
  },
  {
    id: "jsdelivr-github-commit",
    url: `https://cdn.jsdelivr.net/gh/ShanireZ/LuoguSP@${remoteCommit}/LuoguSP.user.js`,
    mutability: "immutable-commit",
  },
  {
    id: "jsdelivr-github-main",
    url: "https://cdn.jsdelivr.net/gh/ShanireZ/LuoguSP@main/LuoguSP.user.js",
    mutability: "branch",
  },
];

const extraUrls = (process.env.LUOGUSP_BENCHMARK_EXTRA_URLS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
extraUrls.forEach((url, index) =>
  targets.push({
    id: `extra-${index + 1}`,
    url,
    mutability: "caller-supplied",
  }),
);

const results = [];
for (const target of targets) {
  const samples = [];
  for (let round = 0; round < rounds; round++) {
    const startedAt = performance.now();
    try {
      const response = await fetch(target.url, {
        signal: AbortSignal.timeout(15000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      samples.push({
        round: round + 1,
        ok: response.ok,
        status: response.status,
        durationMs: performance.now() - startedAt,
        bodyBytes: body.length,
        contentLength: response.headers.get("content-length"),
        contentEncoding: response.headers.get("content-encoding"),
        cacheControl: response.headers.get("cache-control"),
        age: response.headers.get("age"),
        server: response.headers.get("server"),
        via: response.headers.get("via"),
      });
    } catch (error) {
      samples.push({
        round: round + 1,
        ok: false,
        durationMs: performance.now() - startedAt,
        error: String(error),
      });
    }
  }
  const successful = samples
    .filter((sample) => sample.ok)
    .map((sample) => sample.durationMs)
    .sort((a, b) => a - b);
  const warm = samples
    .slice(1)
    .filter((sample) => sample.ok)
    .map((sample) => sample.durationMs)
    .sort((a, b) => a - b);
  results.push({
    ...target,
    firstRequestMs: samples[0]?.durationMs ?? null,
    medianMs:
      successful[Math.floor(successful.length / 2)] ?? null,
    warmMedianMs: warm[Math.floor(warm.length / 2)] ?? null,
    successCount: successful.length,
    rounds,
    samples,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    remoteCommit,
    note: "Single-machine preflight only; not a multi-ISP or nationwide benchmark.",
  },
  results,
};

if (writeReport) {
  await mkdir(resolve(root, "reports"), { recursive: true });
  await writeFile(
    resolve(root, "reports/cdn-origin-preflight.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

console.log(
  JSON.stringify(
    {
      environment: report.environment,
      results: results.map(
        ({
          id,
          url,
          mutability,
          firstRequestMs,
          medianMs,
          warmMedianMs,
          successCount,
          rounds,
        }) => ({
          id,
          url,
          mutability,
          firstRequestMs,
          medianMs,
          warmMedianMs,
          successCount,
          rounds,
        }),
      ),
    },
    null,
    2,
  ),
);
