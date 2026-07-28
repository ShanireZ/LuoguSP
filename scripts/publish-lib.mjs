import { createHash } from "node:crypto";
import { resolveBootstrapOrigin } from "./cdn/origin-policy.mjs";

const VERSION_PATTERN = /^\/\/ @version\s+(\S+)$/gm;
const REQUIRE_PATTERN = /^\/\/ @require\s+(\S+)$/gm;

export function userscriptVersion(metadata) {
  const versions = [
    ...String(metadata || "").matchAll(VERSION_PATTERN),
  ].map((match) => match[1]);
  if (
    versions.length !== 1 ||
    !/^\d+\.\d+\.\d+$/.test(versions[0])
  )
    throw new Error(
      "Userscript metadata must contain exactly one stable @version",
    );
  return versions[0];
}

export function isResumablePublish(report, version) {
  return Boolean(
    report &&
      report.status === "blocked" &&
      report.release === version &&
      report.deploymentStarted === true,
  );
}

export function userscriptMetadata(artifact) {
  const source = String(artifact || "");
  const closing = "// ==/UserScript==";
  const end = source.indexOf(closing);
  if (!source.startsWith("// ==UserScript==") || end === -1)
    throw new Error("Staged userscript header is incomplete");
  return `${source.slice(0, end + closing.length).trimEnd()}\n`;
}

export function packageTextWithVersion(text, version) {
  const document = JSON.parse(text);
  document.version = version;
  if (document.packages?.[""])
    document.packages[""].version = version;
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function readmeTextWithVersion(text, version) {
  const lines = String(text).split(/\r?\n/);
  const indexes = lines
    .map((line, index) =>
      /^\[!\[Version: \d+\.\d+\.\d+\]\(https:\/\/img\.shields\.io\/badge\/version-\d+\.\d+\.\d+-/.test(
        line,
      )
        ? index
        : -1,
    )
    .filter((index) => index !== -1);
  if (indexes.length !== 1)
    throw new Error("README must contain exactly one version badge");
  lines[indexes[0]] = lines[indexes[0]]
    .replace(/Version: \d+\.\d+\.\d+/, `Version: ${version}`)
    .replace(/\/version-\d+\.\d+\.\d+-/, `/version-${version}-`);
  return lines.join("\n");
}

const compatibilityUrl = (origin, file) =>
  `${new URL(
    file.path,
    `${origin.replace(/\/+$/, "")}/`,
  )}#sha256=${file.sha256}`;

export function verifyStagedActivation(options) {
  const {
    artifact,
    version,
    manifest,
    config,
    thirdPartyRequireUrls,
  } = options || {};
  const metadata = userscriptMetadata(artifact);
  if (userscriptVersion(metadata) !== version)
    throw new Error("Staged userscript version differs from release");
  if (
    manifest?.release !== version ||
    manifest?.esm?.enabled !== false
  )
    throw new Error("Staged userscript manifest is not production-ready");

  const requires = [
    ...metadata.matchAll(REQUIRE_PATTERN),
  ].map((match) => match[1]);
  const bootstrapOrigin = resolveBootstrapOrigin(config);
  const expected = [
    compatibilityUrl(
      bootstrapOrigin,
      manifest.compat.earlyGate,
    ),
    ...thirdPartyRequireUrls,
    compatibilityUrl(
      bootstrapOrigin,
      manifest.compat.runtime,
    ),
  ];
  if (JSON.stringify(requires) !== JSON.stringify(expected))
    throw new Error(
      "Staged userscript does not pin the verified compatibility runtime",
    );
  if (
    String(artifact).includes("/channels/")
  )
    throw new Error(
      "Staged userscript must not execute mutable channel code",
    );
  const bytes = Buffer.byteLength(String(artifact));
  if (bytes > 5000)
    throw new Error("Staged userscript exceeds the 5000-byte loader budget");
  return Object.freeze({
    metadata,
    requires: Object.freeze(requires),
    bytes,
    sha256: createHash("sha256")
      .update(String(artifact))
      .digest("hex"),
  });
}
