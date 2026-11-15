import { createHash } from "node:crypto";
import {
  cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectReleaseIntegrityProblems,
  releaseIntegrityError,
} from "./release-integrity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const explicitOutput = argument("--output");
const requestedOutput = resolve(root, explicitOutput || "dist/cdn");
const sourceCdnRoot = resolve(root, "cdn");
const refuseOutput = () => {
  throw new Error("Refusing to replace an unexpected deployment directory");
};

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
  // An existing junction or symlink with an unresolved target is an error,
  // not a missing path segment that can safely be appended.
  return realpath(path);
}

if (basename(requestedOutput) !== "cdn" || overlaps(requestedOutput, sourceCdnRoot))
  refuseOutput();

// This directory is copied verbatim to the CDN, so the last chance to notice a
// working tree that no longer matches the committed bytes is here — before the
// upload, not after it.
const problems = await collectReleaseIntegrityProblems({
  releasesDir: resolve(root, "cdn/releases"),
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path),
  digest: (body) => createHash("sha256").update(body).digest("hex"),
  join: (...parts) => resolve(...parts),
});
if (problems.length) throw releaseIntegrityError(problems);
console.log(
  `Release integrity verified for ${(await readdir(resolve(root, "cdn/releases"))).length} releases.`,
);

const channel = JSON.parse(
  await readFile(resolve(root, "cdn/channels/canary.json"), "utf8"),
);
const [actualRoot, actualSource, actualParent] = await Promise.all([
  realpath(root),
  realpath(sourceCdnRoot),
  resolveWithMissingTail(dirname(requestedOutput)),
]);
// Check both the directory entry to be removed and its destination if linked.
// Use the resolved parent for the mutation so intermediate aliases are gone.
const output = resolve(actualParent, basename(requestedOutput));
const actualOutput = await resolveWithMissingTail(output);
if ([output, actualOutput].some((candidate) =>
  overlaps(candidate, resolve(actualRoot, "cdn")) ||
  overlaps(candidate, actualSource) ||
  (!explicitOutput && relative(resolve(actualRoot, "dist/cdn"), candidate) !== ""),
))
  refuseOutput();

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "releases"), { recursive: true });
const releases = await readdir(resolve(root, "cdn/releases"));
const stagedReleases = releases.filter(
  (release) => !release.includes("-canary.") || release === channel.release,
);
for (const release of stagedReleases) {
  await cp(
    resolve(root, "cdn/releases", release),
    resolve(output, "releases", release),
    { recursive: true },
  );
}
await cp(resolve(root, "cdn/channels"), resolve(output, "channels"), {
  recursive: true,
});
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>LuoguSP CDN</title></head><body><h1>LuoguSP CDN</h1><p>Canary release: ${channel.release}</p></body></html>\n`,
  "utf8",
);
console.log(
  `Prepared ${output} with ${stagedReleases.length} releases; only canary ${channel.release} is staged.`,
);
