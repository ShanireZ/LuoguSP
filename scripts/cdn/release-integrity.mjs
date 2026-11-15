import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const HASHED_MANIFEST = /^manifest\.([a-f0-9]{16})\.json$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PATH_SEGMENT = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
export const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const digest = (body) => createHash("sha256").update(body).digest("hex");

async function requireEntry(path, method, description) {
  let status;
  try {
    status = await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(`${path}: ${description} is missing`);
  }
  // lstat examines links and Windows junctions themselves rather than their targets.
  if (!status[method]()) throw new Error(`${path}: not a regular ${description}`);
}

export function requireRegularDirectory(path) {
  return requireEntry(path, "isDirectory", "directory");
}

export async function readRegularFile(path) {
  await requireEntry(path, "isFile", "file");
  return readFile(path);
}

function object(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Read the exact regular files in a portable path allowlist. */
export async function readExactFiles(root, filenames) {
  const directories = new Map([["", new Map()]]);
  for (const filename of filenames) {
    let parent = "";
    const segments = filename.split("/");
    for (const [index, segment] of segments.entries()) {
      const directory = index < segments.length - 1;
      const entries = directories.get(parent);
      const alias = segment.toLowerCase();
      const existing = entries.get(alias);
      if (existing && (existing.name !== segment || existing.directory !== directory))
        throw new Error(`${filename}: ambiguous pinned path`);
      entries.set(alias, { name: segment, directory });
      parent = parent ? `${parent}/${segment}` : segment;
      if (directory && !directories.has(parent)) directories.set(parent, new Map());
    }
  }

  const files = new Map();
  for (const [directory, expectedEntries] of directories) {
    const path = join(root, directory);
    await requireRegularDirectory(path);
    const missing = new Set([...expectedEntries.values()].map(({ name }) => name));
    for (const name of await readdir(path)) {
      if (!missing.delete(name)) throw new Error(`${join(path, name)}: unlisted CDN entry`);
      if (!expectedEntries.get(name.toLowerCase()).directory) {
        files.set(
          directory ? `${directory}/${name}` : name,
          await readRegularFile(join(path, name)),
        );
      }
    }
    if (missing.size)
      throw new Error(`${join(path, missing.values().next().value)}: pinned file or directory is missing`);
  }
  return files;
}

export async function snapshotRelease(releasesRoot, version) {
  if (!RELEASE_VERSION.test(version)) throw new Error(`${version}: invalid CDN release directory name`);
  const root = join(releasesRoot, version);
  await requireRegularDirectory(root);
  const manifestBody = await readRegularFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBody);
  if (!object(manifest) || ![1, 2, 3].includes(manifest.schemaVersion) || manifest.release !== version)
    throw new Error(`${root}: manifest release or schema does not match the release directory`);
  const prefix = `releases/${version}/`;
  if (!object(manifest.files) || !Object.keys(manifest.files).length)
    throw new Error(`${root}: manifest pins no files`);
  for (const [filename, record] of Object.entries(manifest.files)) {
    const segments = filename.slice(prefix.length).split("/");
    if (
      !filename.startsWith(prefix) ||
      segments.some((name) => !PATH_SEGMENT.test(name) || WINDOWS_DEVICE.test(name)) ||
      segments[0].toLowerCase().startsWith("manifest.")
    )
      throw new Error(`${filename}: unsafe pinned path in release ${version}`);
    if (
      !object(record) ||
      record.path !== filename ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes < 0 ||
      typeof record.sha256 !== "string" ||
      !SHA256.test(record.sha256)
    )
      throw new Error(`${filename}: invalid pinned file record`);
  }

  const hashedNames = (await readdir(root)).filter((name) => HASHED_MANIFEST.test(name));
  if (hashedNames.length !== 1)
    throw new Error(`${root}: expected exactly one hashed manifest, found ${hashedNames.length}`);
  const [hashed] = hashedNames;
  const files = await readExactFiles(root, [
    "manifest.json",
    hashed,
    ...Object.keys(manifest.files).map((filename) => filename.slice(prefix.length)),
  ]);
  const sha256 = digest(manifestBody);
  const hashedBody = files.get(hashed);
  if (!files.get("manifest.json").equals(manifestBody) || !hashedBody.equals(manifestBody))
    throw new Error(`${root}: hashed manifest and manifest.json are not byte-identical`);
  if (hashed !== `manifest.${sha256.slice(0, 16)}.json`)
    throw new Error(`${root}: manifest content does not match the hash in its own filename`);

  for (const [name, file] of Object.entries(manifest.files)) {
    const body = files.get(name.slice(prefix.length));
    if (body.length === file.bytes && digest(body) === file.sha256) continue;
    const hint = body.length > file.bytes && body.includes(0x0d)
      ? "; the working tree looks CRLF-expanded, check core.autocrlf and .gitattributes"
      : "";
    throw new Error(`${name}: content drifted from the manifest (${body.length}B vs ${file.bytes}B pinned)${hint}`);
  }

  return {
    manifest,
    sha256,
    path: prefix + hashed,
    files: new Map([...files].map(([name, bytes]) => [prefix + name, bytes])),
  };
}
