import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandInvocation } from "./command-invocation.mjs";
import { assertCliBaseline } from "./cli-baseline.mjs";
import { resolveConfiguredOrigin } from "./origin-policy.mjs";

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
if (
  !version ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
)
  throw new Error("Pass --version to publish an immutable CDN release");

const npmCache = resolve(root, ".npm-cache");
await mkdir(npmCache, { recursive: true });
const environment = {
  ...process.env,
  npm_config_cache: npmCache,
  WRANGLER_LOG_PATH: resolve(npmCache, "wrangler.log"),
};
const invoke = (command, args) => {
  const [executable, invocationArgs] = commandInvocation(command, args);
  const result = spawnSync(executable, invocationArgs, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { result, output: `${result.stdout || ""}${result.stderr || ""}` };
};
const run = (command, args) => {
  const { result, output } = invoke(command, args);
  process.stdout.write(output);
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${
        result.error?.message || `exit ${result.status}`
      }`,
    );
};
const capture = (command, args) => {
  const { result, output } = invoke(command, args);
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
// 全局 wrangler（工作区约定），发布前先把它的版本量一次并对下限断言 ——
// 理由见 scripts/cdn/cli-baseline.mjs：产物不可变，不能用行为未知的 CLI 去传。
const wranglerVersion = assertCliBaseline({
  name: "wrangler",
  output: capture("wrangler", ["--version"]),
  minimum: config.cli.wrangler.minimum,
});
process.stdout.write(
  `wrangler ${wranglerVersion} (global, baseline ${config.cli.wrangler.minimum})\n`,
);
run("wrangler", [
  "deploy",
  "--config",
  "deploy/cloudflare/wrangler.jsonc",
]);

const origin = resolveConfiguredOrigin({
  config,
  originOverride: argument("--origin"),
});
const report = {
  publishedAt: new Date().toISOString(),
  release: version,
  target: "cloudflare-workers",
  project: config.projects.cloudflare,
  origin,
  platformDefaultDomainsUsed: false,
};
await writeFile(
  resolve(root, "reports/cdn-publish.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
run("node", [
  "scripts/cdn/verify.mjs",
  "--origin",
  origin,
]);
console.log(`Published ${version} to Cloudflare Workers at ${origin}`);
