import { spawnSync } from "node:child_process";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isResumablePublish,
  packageTextWithVersion,
  README_EDITIONS,
  readmeEditionsWithVersion,
  userscriptVersion,
  verifyStagedActivation,
} from "./publish-lib.mjs";
import { rollbackRelease } from "./cdn/release-transaction.mjs";
import { withLocalLock } from "./cdn/local-lock.mjs";
import { DEPLOYMENT_PHASE, PARENT_PUBLISH_LOCK, deploymentEvidence, readPublishReport, writePublishReport } from "./cdn/publish-receipt.mjs";
import { digest, parseCanaryChannel, readRegularFile } from "./cdn/release-integrity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function publish(lockOwner) {
const planOnly = process.argv.includes("--plan");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const requestedVersion = argument("--version");
const metadataPath = resolve(root, "src/userscript.meta.js");
const artifactPath = resolve(root, "LuoguSP.user.js");
const packagePath = resolve(root, "package.json");
const qualityReportPath = resolve(root, "reports/quality-report.json");
const channelPath = resolve(root, "cdn/channels/canary.json");
const reportPath = resolve(root, "reports/publish.json");
const [
  initialMetadata,
  initialArtifact,
  initialPackage,
  initialReadmes,
  initialQualityReport,
  previousReport,
  initialConfigText,
] = await Promise.all([
  readFile(metadataPath, "utf8"),
  readFile(artifactPath, "utf8"),
  readFile(packagePath, "utf8"),
  Promise.all(README_EDITIONS.map(async (name) => [name, await readFile(resolve(root, name), "utf8")])).then(Object.fromEntries),
  readFile(qualityReportPath, "utf8"),
  readPublishReport(reportPath),
  readFile(resolve(root, "config/cdn.json"), "utf8"),
]);
const currentVersion = userscriptVersion(initialArtifact);
const sourceMetadataVersion = userscriptVersion(initialMetadata);
const version = requestedVersion;
if (!/^\d+\.\d+\.\d+$/.test(version || ""))
  throw new Error(
    "Pass the new stable release with --version, for example 2.13.5",
  );
const versionParts = (value) =>
  value.split(".").map((part) => Number(part));
