import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectReleaseIntegrityProblems,
  releaseIntegrityError,
} from "./release-integrity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "dist/cdn");
const distRoot = resolve(root, "dist");
if (output === distRoot || !output.startsWith(`${distRoot}${sep}`))
  throw new Error("Refusing to replace an unexpected deployment directory");

// This directory is copied verbatim to the CDN, so the last chance to notice a
// working tree that no longer matches the committed bytes is here — before the
// upload, not after it.
const problems = await collectReleaseIntegrityProblems({
  releasesDir: resolve(root, "cdn/releases"),
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path),
  digest: (body) => createHash("sha256").update(body).digest("hex"),
  join: (...parts) => resolve(...parts),
});
if (problems.length) throw releaseIntegrityError(problems);
console.log(
  `Release integrity verified for ${(await readdir(resolve(root, "cdn/releases"))).length} releases.`,
);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "cdn/releases"), resolve(output, "releases"), {
  recursive: true,
});
await cp(resolve(root, "cdn/channels"), resolve(output, "channels"), {
  recursive: true,
});
const channel = JSON.parse(
  await readFile(resolve(root, "cdn/channels/canary.json"), "utf8"),
);
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>LuoguSP CDN</title></head><body><h1>LuoguSP CDN</h1><p>Canary release: ${channel.release}</p></body></html>\n`,
  "utf8",
);
console.log(`Prepared ${output}`);
