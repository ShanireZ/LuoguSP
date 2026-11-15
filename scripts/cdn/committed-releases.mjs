import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export function committedReleaseFiles(root, version) {
  const prefix = version ? `cdn/releases/${version}/` : "cdn/releases/";
  const result = spawnSync("git", ["--no-replace-objects", "ls-tree", "-rz", "HEAD", "--", prefix], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error("Cannot verify immutable CDN releases against the committed Git tree");
  const releases = new Map();
  for (const entry of result.stdout.split("\0").filter(Boolean)) {
    const match = /^100(?:644|755) blob ([a-f0-9]{40}|[a-f0-9]{64})\tcdn\/(releases\/([^/]+)\/.+)$/.exec(entry);
    if (!match) throw new Error("Committed immutable CDN release contains a non-regular Git entry");
    const [, hash, name, release] = match;
    if (!releases.has(release)) releases.set(release, new Map());
    releases.get(release).set(name, hash);
  }
  return releases;
}

export function assertCommittedReleases(root, snapshots) {
  const committedReleases = committedReleaseFiles(root);
  for (const [release, committed] of committedReleases) {
    const actual = snapshots.get(release)?.files;
    if (actual?.size !== committed.size)
      throw new Error(`Committed immutable CDN release ${release} has a different set of files`);
    for (const [name, hash] of committed) {
      const body = actual.get(name);
      const algorithm = hash.length === 40 ? "sha1" : "sha256";
      if (!body || createHash(algorithm).update(`blob ${body.length}\0`).update(body).digest("hex") !== hash)
        throw new Error(`Committed immutable CDN release ${release} differs at ${name}`);
    }
  }
  return committedReleases;
}