const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};
const initialPackageVersion = JSON.parse(initialPackage).version;
const initialReadmeVersion =
  initialReadmes["README.md"].match(
    /\[!\[Version: (\d+\.\d+\.\d+)\]\(/,
  )?.[1];
if (
  ![
    sourceMetadataVersion,
    initialPackageVersion,
    initialReadmeVersion,
  ].every((value) => value === currentVersion)
)
  throw new Error(
    "Preflight version drift: userscript, source metadata, package, and README must agree",
  );
const nextReadmes = readmeEditionsWithVersion(initialReadmes, currentVersion, version);
if (compareVersions(version, currentVersion) <= 0)
  throw new Error(
    `Target version ${version} must be newer than current production ${currentVersion}`,
  );
const initialConfig = JSON.parse(initialConfigText);
const releasesRoot = resolve(root, "cdn/releases");
const releaseDirectory = resolve(releasesRoot, version);
if (
  releaseDirectory === releasesRoot ||
  !releaseDirectory.startsWith(`${releasesRoot}${sep}`)
)
  throw new Error("Refusing to publish outside cdn/releases");
let releaseExists = true;
try {
  await stat(releaseDirectory);
} catch (error) {
  if (error.code === "ENOENT") releaseExists = false;
  else throw error;
}
const matchingCheckpoint = isResumablePublish(previousReport, version);
const resumeMode = releaseExists && matchingCheckpoint;
const pendingRelease = previousReport?.release !== version &&
  isResumablePublish(previousReport, previousReport?.release) ? previousReport.release : null;

const steps = [
  "run Web Platform Baseline contract guard",
  resumeMode
    ? "verify existing immutable CDN release against current source"
    : "build immutable CDN release",
  "run renderer contract tests",
  "stage pinned userscript",
  "run pre-deployment tests",
  "deploy Cloudflare Workers",
  "verify the configured Cloudflare custom origin",
  "promote staged userscript locally",
  "verify activation and structural quality",
  "leave release pending real-browser QA",
];
if (planOnly) {
  console.log(
    JSON.stringify(
      {
        version,
        currentVersion,
        versionSource: "LuoguSP.user.js",
        sourceMetadataVersion,
        releaseExists,
        mode: resumeMode ? "resume" : "new",
        wouldPublish: !pendingRelease && (matchingCheckpoint ? resumeMode : !releaseExists),
        ...(pendingRelease ? { pendingRelease } : {}),
        steps,
        commit: false,
        push: false,
        browserQaRequiredBeforeCommit: true,
      },
      null,
      2,
    ),
  );
  return;
}
if (pendingRelease)
  throw new Error(`Resolve pending release ${pendingRelease} before publishing ${version}; its checkpoint is preserved`);
if (matchingCheckpoint && !releaseExists)
  throw new Error(`Pending release ${version} is missing its local immutable files; restore them before retrying`);
if (releaseExists && !resumeMode)
  {
    const message =
      `CDN release ${version} already exists. Increase @version before publishing; immutable releases are never overwritten.`;
    console.error(`[publish] BLOCKED at preflight: ${message}`);
    throw new Error(message);
  }

const npmCache = resolve(root, ".npm-cache");
await mkdir(npmCache, { recursive: true });
const environment = {
  ...process.env,
  npm_config_cache: npmCache,
  WRANGLER_LOG_PATH: resolve(npmCache, "wrangler.log"),
};
const run = (args, extraEnvironment) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: extraEnvironment ? { ...environment, ...extraEnvironment } : environment,
    encoding: "utf8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error || result.status !== 0)
    {
      const error = new Error(
      `node ${args.join(" ")} failed: ${
        result.error?.message || `exit ${result.status}`
      }`,
      );
      error.command = `node ${args.join(" ")}`;
      error.exitCode = result.status;
      throw error;
    }
  return result.stdout;
};
const startedAt = new Date().toISOString();
let phase = "preflight";
const origin = initialConfig.origins.primary;
let deploymentStatus = "not-attempted";
if (resumeMode && previousReport.deploymentStarted === true)
  deploymentStatus = previousReport.deploymentStatus === "confirmed" && previousReport.deployedOrigins?.includes(origin)
    ? "confirmed" : "outcome-unknown";
let deploymentAttempt = "not-attempted";
let productionModified = false;
let rendererReport = null;
let buildTransaction = null;
let capturedChannel = resumeMode ? previousReport.channel ?? null : null;
let resumeAllowed = resumeMode;
const initialProduction = new Map([
  [metadataPath, initialMetadata], [artifactPath, initialArtifact], [packagePath, initialPackage],
  ...README_EDITIONS.map((name) => [resolve(root, name), initialReadmes[name]]),
  [qualityReportPath, initialQualityReport],
]);
const ownedProduction = new Map();
const productionName = (path) => path.slice(root.length + 1).split(sep).join("/");
const currentProduction = (path) => readFile(path, "utf8").catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
const assertProductionUnchanged = async () => {
  for (const [path, initial] of initialProduction)
    if (await currentProduction(path) !== initial)
      throw new Error(`Production file changed: ${productionName(path)}`);
};
const replaceProduction = async (path, expected, body) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const file = await open(temporary, "wx");
    created = true;
    try { await file.writeFile(body, "utf8"); }
    finally { await file.close(); }
    if (await currentProduction(path) !== expected)
      throw new Error(`Production file changed: ${productionName(path)}`);
    await rename(temporary, path);
  } finally {
    if (created) await rm(temporary, { force: true });
  }
};
const promoteProduction = async (path, body) => {
  await replaceProduction(path, initialProduction.get(path), body);
  ownedProduction.set(path, body);
};
const qualityStagePath = resolve(npmCache, `luogusp-publish-${new Date().toISOString().slice(0, 10)}-${randomUUID()}.json`);
const capturedChannelPath = `${qualityStagePath}.channel`;
const restoreProduction = async () => {
  const retained = [];
  for (const [path, initial] of initialProduction) {
    const expected = ownedProduction.get(path) ?? initial;
    try {
      if (await currentProduction(path) !== expected) retained.push(productionName(path));
      else if (ownedProduction.has(path)) await replaceProduction(path, expected, initial);
    } catch (error) {
      retained.push(productionName(path));
      console.error(`[publish] production rollback retained ${productionName(path)}: ${error.message}`);
    }
  }
  return retained;
};
const writeReport = (report) => writePublishReport(reportPath, report);
const writeCheckpoint = () => writeReport({
  startedAt, status: "in-progress", release: version, phase,
  channel: capturedChannel, resumeAllowed, resumed: resumeMode,
  ...deploymentEvidence(deploymentStatus, deploymentAttempt, origin),
});
const beginPhase = (value) => {
  phase = value;
  console.log(`\n[publish] START ${phase}`);
};

