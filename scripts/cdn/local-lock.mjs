import { randomUUID } from "node:crypto";
import { closeSync, openSync, rmSync, writeFileSync } from "node:fs";
import { lstat, readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";

export class LocalLockBusyError extends Error {}

export async function withLocalLock(path, action) {
  const owner = { host: hostname(), pid: process.pid, token: randomUUID() };
  const body = `${JSON.stringify(owner)}\n`;
  let handle;
  try {
    handle = openSync(path, "wx");
  } catch (error) {
    if (error.code === "EEXIST")
      throw new LocalLockBusyError(`EEXIST: local lock ${path} is busy. Inspect its owner and use scripts/cdn/recover-lock.mjs after the transaction has stopped.`, { cause: error });
    throw error;
  }
  try {
    // Write the owner without yielding between exclusive creation and closing.
    // Recovery refuses to guess if interruption leaves the record incomplete.
    try { writeFileSync(handle, body); }
    finally { closeSync(handle); }
  } catch (error) {
    rmSync(path);
    throw error;
  }
  try {
    return await action(owner);
  } finally {
    // Cleanup only the pathname owned by this process.
    const current = await readFile(path, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (current === body) await rm(path);
  }
}

export async function assertParentLocalLock(path, token) {
  const owner = JSON.parse(await readFile(path, "utf8"));
  if (!/^[0-9a-f-]{36}$/.test(token) || owner?.token !== token ||
      owner?.host !== hostname() || owner?.pid !== process.ppid)
    throw new Error(`Local lock ${path} does not belong to this publisher's parent`);
}

export async function recoverLocalLock(path) {
  // Serialize recovery so a second operator cannot remove a newly acquired lock.
  return withLocalLock(`${path}.recovery`, async () => {
    const status = await lstat(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (!status) return false;
    if (!status.isFile()) throw new Error(`Local lock ${path} is not a regular file`);
    const current = await readFile(path, "utf8");
    let owner;
    try { owner = JSON.parse(current); }
    catch { throw new Error(`Cannot establish the owner of ${path}`); }
    if (owner?.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1 ||
        !/^[0-9a-f-]{36}$/.test(owner.token))
      throw new Error(`Cannot establish a local process owner for ${path}`);
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      if (await readFile(path, "utf8") !== current)
        throw new Error(`Local lock ${path} changed during recovery`);
      await rm(path);
      return true;
    }
    throw new Error(`Local lock ${path} still belongs to active process ${owner.pid}`);
  });
}
