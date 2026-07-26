import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const version = argument("--version");
if (!/^\d+\.\d+\.\d+$/.test(version || ""))
  throw new Error("Pass a stable release version with --version");

const [configText, budgetText, manifestBody, stagedArtifact] =
  await Promise.all([
    readFile(resolve(root, "config/cdn.json"), "utf8"),
    readFile(resolve(root, "config/quality-budget.json"), "utf8"),
    readFile(
      resolve(root, `cdn/releases/${version}/manifest.json`),
    ),
    readFile(
      resolve(root, `dist/staged/LuoguSP.${version}.user.js`),
      "utf8",
    ),
  ]);
const config = JSON.parse(configText);
const budget = JSON.parse(budgetText);
const manifest = JSON.parse(manifestBody);
const digest = (body) =>
  createHash("sha256").update(body).digest("hex");
const manifestSha256 = digest(manifestBody);
const manifestPath =
  `releases/${version}/manifest.${manifestSha256.slice(0, 16)}.json`;
const failures = [];

if (manifest.release !== version)
  failures.push("manifest release differs from requested version");
if (manifest.esm?.enabled !== false)
  failures.push("dynamic ESM must remain disabled for first production");
try {
  const pinnedManifest = await readFile(
    resolve(root, "cdn", manifestPath),
  );
  if (!pinnedManifest.equals(manifestBody))
    failures.push("hashed manifest differs from manifest.json");
} catch (error) {
  failures.push(`hashed manifest is missing: ${error.message}`);
}

const originRecords = [
  { id: "primary", url: config.origins.primary },
  { id: "fallback", url: config.origins.fallback },
].map((origin) => {
  const url = new URL(origin.url);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    failures.push(`${origin.id} must be a clean HTTPS origin`);
  if (
    url.hostname.endsWith(".workers.dev") ||
    url.hostname.endsWith(".edgeone.cool")
  )
    failures.push(`${origin.id} must use a long-lived custom domain`);
  return { ...origin, url: url.origin };
});
if (
  new URL(originRecords[0].url).hostname ===
  new URL(originRecords[1].url).hostname
)
  failures.push("primary and fallback must use different hosts");

const metadataEnd = stagedArtifact.indexOf("// ==/UserScript==");
if (metadataEnd === -1)
  failures.push("staged userscript metadata is incomplete");
const stagedRequires = [
  ...stagedArtifact.matchAll(/^\/\/ @require\s+(\S+)$/gm),
].map((match) => match[1]);
const compatibilityUrl = (origin, file) =>
  `${new URL(file.path, `${origin}/`)}#sha256=${file.sha256}`;
const expectedRequires = [
  compatibilityUrl(
    originRecords[0].url,
    manifest.compat.earlyGate,
  ),
  ...budget.requires.resources.map((resource) => resource.url),
  compatibilityUrl(
    originRecords[0].url,
    manifest.compat.runtime,
  ),
];
if (
  JSON.stringify(stagedRequires) !==
  JSON.stringify(expectedRequires)
)
  failures.push("staged userscript @require order or hashes differ");
if (stagedArtifact.includes("/channels/"))
  failures.push("staged userscript must not load a mutable channel");
if (stagedArtifact.includes(config.origins.fallback))
  failures.push("staged userscript must not execute both runtimes");
if (Buffer.byteLength(stagedArtifact) > 5000)
  failures.push("staged userscript loader exceeds 5000 bytes");

const paths = [manifestPath, ...Object.keys(manifest.files)];
const remoteBodies = new Map();
const results = [];
const fetchRemote = async (url) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (response.status >= 500 && attempt < 5) continue;
      return { response, body, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < 5)
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, attempt * 250),
        );
    }
  }
  throw lastError;
};
for (const origin of originRecords) {
  let originAvailable = true;
  for (const path of paths) {
    if (!originAvailable) {
      results.push({
        origin: origin.id,
        path,
        ok: false,
        skipped: "origin unavailable",
      });
      continue;
    }
    const url = new URL(path, `${origin.url}/`);
    try {
      const { response, body, attempts } = await fetchRemote(url);
      const expected =
        path === manifestPath
          ? manifestSha256
          : manifest.files[path].sha256;
      const actual = digest(body);
      const contentType =
        response.headers.get("content-type") || "";
      const cacheControl =
        response.headers.get("cache-control") || "";
      const cors =
        response.headers.get("access-control-allow-origin") || "";
      const ok =
        response.ok &&
        actual === expected &&
        cors === "*" &&
        cacheControl.includes("immutable") &&
        (path.endsWith(".json")
          ? contentType.includes("json")
          : contentType.includes("javascript"));
      results.push({
        origin: origin.id,
        path,
        status: response.status,
        bytes: body.length,
        sha256: actual,
        contentType,
        cacheControl,
        cors,
        attempts,
        ok,
      });
      if (!ok)
        failures.push(`${origin.id} failed response checks for ${path}`);
      const previous = remoteBodies.get(path);
      if (previous && !previous.equals(body))
        failures.push(`custom domains differ for ${path}`);
      if (ok) remoteBodies.set(path, body);
    } catch (error) {
      results.push({
        origin: origin.id,
        path,
        ok: false,
        error: error.message,
      });
      failures.push(`${origin.id} unavailable for ${path}: ${error.message}`);
      originAvailable = false;
    }
  }
}

const uniqueFailures = [...new Set(failures)];
const report = {
  checkedAt: new Date().toISOString(),
  status: uniqueFailures.length ? "blocked" : "ready",
  release: version,
  manifestPath,
  manifestSha256,
  origins: originRecords,
  stagedUserscript: {
    path: `dist/staged/LuoguSP.${version}.user.js`,
    bytes: Buffer.byteLength(stagedArtifact),
    requires: stagedRequires.length,
  },
  filesPerOrigin: paths.length,
  dynamicEsmEnabled: manifest.esm.enabled,
  failures: uniqueFailures,
  results,
};
await writeFile(
  resolve(root, "reports/cdn-production-readiness.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
if (uniqueFailures.length) {
  console.error(
    `Production CDN gate blocked with ${uniqueFailures.length} failure(s).`,
  );
  uniqueFailures.slice(0, 8).forEach((failure) =>
    console.error(`- ${failure}`),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Production CDN gate ready: ${paths.length} immutable files verified on both custom domains.`,
  );
}
