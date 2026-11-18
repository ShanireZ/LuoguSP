import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";

export const PARENT_PUBLISH_LOCK = "LUOGUSP_PARENT_PUBLISH_LOCK";
export const DEPLOYMENT_PHASE = "Cloudflare Workers deployment";

export async function readPublishReport(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
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
