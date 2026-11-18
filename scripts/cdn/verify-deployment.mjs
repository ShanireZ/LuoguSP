import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, releaseManifestPath } from "./release-integrity.mjs";
import { fetchVerified } from "./verify-lib.mjs";

export async function verifyDeployment({ root, origin, channelBody, manifestBody }) {
  const channel = JSON.parse(channelBody);
  const manifest = JSON.parse(manifestBody);
  if (digest(manifestBody) !== channel.manifestSha256)
    throw new Error("Local manifest does not match canary channel SHA-256");
  if (channel.schemaVersion >= 2 && channel.origin !== origin)
    throw new Error("Canary channel origin differs from configured CDN");
  if (manifest.schemaVersion >= 3 && manifest.origin !== origin)
    throw new Error("Release manifest origin differs from configured CDN");

  const files = [
    [channel.manifestPath, channel.manifestSha256],
    [releaseManifestPath(manifest.release), channel.manifestSha256],
    ...Object.entries(manifest.files).map(([path, { sha256 }]) => [path, sha256]),
  ];
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
          files: files.length,
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

  for (const [path, expected] of files)
    await verifyPath(path, expected);
  await verifyPath(
    "channels/canary.json",
    digest(channelBody),
    true,
  );
  await writeReport("ready");
  console.log(
    `Verified ${files.length} immutable files on ${origin}.`,
  );
}
