const REQUIRE_PATTERN = /^\/\/ @require\s+(\S+)$/;
const VERSION_LINE_PATTERN = /^\/\/ @version\s+\S+$/;
const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const CANARY_VERSION_PATTERN =
  /^\d+\.\d+\.\d+-canary\.[0-9A-Za-z.-]+$/;

function requireUrl(origin, file) {
  if (
    typeof file?.path !== "string" ||
    !file.path ||
    !/^[a-f0-9]{64}$/.test(file.sha256 || "")
  )
    throw new TypeError("CDN compatibility file metadata is invalid");
  return `${new URL(file.path, `${origin.replace(/\/+$/, "")}/`)}#sha256=${file.sha256}`;
}

function replaceSingleMetadataLine(lines, name, value) {
  const pattern = new RegExp(`^// @${name}\\s+`);
  const indexes = lines
    .map((line, index) => (pattern.test(line) ? index : -1))
    .filter((index) => index !== -1);
  if (indexes.length !== 1)
    throw new Error(`Expected exactly one userscript @${name}`);
  lines[indexes[0]] = `// @${name.padEnd(12)} ${value}`;
}

function createMetadata(options, { versionPattern, qaIdentity }) {
  const {
    metadata,
    version,
    compatibilityOrigin,
    manifest,
    thirdPartyRequireUrls,
  } = options || {};
  if (
    typeof metadata !== "string" ||
    !versionPattern.test(version || "") ||
    typeof compatibilityOrigin !== "string" ||
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
    .map((line, index) =>
      VERSION_LINE_PATTERN.test(line) ? index : -1,
    )
    .filter((index) => index !== -1);
  if (versionIndexes.length !== 1)
    throw new Error("Expected exactly one userscript @version");
  lines[versionIndexes[0]] = `// @version      ${version}`;

  if (qaIdentity) {
    replaceSingleMetadataLine(lines, "name", "LuoguSP QA");
    replaceSingleMetadataLine(
      lines,
      "namespace",
      "https://github.com/ShanireZ/LuoguSP/qa",
    );
    const descriptionIndex = lines.findIndex((line) =>
      /^\/\/ @description\s+/.test(line),
    );
    if (descriptionIndex === -1)
      throw new Error("Expected one userscript @description");
    lines[descriptionIndex] =
      `// @description  [QA ${version}] hidden-intro 原生优先与按需 renderer 验收`;
    replaceSingleMetadataLine(
      lines,
      "grant",
      "GM_xmlhttpRequest",
    );
    const grantIndex = lines.findIndex((line) =>
      /^\/\/ @grant\s+GM_xmlhttpRequest$/.test(line),
    );
    if (grantIndex === -1)
      throw new Error("Expected one userscript @grant");
    lines.splice(
      grantIndex,
      0,
      "// @sandbox      raw",
      "// @connect      spcdn.betaoi.cc",
    );
  }

  const withoutRequires = lines.filter(
    (line) =>
      !REQUIRE_PATTERN.test(line) &&
      (!qaIdentity ||
        !/^\/\/ @(?:updateURL|downloadURL)\s+/.test(line)),
  );
  const runAtIndex = withoutRequires.findIndex((line) =>
    /^\/\/ @run-at\s+document-start$/.test(line),
  );
  if (runAtIndex === -1)
    throw new Error("Expected @run-at document-start in metadata");

  const firstParty = {
    earlyGate: requireUrl(
      compatibilityOrigin,
      manifest.compat.earlyGate,
    ),
    runtime: requireUrl(
      compatibilityOrigin,
      manifest.compat.runtime,
    ),
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

export function createStagedMetadata(options) {
  return createMetadata(options, {
    versionPattern: STABLE_VERSION_PATTERN,
    qaIdentity: false,
  });
}

export function createQaStagedMetadata(options) {
  return createMetadata(options, {
    versionPattern: CANARY_VERSION_PATTERN,
    qaIdentity: true,
  });
}
