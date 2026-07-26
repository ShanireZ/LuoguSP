import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const primary = argument("--primary");
const fallback = argument("--fallback");
if (!primary || !fallback)
  throw new Error("Pass --primary and --fallback CDN origins");

const channel = JSON.parse(
  await readFile(resolve(root, "cdn/channels/canary.json"), "utf8"),
);
const manifestFile = resolve(
  root,
  "cdn",
  channel.manifestPath,
);
const manifestBody = await readFile(manifestFile);
const manifest = JSON.parse(manifestBody);
const digest = (body) =>
  createHash("sha256").update(body).digest("hex");
if (digest(manifestBody) !== channel.manifestSha256)
  throw new Error("Local manifest does not match canary channel SHA-256");

const originRecord = (id, value) => {
  const url = new URL(value);
  const cookie = ["eo_token", "eo_time"]
    .map((key) => [key, url.searchParams.get(key)])
    .filter(([, item]) => item)
    .map(([key, item]) => `${key}=${item}`)
    .join("; ");
  return {
    id,
    url: url.origin,
    previewTokenUsed: Boolean(cookie),
    headers: cookie ? { Cookie: cookie } : {},
  };
};
const origins = [
  originRecord("primary", primary),
  originRecord("fallback", fallback),
];
const assetUrl = (base, path) => {
  const url = new URL(base);
  url.pathname = `/${String(path).replace(/^\/+/, "")}`;
  return url.toString();
};
const results = [];
const remoteBodies = new Map();
for (const origin of origins) {
  const paths = [channel.manifestPath, ...Object.keys(manifest.files)];
  for (const path of paths) {
    const url = assetUrl(origin.url, path);
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      headers: origin.headers,
    });
    const body = Buffer.from(await response.arrayBuffer());
    const expected =
      path === channel.manifestPath
        ? channel.manifestSha256
        : manifest.files[path].sha256;
    const actual = digest(body);
    const contentType = response.headers.get("content-type") || "";
    const cacheControl = response.headers.get("cache-control") || "";
    const cors = response.headers.get("access-control-allow-origin") || "";
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
      ok,
    });
    if (!ok)
      throw new Error(
        `CDN verification failed for ${origin.id} ${path}: ${JSON.stringify(results.at(-1))}`,
      );
    const previous = remoteBodies.get(path);
    if (previous && !previous.equals(body))
      throw new Error(`CDN origins differ for ${path}`);
    remoteBodies.set(path, body);
  }
}

for (const origin of origins) {
  const response = await fetch(assetUrl(origin.url, "channels/canary.json"), {
    cache: "no-store",
    headers: origin.headers,
  });
  const remote = Buffer.from(await response.arrayBuffer());
  const local = await readFile(
    resolve(root, "cdn/channels/canary.json"),
  );
  const cacheControl = response.headers.get("cache-control") || "";
  if (
    !response.ok ||
    !remote.equals(local) ||
    !cacheControl.includes("no-cache")
  )
    throw new Error(`Canary channel verification failed for ${origin.id}`);
}

const report = {
  checkedAt: new Date().toISOString(),
  release: manifest.release,
  manifestPath: channel.manifestPath,
  manifestSha256: channel.manifestSha256,
  origins: origins.map((origin) => ({
    id: origin.id,
    url: origin.url,
    previewTokenUsed: origin.previewTokenUsed,
  })),
  filesPerOrigin: Object.keys(manifest.files).length + 1,
  byteIdentical: true,
  results,
};
await writeFile(
  resolve(root, "reports/cdn-deployment.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(
  `Verified ${report.filesPerOrigin} immutable files on both CDN origins.`,
);
