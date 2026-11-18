import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { releaseManifestPath } from "./release-integrity.mjs";

export const PARENT_PUBLISH_LOCK = "LUOGUSP_PARENT_PUBLISH_LOCK";
export const DEPLOYMENT_PHASE = "Cloudflare Workers deployment";
export const CDN_PUBLISH_REPORT = "reports/cdn-publish.json";
export const CDN_PUBLISH_SCHEMA_VERSION = 2;

export async function readPublishReport(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function retainedManifestPins(manifests, candidate) {
  if (!manifests || typeof manifests !== "object" || Array.isArray(manifests))
    throw new Error("CDN publication receipt has no retained manifest inventory");
  return Object.entries(manifests).map(([release, sha256]) => {
    if (release === candidate || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))
      throw new Error(`Invalid retained manifest pin for ${release}`);
    return [releaseManifestPath(release), sha256];
  });
}

export async function readDeploymentManifestPins({
  root, origin, release, manifestPath, manifestSha256, channelSha256, parentStartedAt,
}) {
  const receipt = await readPublishReport(resolve(root, CDN_PUBLISH_REPORT));
  if (!receipt || receipt.release !== release || receipt.origin !== origin || receipt.schemaVersion === undefined) {
    if (parentStartedAt !== undefined)
      throw new Error("Missing a matching CDN publication receipt with retained manifest inventory");
    return null;
  }
  if (receipt.schemaVersion !== CDN_PUBLISH_SCHEMA_VERSION || receipt.deploymentStatus !== "confirmed" ||
      receipt.manifestPath !== manifestPath || receipt.manifestSha256 !== manifestSha256 ||
      (channelSha256 !== undefined && receipt.channelSha256 !== channelSha256) ||
      (parentStartedAt !== undefined && receipt.parentStartedAt !== parentStartedAt))
    throw new Error("CDN publication receipt does not pin the requested deployment");
  return retainedManifestPins(receipt.retainedManifests, release);
}

export async function writePublishReport(path, report) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export function deploymentEvidence(deploymentStatus, deploymentAttempt, origin) {
  return {
    deploymentStatus,
    deploymentAttempt,
    deploymentStarted: deploymentStatus !== "not-attempted",
    deployedOrigins: deploymentStatus === "confirmed" ? [origin] : [],
  };
}
