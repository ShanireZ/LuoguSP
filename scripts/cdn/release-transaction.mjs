import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { digest, readRegularFile, requireRegularDirectory, snapshotRelease } from "./release-integrity.mjs";
import { withLocalLock } from "./local-lock.mjs";

const directoryIdentity = (stat) => `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;

async function ownsDirectory(path, identity) {
  try {
    const stat = await lstat(path, { bigint: true });
    return stat.isDirectory() && directoryIdentity(stat) === identity;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function assertOwnedReleaseDirectory(path, identity) {
  if (!await ownsDirectory(path, identity))
    throw new Error(`Cannot resume publication: release directory ownership changed at ${path}`);
}

async function replaceChannel(path, body) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const handle = await open(temporary, "wx");
    created = true;
    try {
      await handle.writeFile(body);
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

export async function rollbackRelease({ releasesRoot, version, channelPath, transaction }) {
  const directory = join(releasesRoot, version);
  const retained = { removed: false, channelRestored: false };
  await requireRegularDirectory(dirname(releasesRoot));
  await requireRegularDirectory(releasesRoot);
  await requireRegularDirectory(dirname(channelPath));
  if (!await ownsDirectory(directory, transaction.directoryIdentity)) return retained;
  return withLocalLock(`${channelPath}.lock`, async () => {
    let snapshot;
    try {
      snapshot = await snapshotRelease(releasesRoot, version);
    } catch {
      // Changed, incomplete or additional files are outside this rollback.
      return retained;
    }
    if (snapshot.sha256 !== transaction.manifestSha256 ||
        !await ownsDirectory(directory, transaction.directoryIdentity)) return retained;
    const currentChannel = await readRegularFile(channelPath);
    const channelRestored = currentChannel.equals(Buffer.from(transaction.channel));
    if (channelRestored) {
      // A preceding build may itself have rolled back while this one ran.
      // Keep the current complete release if its previous channel is now invalid.
      const retainedWithCapturedChannel = { ...retained, resumeAllowed: true };
      try {
        const previous = JSON.parse(transaction.previousChannel);
        const target = await snapshotRelease(releasesRoot, previous.release);
        if (target.path !== previous.manifestPath || target.sha256 !== previous.manifestSha256)
          return retainedWithCapturedChannel;
      } catch {
        return retainedWithCapturedChannel;
      }
      await replaceChannel(channelPath, transaction.previousChannel);
    } else if (JSON.parse(currentChannel).release === version) return retained;
    await rm(directory, { recursive: true });
    return { removed: true, channelRestored };
  });
}

export async function writeRelease({ releasesRoot, version, channelPath, channelBody, files }) {
  const directory = join(releasesRoot, version);
  // mkdir exclusively claims the version after compilation has completed.
  await mkdir(directory);
  const transaction = {
    directoryIdentity: directoryIdentity(await lstat(directory, { bigint: true })),
    manifestSha256: digest(files.get("manifest.json")),
    previousChannel: null,
    channel: channelBody,
  };
  try {
    for (const [name, body] of files) {
      const destination = join(directory, name);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, body, { flag: "wx" });
    }
    await snapshotRelease(releasesRoot, version);
    await withLocalLock(`${channelPath}.lock`, async () => {
      transaction.previousChannel = (await readRegularFile(channelPath)).toString("utf8");
      await replaceChannel(channelPath, channelBody);
    });
    return transaction;
  } catch (error) {
    if (transaction.previousChannel !== null)
      await rollbackRelease({ releasesRoot, version, channelPath, transaction });
    else if (await ownsDirectory(directory, transaction.directoryIdentity))
      await rm(directory, { recursive: true });
    throw error;
  }
}
