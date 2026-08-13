import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveBootstrapOrigin,
  resolveConfiguredOrigin,
} from "./origin-policy.mjs";
import { fetchVerified } from "./verify-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const version = argument("--version");
const qaMode = process.argv.includes("--qa");
const versionPattern = qaMode
  ? /^\d+\.\d+\.\d+-canary\.[0-9A-Za-z.-]+$/
  : /^\d+\.\d+\.\d+$/;
if (!versionPattern.test(version || ""))
  throw new Error(
    qaMode
      ? "Pass a canary release version with --version"
      : "Pass a stable release version with --version",
  );
const stagedRelativePath = qaMode
  ? `dist/qa/LuoguSP-QA.${version}.user.js`
  : `dist/staged/LuoguSP.${version}.user.js`;

const [configText, manifestBody, stagedArtifact] =
  await Promise.all([
    readFile(resolve(root, "config/cdn.json"), "utf8"),
    readFile(resolve(root, `cdn/releases/${version}/manifest.json`)),
    readFile(resolve(root, stagedRelativePath), "utf8"),
  ]);
const config = JSON.parse(configText);
const manifest = JSON.parse(manifestBody);
const digest = (body) =>
  createHash("sha256").update(body).digest("hex");
const manifestSha256 = digest(manifestBody);
const manifestPath =
  `releases/${version}/manifest.${manifestSha256.slice(0, 16)}.json`;
const failures = [];
const origin = resolveConfiguredOrigin({ config });
const bootstrapOrigin = resolveBootstrapOrigin(config);

if (manifest.release !== version)
  failures.push("manifest release differs from requested version");
if (manifest.esm?.enabled !== false)
  failures.push("dynamic ESM must remain disabled for first production");
if (manifest.schemaVersion >= 3) {
  try {
    if (
      new URL(manifest.origin).origin !== origin ||
      manifest.origin !== origin
    )
      failures.push("manifest origin differs from configured CDN");
  } catch {
    failures.push("manifest origin is not a valid HTTPS origin");
  }
}
try {
  const pinnedManifest = await readFile(
    resolve(root, "cdn", manifestPath),
  );
  if (!pinnedManifest.equals(manifestBody))
    failures.push("hashed manifest differs from manifest.json");
} catch (error) {
  failures.push(`hashed manifest is missing: ${error.message}`);
}

const metadataEnd = stagedArtifact.indexOf("// ==/UserScript==");
if (metadataEnd === -1)
  failures.push("staged userscript metadata is incomplete");
const stagedRequires = [
  ...stagedArtifact.matchAll(/^\/\/ @require\s+(\S+)$/gm),
].map((match) => match[1]);
const compatibilityUrl = (file) =>
  `${new URL(file.path, `${bootstrapOrigin}/`)}#sha256=${file.sha256}`;
const expectedRequires = [
  compatibilityUrl(manifest.compat.earlyGate),
  compatibilityUrl(manifest.compat.runtime),
];
if (JSON.stringify(stagedRequires) !== JSON.stringify(expectedRequires))
  failures.push("staged userscript @require order or hashes differ");
if (stagedArtifact.includes("/channels/"))
  failures.push("staged userscript must not load a mutable channel");
if (Buffer.byteLength(stagedArtifact) > 5000)
  failures.push("staged userscript loader exceeds 5000 bytes");
// 受限内容按需块：清单声明了就必须钉全。这里不强制它「必须存在」——
// 老 release（2.14.0 之前）没有这个块，而「必须存在」由构建侧的结构守卫
// （test/restricted-lazy-bundle.test.mjs）无条件盯着。
const optionalRestricted = manifest.optionalBundles?.restrictedContent;
if (optionalRestricted) {
  const restrictedFile = manifest.files?.[optionalRestricted.path];
  if (
    !restrictedFile ||
    optionalRestricted.apiVersion !== 1 ||
    optionalRestricted.bytes !== restrictedFile.bytes ||
    optionalRestricted.sha256 !== restrictedFile.sha256 ||
    optionalRestricted.sri !== restrictedFile.sri
  )
    failures.push("manifest does not pin a complete restricted content bundle");
}
const optionalRenderer = manifest.optionalBundles?.markdownRenderer;
const optionalRendererFile =
  optionalRenderer?.path && manifest.files?.[optionalRenderer.path];
if (
  !optionalRenderer ||
  !optionalRendererFile ||
  optionalRenderer.apiVersion !== 1 ||
  optionalRenderer.path !== optionalRendererFile.path ||
  optionalRenderer.bytes !== optionalRendererFile.bytes ||
  optionalRenderer.sha256 !== optionalRendererFile.sha256 ||
  optionalRenderer.sri !== optionalRendererFile.sri
)
  failures.push("manifest does not pin a complete optional renderer");

const paths = [manifestPath, ...Object.keys(manifest.files)];
const results = [];
for (const path of paths) {
  const url = new URL(path, `${origin}/`);
  const expected =
    path === manifestPath
      ? manifestSha256
      : manifest.files[path].sha256;
  try {
    const verified = await fetchVerified({
      url,
      check: (response, body) => {
        const actual = digest(body);
        const contentType =
          response.headers.get("content-type") || "";
        const cacheControl =
          response.headers.get("cache-control") || "";
        const cors =
          response.headers.get("access-control-allow-origin") || "";
        return {
          path,
          status: response.status,
          bytes: body.length,
          sha256: actual,
          contentType,
          cacheControl,
          cors,
          ok:
            response.ok &&
            actual === expected &&
            cors === "*" &&
            cacheControl.includes("immutable") &&
            (path.endsWith(".json")
              ? contentType.includes("json")
              : contentType.includes("javascript")),
        };
      },
      onRetry: (failure, delayMs, nextAttempt) => {
        console.error(
          `[production-gate] RETRY ${path}: attempt ${failure.attempt} failed (${failure.status ?? failure.error}); waiting ${delayMs}ms before attempt ${nextAttempt}`,
        );
      },
    });
    results.push(verified.result);
  } catch (error) {
    results.push({
      path,
      attempts: error.history?.length || 1,
      attemptHistory: error.history || [],
      lastResult: error.lastResult || null,
      ok: false,
      error: error.message,
    });
    failures.push(
      `CDN failed ${path} after ${error.history?.length || 1} attempt(s): ${JSON.stringify(error.lastResult || error.message)}`,
    );
  }
}

const uniqueFailures = [...new Set(failures)];
const status = uniqueFailures.length ? "blocked" : "ready";
const report = {
  checkedAt: new Date().toISOString(),
  status,
  release: version,
  manifestPath,
  manifestSha256,
  origin,
  stagedUserscript: {
    path: stagedRelativePath,
    bytes: Buffer.byteLength(stagedArtifact),
    requires: stagedRequires.length,
  },
  files: paths.length,
  dynamicEsmEnabled: manifest.esm.enabled,
  optionalBundles: manifest.optionalBundles || {},
  failures: uniqueFailures,
  results,
};
await writeFile(
  resolve(
    root,
    qaMode
      ? "reports/cdn-qa-readiness.json"
      : "reports/cdn-production-readiness.json",
  ),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
if (uniqueFailures.length) {
  console.error(
    `Production CDN gate blocked with ${uniqueFailures.length} failure(s).`,
  );
  uniqueFailures
    .slice(0, 8)
    .forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `Production CDN gate ready: ${paths.length} immutable files verified on ${origin}.`,
  );
}
