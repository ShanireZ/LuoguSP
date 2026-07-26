import { spawnSync } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isResumablePublish,
  packageTextWithVersion,
  readmeTextWithVersion,
  userscriptVersion,
  verifyStagedActivation,
} from "./publish-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const planOnly = process.argv.includes("--plan");
const metadataPath = resolve(root, "src/userscript.meta.js");
const artifactPath = resolve(root, "LuoguSP.user.js");
const packagePath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");
const readmePath = resolve(root, "README.md");
const qualityReportPath = resolve(root, "reports/quality-report.json");
const channelPath = resolve(root, "cdn/channels/canary.json");
const reportPath = resolve(root, "reports/publish.json");
const readJsonIfPresent = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const [
  initialMetadata,
  initialArtifact,
  initialPackage,
  initialPackageLock,
  initialReadme,
  initialQualityReport,
  initialChannel,
  previousReport,
] = await Promise.all([
  readFile(metadataPath, "utf8"),
  readFile(artifactPath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(packageLockPath, "utf8"),
  readFile(readmePath, "utf8"),
  readFile(qualityReportPath, "utf8"),
  readFile(channelPath, "utf8"),
  readJsonIfPresent(reportPath),
]);
const version = userscriptVersion(initialArtifact);
const sourceMetadataVersion = userscriptVersion(initialMetadata);
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
const resumeMode =
  releaseExists && isResumablePublish(previousReport, version);

const steps = [
  resumeMode
    ? "verify existing immutable CDN release against current source"
    : "build immutable CDN release",
  "stage pinned userscript",
  "run pre-deployment tests",
  "deploy EdgeOne and Cloudflare",
  "verify both configured custom origins",
  "promote staged userscript locally",
  "verify activation and structural quality",
];
if (planOnly) {
  console.log(
    JSON.stringify(
      {
        version,
        versionSource: "LuoguSP.user.js",
        sourceMetadataVersion,
        releaseExists,
        mode: resumeMode ? "resume" : "new",
        wouldPublish: !releaseExists || resumeMode,
        steps,
        commit: false,
        push: false,
        browserQaRequiredBeforeCommit: true,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
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
const run = (args) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: environment,
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
};
const startedAt = new Date().toISOString();
let phase = "preflight";
let deploymentStarted = false;
let productionModified = false;
const restoreProduction = async () => {
  await Promise.all([
    writeFile(metadataPath, initialMetadata, "utf8"),
    writeFile(artifactPath, initialArtifact, "utf8"),
    writeFile(packagePath, initialPackage, "utf8"),
    writeFile(packageLockPath, initialPackageLock, "utf8"),
    writeFile(readmePath, initialReadme, "utf8"),
    writeFile(qualityReportPath, initialQualityReport, "utf8"),
  ]);
};
const writeReport = async (report) => {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
};
const beginPhase = (value) => {
  phase = value;
  console.log(`\n[publish] START ${phase}`);
};

try {
  beginPhase(
    resumeMode
      ? "verify existing immutable release"
      : "build",
  );
  run([
    "scripts/cdn/build.mjs",
    "--version",
    version,
    ...(resumeMode ? ["--verify-existing"] : []),
  ]);
  beginPhase("stage");
  run(["scripts/cdn/stage-userscript.mjs", "--version", version]);
  const stagedPath = resolve(
    root,
    `dist/staged/LuoguSP.${version}.user.js`,
  );
  const [stagedArtifact, manifestText, configText, budgetText] =
    await Promise.all([
      readFile(stagedPath, "utf8"),
      readFile(
        resolve(releaseDirectory, "manifest.json"),
        "utf8",
      ),
      readFile(resolve(root, "config/cdn.json"), "utf8"),
      readFile(resolve(root, "config/quality-budget.json"), "utf8"),
    ]);
  const manifest = JSON.parse(manifestText);
  const config = JSON.parse(configText);
  const budget = JSON.parse(budgetText);
  const activation = verifyStagedActivation({
    artifact: stagedArtifact,
    version,
    manifest,
    config,
    thirdPartyRequireUrls: budget.requires.resources.map(
      (resource) => resource.url,
    ),
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

  beginPhase("dual CDN deployment");
  deploymentStarted = true;
  run([
    "scripts/cdn/publish.mjs",
    "--version",
    version,
    "--skip-build",
  ]);
  beginPhase("production CDN gate");
  run([
    "scripts/cdn/verify-production.mjs",
    "--version",
    version,
  ]);

  beginPhase("local production promotion");
  productionModified = true;
  await Promise.all([
    writeFile(metadataPath, activation.metadata, "utf8"),
    writeFile(artifactPath, stagedArtifact, "utf8"),
    writeFile(
      packagePath,
      packageTextWithVersion(initialPackage, version),
      "utf8",
    ),
    writeFile(
      packageLockPath,
      packageTextWithVersion(initialPackageLock, version),
      "utf8",
    ),
    writeFile(
      readmePath,
      readmeTextWithVersion(initialReadme, version),
      "utf8",
    ),
  ]);

  beginPhase("activation verification");
  run(["scripts/build.mjs", "--check"]);
  const promotedArtifact = await readFile(artifactPath, "utf8");
  const promoted = verifyStagedActivation({
    artifact: promotedArtifact,
    version,
    manifest,
    config,
    thirdPartyRequireUrls: budget.requires.resources.map(
      (resource) => resource.url,
    ),
  });
  if (promoted.sha256 !== activation.sha256)
    throw new Error("Promoted userscript differs from staged artifact");
  run([
    "scripts/quality.mjs",
    "--check",
    "--fetch-requires",
    "--write-report",
    "--skip-browser-qa",
  ]);
  run(["--test"]);

  await writeReport({
    startedAt,
    completedAt: new Date().toISOString(),
    status: "ready-for-browser-qa",
    release: version,
    resumed: resumeMode,
    userscript: {
      bytes: promoted.bytes,
      sha256: promoted.sha256,
      requires: promoted.requires.length,
    },
    customOrigins: [
      config.origins.primary,
      config.origins.fallback,
    ],
    platformDefaultDomainsUsed: false,
    productionModified: true,
    commitPerformed: false,
    pushPerformed: false,
    browserQaRequiredBeforeCommit: true,
  });
  console.log(
    `Publish ${version} succeeded. Local userscript now pins the verified runtime; run real-browser QA before commit and push.`,
  );
} catch (error) {
  if (productionModified) await restoreProduction();
  if (!resumeMode && !deploymentStarted) {
    await rm(releaseDirectory, { recursive: true, force: true });
    await writeFile(channelPath, initialChannel, "utf8");
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
    productionRestored: productionModified,
    deploymentStarted: deploymentStarted || resumeMode,
    resumed: resumeMode,
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
    `[publish] production restored: ${productionModified ? "yes" : "not modified"}`,
  );
  console.error("[publish] report: reports/publish.json");
  throw error;
}
