import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfiguredOrigin } from "./origin-policy.mjs";
import { fetchVerified } from "./verify-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const originOverride = argument("--origin");
if (!originOverride) throw new Error("Pass --origin for the CDN");

const [channelText, configText] = await Promise.all([
  readFile(resolve(root, "cdn/channels/canary.json"), "utf8"),
  readFile(resolve(root, "config/cdn.json"), "utf8"),
]);
const channel = JSON.parse(channelText);
const config = JSON.parse(configText);
const origin = resolveConfiguredOrigin({
  config,
  originOverride,
});
const manifestBody = await readFile(
  resolve(root, "cdn", channel.manifestPath),
);
const manifest = JSON.parse(manifestBody);
const digest = (body) =>
  createHash("sha256").update(body).digest("hex");
if (digest(manifestBody) !== channel.manifestSha256)
  throw new Error("Local manifest does not match canary channel SHA-256");
if (channel.schemaVersion >= 2 && channel.origin !== origin)
  throw new Error("Canary channel origin differs from configured CDN");
if (manifest.schemaVersion >= 3 && manifest.origin !== origin)
  throw new Error("Release manifest origin differs from configured CDN");

const assetUrl = (path) =>
  new URL(
    String(path).replace(/^\/+/, ""),
    `${origin.replace(/\/+$/, "")}/`,
  );
const results = [];
const writeReport = async (status, failure = null) => {
  await writeFile(
    resolve(root, "reports/cdn-deployment.json"),
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        status,
        release: manifest.release,
        manifestPath: channel.manifestPath,
        manifestSha256: channel.manifestSha256,
        optionalBundles: manifest.optionalBundles || {},
        origin,
        files: Object.keys(manifest.files).length + 1,
        failure,
        results,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};
const verifyPath = async (path, expected, channelFile = false) => {
  try {
    const verified = await fetchVerified({
      url: assetUrl(path),
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
            (channelFile
              ? cacheControl.includes("no-cache")
              : cacheControl.includes("immutable")) &&
            (path.endsWith(".json")
              ? contentType.includes("json")
              : contentType.includes("javascript")),
        };
      },
      onRetry: (failure, delayMs, nextAttempt) => {
        console.error(
          `[verify] RETRY ${path}: attempt ${failure.attempt} failed (${failure.status ?? failure.error}); waiting ${delayMs}ms before attempt ${nextAttempt}`,
        );
      },
    });
    results.push(verified.result);
  } catch (error) {
    const failure = {
      path,
      attempts: error.history?.length || 1,
      attemptHistory: error.history || [],
      lastResult: error.lastResult || null,
      error: error.message,
    };
    results.push({ path, ok: false, ...failure });
    await writeReport("blocked", failure);
    throw new Error(
      `CDN verification failed for ${path}: ${JSON.stringify(failure.lastResult)}`,
    );
  }
};

for (const path of [
  channel.manifestPath,
  ...Object.keys(manifest.files),
]) {
  const expected =
    path === channel.manifestPath
      ? channel.manifestSha256
      : manifest.files[path].sha256;
  await verifyPath(path, expected);
}
await verifyPath(
  "channels/canary.json",
  digest(Buffer.from(channelText)),
  true,
);
await writeReport("ready");
console.log(
  `Verified ${Object.keys(manifest.files).length + 1} immutable files on ${origin}.`,
);
