const REQUIRE_PATTERN = /^\/\/ @require\s+(\S+)$/;
const VERSION_PATTERN = /^\/\/ @version\s+\S+$/;

function requireUrl(origin, file) {
  if (
    typeof file?.path !== "string" ||
    !file.path ||
    !/^[a-f0-9]{64}$/.test(file.sha256 || "")
  )
    throw new TypeError("CDN compatibility file metadata is invalid");
  return `${new URL(file.path, `${origin.replace(/\/+$/, "")}/`)}#sha256=${file.sha256}`;
}

export function createStagedMetadata(options) {
  const {
    metadata,
    version,
    primaryOrigin,
    manifest,
    thirdPartyRequireUrls,
  } = options || {};
  if (
    typeof metadata !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(version || "") ||
    !Array.isArray(thirdPartyRequireUrls) ||
    thirdPartyRequireUrls.length !== 4
  )
    throw new TypeError("Invalid staged userscript metadata input");
  if (
    manifest?.release !== version ||
    manifest?.esm?.enabled !== false ||
    !manifest?.compat?.earlyGate ||
    !manifest?.compat?.runtime
  )
    throw new Error("Stable compatibility manifest is not ready");

  const lines = metadata.trimEnd().split(/\r?\n/);
  const currentRequires = lines
    .map((line) => line.match(REQUIRE_PATTERN)?.[1])
    .filter(Boolean);
  const hasOnlyThirdParty =
    JSON.stringify(currentRequires) ===
    JSON.stringify(thirdPartyRequireUrls);
  const hasPinnedCompatibilityPair =
    currentRequires.length === thirdPartyRequireUrls.length + 2 &&
    JSON.stringify(currentRequires.slice(1, -1)) ===
      JSON.stringify(thirdPartyRequireUrls) &&
    /#sha256=[a-f0-9]{64}$/.test(currentRequires[0]) &&
    /#sha256=[a-f0-9]{64}$/.test(currentRequires.at(-1));
  if (!hasOnlyThirdParty && !hasPinnedCompatibilityPair)
    throw new Error(
      "Production metadata no longer contains the expected third-party @require entries and optional compatibility pair",
    );

  const versionIndexes = lines
    .map((line, index) => (VERSION_PATTERN.test(line) ? index : -1))
    .filter((index) => index !== -1);
  if (versionIndexes.length !== 1)
    throw new Error("Expected exactly one userscript @version");
  lines[versionIndexes[0]] = `// @version      ${version}`;

  const withoutRequires = lines.filter(
    (line) => !REQUIRE_PATTERN.test(line),
  );
  const runAtIndex = withoutRequires.findIndex((line) =>
    /^\/\/ @run-at\s+document-start$/.test(line),
  );
  if (runAtIndex === -1)
    throw new Error("Expected @run-at document-start in metadata");

  const firstParty = {
    earlyGate: requireUrl(
      primaryOrigin,
      manifest.compat.earlyGate,
    ),
    runtime: requireUrl(primaryOrigin, manifest.compat.runtime),
  };
  const requires = [
    firstParty.earlyGate,
    ...thirdPartyRequireUrls,
    firstParty.runtime,
  ].map((url) => `// @require      ${url}`);
  withoutRequires.splice(runAtIndex, 0, ...requires);
  return Object.freeze({
    metadata: `${withoutRequires.join("\n")}\n`,
    requires: Object.freeze([
      firstParty.earlyGate,
      ...thirdPartyRequireUrls,
      firstParty.runtime,
    ]),
    firstParty: Object.freeze(firstParty),
  });
}
