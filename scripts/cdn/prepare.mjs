import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "dist/cdn");
const distRoot = resolve(root, "dist");
if (output === distRoot || !output.startsWith(`${distRoot}${sep}`))
  throw new Error("Refusing to replace an unexpected deployment directory");
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
