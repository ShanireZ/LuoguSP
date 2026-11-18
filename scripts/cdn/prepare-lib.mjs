import { lstat, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  parseCanaryChannel,
  readExactFiles,
  requireRegularDirectory,
  snapshotRelease,
} from "./release-integrity.mjs";

const CHANNEL_FILE = "canary.json";

function refuseOutput() {
  throw new Error("Refusing to replace an unexpected deployment directory");
}

function contains(directory, candidate) {
  // path.relative compares case-insensitively on Windows.
  const suffix = relative(directory, candidate);
  return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}

const overlaps = (a, b) => contains(a, b) || contains(b, a);

async function resolveWithMissingTail(path) {
  try {
    await lstat(path);
  } catch (error) {
    const parent = dirname(path);
    if (error.code !== "ENOENT" || parent === path) throw error;
    return resolve(await resolveWithMissingTail(parent), basename(path));
  }
  // A dangling link is an error, rather than a missing path segment.
  return realpath(path);
}

async function resolveOutput(root, source, explicitOutput) {
  const requestedOutput = resolve(root, explicitOutput || "dist/cdn");
  if (basename(requestedOutput) !== "cdn" || overlaps(requestedOutput, source))
    refuseOutput();
  const [actualRoot, actualSource, actualParent] = await Promise.all([
    realpath(root),
    realpath(source),
    resolveWithMissingTail(dirname(requestedOutput)),
  ]);
  // Check the entry itself and its destination; use the resolved parent for writes.
  const output = resolve(actualParent, basename(requestedOutput));
  const actualOutput = await resolveWithMissingTail(output);
  if ([output, actualOutput].some((candidate) =>
    overlaps(candidate, resolve(actualRoot, "cdn")) ||
    overlaps(candidate, actualSource) ||
    (!explicitOutput && relative(resolve(actualRoot, "dist/cdn"), candidate) !== ""),
  ))
    refuseOutput();
  return output;
}

export async function prepareCdn({ root, explicitOutput, origin, version, capturedChannel, selectReleases }) {
  const source = resolve(root, "cdn");
  await requireRegularDirectory(source);
  const output = await resolveOutput(root, source, explicitOutput);
  const releasesRoot = resolve(source, "releases");
  await requireRegularDirectory(releasesRoot);
  const channelBody = capturedChannel ??
    (await readExactFiles(resolve(source, "channels"), [CHANNEL_FILE])).get(CHANNEL_FILE);
  const channel = parseCanaryChannel(channelBody, { origin, version });

  const releases = new Map();
  for (const release of (await readdir(releasesRoot)).sort())
    releases.set(release, await snapshotRelease(releasesRoot, release));
  const selected = releases.get(channel.release);
  if (!selected)
    throw new Error("Canary channel does not pin the selected release manifest at the configured CDN origin");
  parseCanaryChannel(channelBody, { origin, version, release: selected });
  const files = new Map([
    [`channels/${CHANNEL_FILE}`, channelBody],
    ["index.html", Buffer.from(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>LuoguSP CDN</title></head><body><h1>LuoguSP CDN</h1><p>Canary release: ${channel.release}</p></body></html>\n`,
    )],
  ]);
  const candidates = new Map([...releases].filter(([release]) =>
    !release.includes("-canary.") || release === channel.release));
  const staged = selectReleases ? await selectReleases(releases, candidates) : candidates;
  for (const { files: pinned } of staged.values()) {
    for (const [name, body] of pinned) files.set(name, body);
  }

  // Only write the exact bytes already verified. Never recursively copy sources.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const parents = new Set([output]);
  for (const [name, bytes] of files) {
    const target = resolve(output, name);
    const parent = dirname(target);
    if (!parents.has(parent)) {
      await mkdir(parent, { recursive: true });
      parents.add(parent);
    }
    await writeFile(target, bytes, { flag: "wx" });
  }
  console.log(`Release integrity verified for ${releases.size} releases.`);
  console.log(`Prepared ${output} with ${staged.size} releases; only canary ${channel.release} is staged.`);
  return {
    manifestPath: selected.path,
    manifestSha256: selected.sha256,
    channelBody,
    manifestBody: selected.files.get(selected.path),
    async verifyStaged() {
      try {
        if (relative(output, await realpath(output)) !== "")
          throw new Error("deployment directory was replaced or redirected");
        const staged = await readExactFiles(output, files.keys());
        for (const [name, expected] of files)
          if (!staged.get(name).equals(expected)) throw new Error(`${name} differs from the prepared bytes`);
      } catch (error) {
        throw new Error(`Staged CDN changed before deployment: ${error.message}`, { cause: error });
      }
    },
  };
}
