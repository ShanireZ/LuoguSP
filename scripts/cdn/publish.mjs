import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { commandInvocation } from "./command-invocation.mjs";
import { assertCliBaseline } from "./cli-baseline.mjs";
import { assertCommittedReleases } from "./committed-releases.mjs";
import { resolveConfiguredOrigin } from "./origin-policy.mjs";
import { prepareCdn } from "./prepare-lib.mjs";
import { RELEASE_VERSION, readRegularFile } from "./release-integrity.mjs";

const MAX_CONCURRENT_MANIFEST_CHECKS = 4;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
  options: {
    version: { type: "string" },
    origin: { type: "string" },
    "skip-build": { type: "boolean" },
  },
});
const { version, origin: originOverride, "skip-build": skipBuild } = values;
if (!version || !RELEASE_VERSION.test(version))
  throw new Error("Pass --version to publish an immutable CDN release");
const config = JSON.parse(await readFile(resolve(root, "config/cdn.json"), "utf8"));
const origin = resolveConfiguredOrigin({ config, originOverride });
const wranglerPath = "deploy/cloudflare/wrangler.jsonc";
const wranglerConfig = await readRegularFile(resolve(root, wranglerPath));
const wrangler = JSON.parse(wranglerConfig);
const route = wrangler.routes?.[0];
if (
  wrangler.name !== config.projects?.cloudflare ||
  wrangler.workers_dev !== false ||
  wrangler.preview_urls !== false ||
  !Array.isArray(wrangler.routes) ||
  wrangler.routes.length !== 1 ||
  route?.custom_domain !== true ||
  `https://${route.pattern}` !== origin ||
  typeof wrangler.assets?.directory !== "string" ||
  relative(resolve(root, "dist/cdn"), resolve(root, dirname(wranglerPath), wrangler.assets.directory)) !== ""
)
  throw new Error("Wrangler configuration must target the configured origin and staged CDN root");

const npmCache = resolve(root, ".npm-cache");
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

async function matchesManifestBody(response, expected) {
  if (!response.body) return false;
  let offset = 0;
  for await (const chunk of response.body) {
    const end = offset + chunk.byteLength;
    if (!expected.subarray(offset, end).equals(chunk)) return false;
    offset = end;
  }
  return offset === expected.length;
}

async function requireUnusedOrIdenticalVersion(release, { files }) {
  const name = `releases/${release}/manifest.json`;
  const url = new URL(`/${name}`, origin);
  try {
    const response = await fetch(url, {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(5000),
    });
    if (response.redirected || response.url !== url.href)
      throw new Error("manifest response did not come from its exact URL");
    if (response.status === 404) {
      await response.body?.cancel();
      return;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`unexpected manifest status ${response.status}`);
    }
    if (!(await matchesManifestBody(response, files.get(name))))
      throw new Error("published immutable manifest differs from the prepared manifest");
  } catch (error) {
    throw new Error(`Refusing deployment of CDN release ${release}: ${error.message}`, { cause: error });
  }
}

if (!skipBuild)
  run("node", [
    "scripts/cdn/build.mjs",
    "--version",
    version,
  ]);
const prepared = await prepareCdn({
  root,
  origin,
  version,
  async checkReleases(snapshots, staged) {
    assertCommittedReleases(root, snapshots);
    const releases = [...staged];
    for (let start = 0; start < releases.length; start += MAX_CONCURRENT_MANIFEST_CHECKS) {
      const batch = releases.slice(start, start + MAX_CONCURRENT_MANIFEST_CHECKS);
      await Promise.all(batch.map(([release, snapshot]) =>
        requireUnusedOrIdenticalVersion(release, snapshot)));
    }
  },
});
await mkdir(npmCache, { recursive: true });
// 全域 wrangler（工作區約定），發佈前先把它的版本量一次並對下限斷言 ——
// 理由見 scripts/cdn/cli-baseline.mjs：產物不可變，不能用行為未知的 CLI 去傳。
const wranglerVersion = assertCliBaseline({
  name: "wrangler",
  output: capture("wrangler", ["--version"]),
  minimum: config.cli.wrangler.minimum,
});
process.stdout.write(
  `wrangler ${wranglerVersion} (global, baseline ${config.cli.wrangler.minimum})\n`,
);
if (!(await readRegularFile(resolve(root, wranglerPath))).equals(wranglerConfig))
  throw new Error("Wrangler configuration changed before deployment");
await prepared.verifyStaged();
run("wrangler", ["deploy", "--config", wranglerPath]);

const report = {
  publishedAt: new Date().toISOString(),
  release: version,
  manifestPath: prepared.manifestPath,
  manifestSha256: prepared.manifestSha256,
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
