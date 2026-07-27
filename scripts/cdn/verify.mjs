import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfiguredOrigins } from "./origin-policy.mjs";
import { fetchVerified } from "./verify-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const primaryOverride = argument("--primary");
const fallbackOverride = argument("--fallback");
if (!primaryOverride || !fallbackOverride)
  throw new Error("Pass --primary and --fallback CDN origins");

const [channelText, configText] = await Promise.all([
  readFile(resolve(root, "cdn/channels/canary.json"), "utf8"),
  readFile(resolve(root, "config/cdn.json"), "utf8"),
]);
const channel = JSON.parse(channelText);
const config = JSON.parse(configText);
const { primary, fallback } = resolveConfiguredOrigins({
  config,
  primaryOverride,
  fallbackOverride,
});
const manifestFile = resolve(root, "cdn", channel.manifestPath);
const manifestBody = await readFile(manifestFile);
const manifest = JSON.parse(manifestBody);
const digest = (body) => createHash("sha256").update(body).digest("hex");
if (digest(manifestBody) !== channel.manifestSha256)
  throw new Error("Local manifest does not match canary channel SHA-256");

const originRecord = (id, value) => {
  const url = new URL(value);
  return {
    id,
    url: url.origin,
    previewTokenUsed: false,
  };
};
const origins = [
  originRecord("primary", primary),
  originRecord("fallback", fallback),
];
const configuredRequiredOriginIds = config.verification?.requiredOriginIds;
const requiredOriginIds = new Set(
  Array.isArray(configuredRequiredOriginIds)
    ? configuredRequiredOriginIds
    : origins.map((origin) => origin.id),
);
if (
  !requiredOriginIds.size ||
  [...requiredOriginIds].some(
    (id) => !origins.some((origin) => origin.id === id),
  )
)
  throw new Error(
    "verification.requiredOriginIds must name configured origins",
  );
const assetUrl = (base, path) => {
  const url = new URL(base);
  url.pathname = `/${String(path).replace(/^\/+/, "")}`;
  return url.toString();
};
const results = [];
const remoteBodies = new Map();
const optionalFailures = [];
const unavailableOrigins = new Set();
const writeReport = async (status, failure = null) => {
  const report = {
    checkedAt: new Date().toISOString(),
    status,
    release: manifest.release,
    manifestPath: channel.manifestPath,
    manifestSha256: channel.manifestSha256,
    optionalBundles: manifest.optionalBundles || {},
    origins: origins.map((origin) => ({
      id: origin.id,
      url: origin.url,
      required: requiredOriginIds.has(origin.id),
      previewTokenUsed: origin.previewTokenUsed,
    })),
    filesPerOrigin: Object.keys(manifest.files).length + 1,
    byteIdentical: status === "ready",
    failure,
    optionalFailures,
    results,
  };
  await writeFile(
    resolve(root, "reports/cdn-deployment.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
};
const retryNotice = (origin, path) => (failure, delayMs, nextAttempt) => {
  console.error(
    `[verify] RETRY ${origin} ${path}: attempt ${failure.attempt} failed (${failure.status ?? failure.error}); waiting ${delayMs}ms before attempt ${nextAttempt}`,
  );
};
for (const origin of origins) {
  const paths = [channel.manifestPath, ...Object.keys(manifest.files)];
  for (const path of paths) {
    const url = assetUrl(origin.url, path);
    const expected =
      path === channel.manifestPath
        ? channel.manifestSha256
        : manifest.files[path].sha256;
    let verified;
    try {
      verified = await fetchVerified({
        url,
        delaysMs: requiredOriginIds.has(origin.id) ? undefined : [0],
        timeoutMs: requiredOriginIds.has(origin.id) ? undefined : 5000,
        check: (response, body) => {
          const actual = digest(body);
          const contentType = response.headers.get("content-type") || "";
          const cacheControl = response.headers.get("cache-control") || "";
          const cors =
            response.headers.get("access-control-allow-origin") || "";
          return {
            origin: origin.id,
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
        onRetry: retryNotice(origin.id, path),
      });
    } catch (error) {
      const failure = {
        origin: origin.id,
        path,
        attempts: error.history?.length || 1,
        attemptHistory: error.history || [],
        lastResult: error.lastResult || null,
        error: error.message,
      };
      results.push({
        origin: origin.id,
        path,
        ok: false,
        ...failure,
      });
      unavailableOrigins.add(origin.id);
      if (requiredOriginIds.has(origin.id)) {
        await writeReport("blocked", failure);
        throw new Error(
          `CDN verification failed for required ${origin.id} ${path} after ${failure.attempts} attempt(s): ${JSON.stringify(failure.lastResult)}`,
        );
      }
      optionalFailures.push(failure);
      console.error(
        `[verify] DEGRADED optional ${origin.id} is unavailable; continuing with required origins`,
      );
      break;
    }
    const { body, result } = verified;
    results.push(result);
    const previous = remoteBodies.get(path);
    if (previous && !previous.equals(body)) {
      const failure = {
        origin: origin.id,
        path,
        error: "CDN origins returned different bytes",
      };
      await writeReport("blocked", failure);
      throw new Error(`CDN origins differ for ${path}`);
    }
    remoteBodies.set(path, body);
  }
}

const localChannel = await readFile(resolve(root, "cdn/channels/canary.json"));
for (const origin of origins) {
  const path = "channels/canary.json";
  if (unavailableOrigins.has(origin.id)) {
    results.push({
      origin: origin.id,
      path,
      ok: false,
      skipped: "optional origin unavailable",
    });
    continue;
  }
  try {
    const verified = await fetchVerified({
      url: assetUrl(origin.url, path),
      delaysMs: requiredOriginIds.has(origin.id) ? undefined : [0],
      timeoutMs: requiredOriginIds.has(origin.id) ? undefined : 5000,
      check: (response, body) => {
        const cacheControl = response.headers.get("cache-control") || "";
        return {
          origin: origin.id,
          path,
          status: response.status,
          bytes: body.length,
          sha256: digest(body),
          contentType: response.headers.get("content-type") || "",
          cacheControl,
          cors: response.headers.get("access-control-allow-origin") || "",
          ok:
            response.ok &&
            body.equals(localChannel) &&
            cacheControl.includes("no-cache"),
        };
      },
      onRetry: retryNotice(origin.id, path),
    });
    results.push(verified.result);
  } catch (error) {
    const failure = {
      origin: origin.id,
      path,
      attempts: error.history?.length || 1,
      attemptHistory: error.history || [],
      lastResult: error.lastResult || null,
      error: error.message,
    };
    results.push({
      origin: origin.id,
      path,
      ok: false,
      ...failure,
    });
    if (requiredOriginIds.has(origin.id)) {
      await writeReport("blocked", failure);
      throw new Error(
        `Canary channel verification failed for required ${origin.id} after ${failure.attempts} attempt(s): ${JSON.stringify(failure.lastResult)}`,
      );
    }
    optionalFailures.push(failure);
    console.error(
      `[verify] DEGRADED optional ${origin.id} canary is unavailable`,
    );
  }
}

const finalStatus = optionalFailures.length ? "degraded" : "ready";
await writeReport(finalStatus);
if (finalStatus === "ready")
  console.log(
    `Verified ${Object.keys(manifest.files).length + 1} immutable files on both CDN origins.`,
  );
else
  console.log(
    `Verified ${Object.keys(manifest.files).length + 1} immutable files on every required CDN origin; ${optionalFailures.length} optional mirror failure(s) recorded.`,
  );