try {
  beginPhase("Baseline contract guard");
  run(["scripts/check-baseline.mjs"]);

  beginPhase(
    resumeMode
      ? "verify existing immutable release"
      : "build",
  );
  let channelForVerification = capturedChannel;
  if (resumeMode) {
    // Older blocked receipts are recoverable while the original channel is still selected.
    channelForVerification ??= (await readRegularFile(channelPath)).toString("utf8");
    await writeFile(capturedChannelPath, channelForVerification, { flag: "wx" });
  }
  const buildOutput = run([
    "scripts/cdn/build.mjs",
    "--version",
    version,
    ...(resumeMode ? ["--verify-existing", "--channel-file", capturedChannelPath] : []),
  ]);
  if (resumeMode) capturedChannel = channelForVerification;
  else {
    buildTransaction = JSON.parse(buildOutput).transaction;
    capturedChannel = buildTransaction.channel;
    await writeFile(capturedChannelPath, capturedChannel, { flag: "wx" });
  }
  const releaseChannel = parseCanaryChannel(capturedChannel, { version, origin: initialConfig.origins.primary });
  resumeAllowed = true;
  await writeCheckpoint();
  const builtManifest = JSON.parse(
    await readFile(
      resolve(releaseDirectory, "manifest.json"),
      "utf8",
    ),
  );
  rendererReport =
    builtManifest.optionalBundles?.markdownRenderer || null;

  beginPhase("renderer contract tests");
  run([
    "--test",
    "test/markdown-lite-baseline.test.mjs",
    "test/markdown-full.test.mjs",
    "test/markdown-renderer-api.test.mjs",
    "test/renderer-build.test.mjs",
  ]);
  run(["scripts/renderer/check.mjs"]);

  beginPhase("stage");
  run(["scripts/cdn/stage-userscript.mjs", "--version", version]);
  const stagedPath = resolve(
    root,
    `dist/staged/LuoguSP.${version}.user.js`,
  );
  const [stagedArtifact, manifestBody, configText] =
    await Promise.all([
      readFile(stagedPath, "utf8"),
      readRegularFile(resolve(releaseDirectory, "manifest.json")),
      readFile(resolve(root, "config/cdn.json"), "utf8"),
    ]);
  if (digest(manifestBody) !== releaseChannel.manifestSha256)
    throw new Error("Staged manifest differs from the publication receipt");
  const manifest = JSON.parse(manifestBody);
  const config = JSON.parse(configText);
  const activation = verifyStagedActivation({
    artifact: stagedArtifact,
    version,
    manifest,
    config,
  });

  beginPhase("pre-deployment tests");
  const preDeploymentTests = (
    await readdir(resolve(root, "test"))
  )
    .filter(
      (name) =>
        name.endsWith(".test.mjs") &&
        name !== "release-contract.test.mjs",
    )
    .sort()
    .map((name) => `test/${name}`);
  run(["--test", ...preDeploymentTests]);

  beginPhase(DEPLOYMENT_PHASE);
  await assertProductionUnchanged();
  await writeCheckpoint();
  let deploymentError;
  try {
    run([
      "scripts/cdn/publish.mjs",
      "--version",
      version,
      "--skip-build",
      "--channel-file",
      capturedChannelPath,
    ], { [PARENT_PUBLISH_LOCK]: lockOwner.token });
  } catch (error) {
    deploymentError = error;
  }
  try {
    const evidence = await readPublishReport(reportPath);
    if (evidence?.startedAt !== startedAt || evidence.release !== version || evidence.phase !== DEPLOYMENT_PHASE ||
        !["not-attempted", "outcome-unknown", "confirmed"].includes(evidence.deploymentStatus) ||
        !["not-attempted", "outcome-unknown", "confirmed"].includes(evidence.deploymentAttempt))
      throw new Error("Cannot establish the current provider outcome from the publication checkpoint");
    deploymentStatus = evidence.deploymentStatus;
    deploymentAttempt = evidence.deploymentAttempt;
  } catch (error) {
    deploymentAttempt = "outcome-unknown";
    if (deploymentStatus !== "confirmed") deploymentStatus = deploymentAttempt;
    throw error;
  }
  if (deploymentError) throw deploymentError;
  if (deploymentAttempt !== "confirmed") throw new Error("Provider did not confirm deployment");
  beginPhase("production CDN gate");
  run([
    "scripts/cdn/verify-production.mjs",
    "--version",
    version,
    "--manifest-sha256",
    releaseChannel.manifestSha256,
  ]);

  beginPhase("local production promotion");
  await assertProductionUnchanged();
  productionModified = true;
  await promoteProduction(metadataPath, activation.metadata);
  await promoteProduction(artifactPath, stagedArtifact);
  await promoteProduction(packagePath, packageTextWithVersion(initialPackage, version));
  for (const name of README_EDITIONS) await promoteProduction(resolve(root, name), nextReadmes[name]);

  beginPhase("activation verification");
  run(["scripts/build.mjs", "--check"]);
  const promotedArtifact = await readFile(artifactPath, "utf8");
  const promoted = verifyStagedActivation({
    artifact: promotedArtifact,
    version,
    manifest,
    config,
  });
  if (promoted.sha256 !== activation.sha256)
    throw new Error("Promoted userscript differs from staged artifact");
  run([
    "scripts/quality.mjs",
    "--check",
    "--fetch-requires",
    "--write-report",
    "--report-output", qualityStagePath,
    "--skip-browser-qa",
  ]);
  await promoteProduction(qualityReportPath, await readFile(qualityStagePath, "utf8"));
  run(["--test"]);

  await writeReport({
    startedAt,
    completedAt: new Date().toISOString(),
    status: "ready-for-browser-qa",
    release: version,
    resumed: resumeMode,
    channel: capturedChannel,
    userscript: {
      bytes: promoted.bytes,
      sha256: promoted.sha256,
      requires: promoted.requires.length,
    },
    renderer: rendererReport,
    customOrigin: config.origins.primary,
    ...deploymentEvidence(deploymentStatus, deploymentAttempt, origin),
    platformDefaultDomainsUsed: false,
    productionModified: true,
    commitPerformed: false,
    pushPerformed: false,
    browserQaRequiredBeforeCommit: true,
  });
  console.log(
    `Publish ${version} succeeded. Local userscript now pins two verified first-party startup files; run real-browser QA before commit and push.`,
  );
} catch (error) {
  if (!rendererReport) {
    try {
      const failedManifest = JSON.parse(
        await readFile(
          resolve(releaseDirectory, "manifest.json"),
          "utf8",
        ),
      );
      rendererReport =
        failedManifest.optionalBundles?.markdownRenderer || null;
    } catch {
      rendererReport = null;
    }
  }
  const productionRetained = productionModified ? await restoreProduction() : [];
  let releaseRollback = null;
  let rollbackError = null;
  if (buildTransaction && deploymentStatus === "not-attempted") {
    try {
      releaseRollback = await rollbackRelease({
        releasesRoot, version, channelPath, transaction: buildTransaction,
      });
    } catch (cleanupError) {
      rollbackError = cleanupError.message;
      console.error(`[publish] release rollback failed: ${rollbackError}`);
    }
  }
  await writeReport({
    startedAt,
    failedAt: new Date().toISOString(),
    status: "blocked",
    release: version,
    phase,
    error: error.message,
    command: error.command || null,
    exitCode: error.exitCode ?? null,
    renderer: rendererReport,
    channel: capturedChannel,
    ...deploymentEvidence(deploymentStatus, deploymentAttempt, origin),
    productionRestored: productionModified && productionRetained.length === 0,
    productionRetained,
    releaseRollback,
    rollbackError,
    resumed: resumeMode,
    resumeAllowed: deploymentStatus !== "not-attempted" || resumeMode,
    commitPerformed: false,
    pushPerformed: false,
  });
  console.error(`\n[publish] FAILED at ${phase}`);
  if (error.command)
    console.error(`[publish] command: ${error.command}`);
  if (error.exitCode != null)
    console.error(`[publish] exit code: ${error.exitCode}`);
  console.error(`[publish] error: ${error.message}`);
  console.error(
    `[publish] production restored: ${!productionModified ? "not modified" : productionRetained.length ? "partial; concurrent changes retained" : "yes"}`,
  );
  console.error("[publish] report: reports/publish.json");
  throw error;
} finally {
  await rm(qualityStagePath, { force: true });
  await rm(capturedChannelPath, { force: true });
}
}

if (process.argv.includes("--plan")) await publish();
else {
  const lockPath = resolve(root, "reports/publish.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  await withLocalLock(lockPath, publish);
}
