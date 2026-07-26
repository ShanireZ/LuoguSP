import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(
  await readFile(resolve(root, "config/cdn.json"), "utf8"),
);
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const version = argument("--version");
const skipBuild = process.argv.includes("--skip-build");
const target = argument("--target") || "all";
if (
  !version ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
)
  throw new Error("Pass --version to publish an immutable CDN release");
if (!["all", "edgeone", "cloudflare"].includes(target))
  throw new Error("--target must be all, edgeone, or cloudflare");

const npmCache = resolve(root, ".npm-cache");
await mkdir(npmCache, { recursive: true });
const environment = {
  ...process.env,
  npm_config_cache: npmCache,
  WRANGLER_LOG_PATH: resolve(npmCache, "wrangler.log"),
};
const npmCli = process.env.npm_execpath || null;
const npxCli = npmCli ? resolve(dirname(npmCli), "npx-cli.js") : null;
const invocationFor = (command, args) => {
  if (command === "node")
    return [process.execPath, args];
  if (command === "npx" && npxCli)
    return [process.execPath, [npxCli, ...args]];
  return [command, args];
};
const run = (command, args) => {
  const [executable, invocationArgs] = invocationFor(command, args);
  const result = spawnSync(executable, invocationArgs, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  process.stdout.write(output);
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${
        result.error?.message || `exit ${result.status}`
      }`,
    );
  return output;
};

if (!skipBuild)
  run("node", [
    "scripts/cdn/build.mjs",
    "--version",
    version,
  ]);
run("node", ["scripts/cdn/prepare.mjs"]);

const stripAnsi = (value) =>
  value.replace(/\u001b\[[0-9;]*m/g, "");
const urlsFrom = (value) =>
  [
    ...stripAnsi(value).matchAll(/https:\/\/[^\s"'<>]+/g),
  ].map((match) => match[0].replace(/[),.;]+$/, ""));
const chooseOrigin = (output, predicate) => {
  const candidates = urlsFrom(output);
  for (let index = candidates.length - 1; index >= 0; index--) {
    try {
      const url = new URL(candidates[index]);
      if (predicate(url))
        return `${url.origin}${url.search}`;
    } catch (error) {
      // Ignore decorative or truncated URLs from CLI output.
    }
  }
  return null;
};
const originIsReady = async (value) => {
  const url = new URL("/channels/canary.json", value);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) return true;
    } catch {
      // A newly bound edge domain can need several cold connection attempts.
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 5)
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, attempt * 250),
      );
  }
  return false;
};

let edgeoneOutput = "";
let cloudflareOutput = "";
if (target === "all" || target === "edgeone")
  edgeoneOutput = run("npx", [
    "-y",
    `edgeone@${config.cli.edgeone}`,
    "makers",
    "deploy",
    "./dist/cdn",
    "-n",
    config.projects.edgeone,
    "-e",
    "production",
  ]);
if (target === "all" || target === "cloudflare")
  cloudflareOutput = run("npx", [
    "-y",
    `wrangler@${config.cli.wrangler}`,
    "deploy",
    "--config",
    "deploy/cloudflare/wrangler.jsonc",
  ]);

const requestedPrimary = argument("--primary");
const requestedFallback = argument("--fallback");
const primary =
  requestedPrimary ||
  ((await originIsReady(config.origins.primary))
    ? config.origins.primary
    : chooseOrigin(
        edgeoneOutput,
        (url) =>
          /edgeone|edgeone\.app|pages/i.test(url.hostname) &&
          !/pages\.edgeone\.ai$/i.test(url.hostname),
      )) ||
  config.origins.primary;
const fallback =
  requestedFallback ||
  ((await originIsReady(config.origins.fallback))
    ? config.origins.fallback
    : chooseOrigin(
        cloudflareOutput,
        (url) =>
          url.hostname.endsWith(".workers.dev") ||
          url.hostname === new URL(config.origins.fallback).hostname,
      )) ||
  config.origins.fallback;

const report = {
  publishedAt: new Date().toISOString(),
  release: version,
  target,
  projects: config.projects,
  detectedOrigins: {
    primary: new URL(primary).origin,
    fallback: new URL(fallback).origin,
  },
  previewTokenUsed: {
    primary: Boolean(new URL(primary).search),
    fallback: Boolean(new URL(fallback).search),
  },
};
await writeFile(
  resolve(root, "reports/cdn-publish.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

if (target === "all") {
  run("node", [
    "scripts/cdn/verify.mjs",
    "--primary",
    primary,
    "--fallback",
    fallback,
  ]);
}
console.log(
  `Published ${version}; primary=${primary}; fallback=${fallback}`,
);
