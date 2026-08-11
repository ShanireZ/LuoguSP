const HASHED_MANIFEST_PATTERN = /^manifest\.([a-f0-9]{16})\.json$/;

function looksLineEndingDamaged(disk, expectedBytes) {
  // A CRLF-expanded checkout is longer than the blob by exactly one byte per line.
  return disk.length > expectedBytes && disk.includes(0x0d);
}

function describe(problem) {
  const suffix = problem.hint ? ` — ${problem.hint}` : "";
  return `${problem.path}: ${problem.reason}${suffix}`;
}

/**
 * Verify that every byte under cdn/releases still matches the hashes its own
 * manifest pins. The published artifacts are addressed by content hash and the
 * installed userscript pins them with `@require …#sha256=`, so a working tree
 * that drifted from the committed blobs — a CRLF checkout on Windows is the
 * realistic way — would upload bytes that fail integrity for every user who
 * already has an older release installed.
 */
export async function collectReleaseIntegrityProblems(options) {
  const {
    releasesDir,
    readdir,
    readFile,
    digest,
    join = (...parts) => parts.join("/"),
  } = options || {};
  if (
    typeof readdir !== "function" ||
    typeof readFile !== "function" ||
    typeof digest !== "function" ||
    typeof releasesDir !== "string"
  )
    throw new TypeError("Release integrity check requires a filesystem");

  const problems = [];
  const releases = (await readdir(releasesDir)).slice().sort();
  if (!releases.length)
    problems.push({ path: releasesDir, reason: "no release directories" });

  for (const release of releases) {
    const releaseDir = join(releasesDir, release);
    const manifestPath = join(releaseDir, "manifest.json");
    let manifestBody;
    try {
      manifestBody = await readFile(manifestPath);
    } catch (error) {
      problems.push({ path: manifestPath, reason: "manifest is unreadable" });
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestBody.toString("utf8"));
    } catch (error) {
      problems.push({ path: manifestPath, reason: "manifest is not JSON" });
      continue;
    }

    const files = manifest.files || {};
    if (!Object.keys(files).length)
      problems.push({ path: manifestPath, reason: "manifest pins no files" });

    for (const [path, file] of Object.entries(files)) {
      let body;
      try {
        body = await readFile(join(releasesDir, "..", path));
      } catch (error) {
        problems.push({ path, reason: "pinned file is missing" });
        continue;
      }
      if (body.length !== file.bytes || digest(body) !== file.sha256)
        problems.push({
          path,
          reason: `content drifted from the manifest (${body.length}B vs ${file.bytes}B pinned)`,
          hint: looksLineEndingDamaged(body, file.bytes)
            ? "the working tree looks CRLF-expanded; check core.autocrlf and .gitattributes"
            : null,
        });
    }

    // The manifest is served twice: once under its own content hash and once as
    // manifest.json. Both are outside manifest.files, so verify them directly.
    const entries = await readdir(releaseDir);
    const hashed = entries.filter((name) =>
      HASHED_MANIFEST_PATTERN.test(name),
    );
    if (hashed.length !== 1) {
      problems.push({
        path: releaseDir,
        reason: `expected exactly one hashed manifest, found ${hashed.length}`,
      });
      continue;
    }
    const hashedPath = join(releaseDir, hashed[0]);
    const hashedBody = await readFile(hashedPath);
    const hashedDigest = digest(hashedBody);
    const [, nameHash] = hashed[0].match(HASHED_MANIFEST_PATTERN);
    if (!hashedDigest.startsWith(nameHash))
      problems.push({
        path: hashedPath,
        reason: "content does not match the hash in its own filename",
        hint: looksLineEndingDamaged(hashedBody, manifestBody.length)
          ? "the working tree looks CRLF-expanded; check core.autocrlf and .gitattributes"
          : null,
      });
    if (!hashedBody.equals(manifestBody))
      problems.push({
        path: hashedPath,
        reason: "hashed manifest and manifest.json are not byte-identical",
      });
  }
  return problems;
}

export function releaseIntegrityError(problems) {
  return new Error(
    [
      `Refusing to deploy: ${problems.length} CDN artifact(s) do not match their pinned hashes.`,
      ...problems.map((problem) => `  ${describe(problem)}`),
      "Published releases are immutable and addressed by content hash; uploading these bytes would break the",
      "@require integrity check for every user who already has one of these releases installed.",
    ].join("\n"),
  );
}
