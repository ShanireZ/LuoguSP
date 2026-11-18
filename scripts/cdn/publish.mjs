import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { commandInvocation } from "./command-invocation.mjs";
import { assertCliBaseline } from "./cli-baseline.mjs";
import { assertCommittedReleases } from "./committed-releases.mjs";
import { assertParentLocalLock, withLocalLock } from "./local-lock.mjs";
import { resolveConfiguredOrigin } from "./origin-policy.mjs";
import { prepareCdn } from "./prepare-lib.mjs";
import { DEPLOYMENT_PHASE, PARENT_PUBLISH_LOCK, deploymentEvidence, readPublishReport, writePublishReport } from "./publish-receipt.mjs";
import { RELEASE_VERSION, digest, readRegularFile, releaseManifestPath, requireRegularDirectory } from "./release-integrity.mjs";
import { verifyDeployment } from "./verify-deployment.mjs";

const MAX_CONCURRENT_MANIFEST_CHECKS = 4;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
  options: {
    version: { type: "string" },
    origin: { type: "string" },
    "skip-build": { type: "boolean" },
    "channel-file": { type: "string" },
  },
});
const { version, origin: originOverride, "skip-build": skipBuild, "channel-file": channelFile } = values;
if (!version || !RELEASE_VERSION.test(version))
  throw new Error("Pass --version to publish an immutable CDN release");
if (channelFile !== undefined && (!channelFile || !skipBuild))
  throw new Error("Pass --channel-file with --skip-build to deploy a captured channel");

const reportDirectory = resolve(root, "reports");
const lockPath = resolve(reportDirectory, "publish.lock");
const checkpointPath = resolve(reportDirectory, "publish.json");
const parentLock = process.env[PARENT_PUBLISH_LOCK];

async function publish(checkpoint) {
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
delete environment[PARENT_PUBLISH_LOCK];
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
  return result.stdout;
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

async function isPublishedVersion(release, { files }, { requirePublished }) {
  const name = releaseManifestPath(release);
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
      if (requirePublished) throw new Error("committed release has no published manifest");
      return false;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`unexpected manifest status ${response.status}`);
    }
    if (!(await matchesManifestBody(response, files.get(name))))
      throw new Error("published immutable manifest differs from the prepared manifest");
    return true;
  } catch (error) {
    throw new Error(`Refusing deployment of CDN release ${release}: ${error.message}`, { cause: error });
  }
}

let capturedChannel;
if (channelFile) {
  capturedChannel = await readRegularFile(resolve(root, channelFile));
} else if (!skipBuild) {
  const output = run("node", ["scripts/cdn/build.mjs", "--version", version]);
  capturedChannel = Buffer.from(JSON.parse(output).transaction.channel);
}
if (checkpoint && !capturedChannel.equals(Buffer.from(checkpoint.channel)))
  throw new Error("Captured channel does not match the active publication checkpoint");
await mkdir(npmCache, { recursive: true });
await requireRegularDirectory(npmCache);
const snapshot = await mkdtemp(resolve(npmCache, `luogusp-cdn-deploy-${new Date().toISOString().slice(0, 10)}-`));
try {
  const prepared = await prepareCdn({
    root,
    explicitOutput: resolve(snapshot, "cdn"),
    origin,
    version,
    capturedChannel,
    async selectReleases(snapshots, candidates) {
      const committed = assertCommittedReleases(root, snapshots);
      const staged = new Map();
      const releases = [...candidates];
      for (let start = 0; start < releases.length; start += MAX_CONCURRENT_MANIFEST_CHECKS) {
        const batch = releases.slice(start, start + MAX_CONCURRENT_MANIFEST_CHECKS);
        const published = await Promise.all(batch.map(([release, item]) =>
          isPublishedVersion(release, item, { requirePublished: release !== version && committed.has(release) })));
        for (const [index, [release, item]] of batch.entries())
          if (release === version || published[index]) staged.set(release, item);
      }
      return staged;
    },
  });
  // Use the global Wrangler CLI and enforce the configured minimum before deployment.
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
  const snapshotConfigPath = resolve(snapshot, "wrangler.jsonc");
  const snapshotConfig = {
    ...wrangler,
    assets: { ...wrangler.assets, directory: "./cdn" },
  };
  if (typeof wrangler.main === "string")
    snapshotConfig.main = relative(snapshot, resolve(root, dirname(wranglerPath), wrangler.main));
  await writeFile(snapshotConfigPath, `${JSON.stringify(snapshotConfig, null, 2)}\n`, { flag: "wx" });
  await prepared.verifyStaged();
  const recordAttempt = async (attempt) => {
    if (!checkpoint) return;
    const status = checkpoint.deploymentStatus === "confirmed" ? "confirmed" : attempt;
    await writePublishReport(checkpointPath, { ...checkpoint, ...deploymentEvidence(status, attempt, origin) });
  };
  await recordAttempt("outcome-unknown");
  run("wrangler", ["deploy", "--config", relative(root, snapshotConfigPath)]);
  await recordAttempt("confirmed");

  const report = {
    publishedAt: new Date().toISOString(),
    release: version,
    manifestPath: prepared.manifestPath,
    manifestSha256: prepared.manifestSha256,
    channelSha256: digest(prepared.channelBody),
    target: "cloudflare-workers",
    project: config.projects.cloudflare,
    origin,
    deploymentStatus: "confirmed",
    platformDefaultDomainsUsed: false,
  };
  await writeFile(
    resolve(root, "reports/cdn-publish.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await verifyDeployment({ root, origin, channelBody: prepared.channelBody, manifestBody: prepared.manifestBody });
  console.log(`Published ${version} to Cloudflare Workers at ${origin}`);
} finally {
  await rm(snapshot, { recursive: true, force: true });
}
}

if (parentLock !== undefined) {
  await assertParentLocalLock(lockPath, parentLock);
  const checkpoint = await readPublishReport(checkpointPath);
  if (!channelFile || checkpoint?.status !== "in-progress" || checkpoint.release !== version ||
      checkpoint.phase !== DEPLOYMENT_PHASE || typeof checkpoint.channel !== "string" ||
      checkpoint.deploymentAttempt !== "not-attempted")
    throw new Error("Low-level publisher requires the active parent's deployment checkpoint");
  await publish(checkpoint);
} else {
  await mkdir(reportDirectory, { recursive: true });
  await withLocalLock(lockPath, () => publish(null));
}
