import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectReleaseIntegrityProblems,
  releaseIntegrityError,
} from "./release-integrity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const output = resolve(root, argument("--output") || "dist/cdn");
const distRoot = resolve(root, "dist");
const sourceCdnRoot = resolve(root, "cdn");
const explicitOutput = argument("--output") !== null;
// ★★ 下面这一行紧接着就是 `rm(output, { recursive: true, force: true })`，
//    而**源目录也叫 `cdn`** —— 显式 `--output` 此前唯一的判据是 `basename === "cdn"`，
//    于是 `--output cdn` 会静静地把 `cdn/releases` 整个删掉，也就是这个脚本
//    存在的全部理由（那批字节被用户已安装脚本的 `@require #sha256=` 钉死，
//    删了就再也拼不回来，git 之外没有第二份）。测试用的是 tmpdir 下的 `cdn`，
//    所以这里挡住的只有「打到仓库源目录上」这一类，不影响它。
if (
  output === root ||
  output === distRoot ||
  basename(output) !== "cdn" ||
  output === sourceCdnRoot ||
  output.startsWith(`${sourceCdnRoot}${sep}`) ||
  (!explicitOutput && !output.startsWith(`${distRoot}${sep}`))
)
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

const channel = JSON.parse(
  await readFile(resolve(root, "cdn/channels/canary.json"), "utf8"),
);
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "releases"), { recursive: true });
const releases = await readdir(resolve(root, "cdn/releases"));
const stagedReleases = releases.filter(
  (release) => !release.includes("-canary.") || release === channel.release,
);
for (const release of stagedReleases) {
  await cp(
    resolve(root, "cdn/releases", release),
    resolve(output, "releases", release),
    { recursive: true },
  );
}
await cp(resolve(root, "cdn/channels"), resolve(output, "channels"), {
  recursive: true,
});
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>LuoguSP CDN</title></head><body><h1>LuoguSP CDN</h1><p>Canary release: ${channel.release}</p></body></html>\n`,
  "utf8",
);
console.log(
  `Prepared ${output} with ${stagedReleases.length} releases; only canary ${channel.release} is staged.`,
);
