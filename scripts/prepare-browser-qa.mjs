import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = join(projectRoot, "LuoguSP.user.js");
const artifact = await readFile(artifactPath, "utf8");
const requireUrls = [...artifact.matchAll(/^\/\/ @require\s+(\S+)/gm)].map(
  (match) => match[1],
);

const dependencies = [];
for (const url of requireUrls) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  dependencies.push(
    `${await response.text()}\n//# sourceURL=luogusp-qa/${basename(new URL(url).pathname)}`,
  );
}

const directory = await mkdtemp(join(tmpdir(), "luogusp-browser-qa-"));
const outputPath = join(directory, "inject.js");
const payload = [
  "globalThis.__LUOGUSP_QA_START = performance.now();",
  ...dependencies,
  artifact,
  "globalThis.__LUOGUSP_QA_END = performance.now();",
  "//# sourceURL=luogusp-qa/inject.js",
].join("\n;\n");

await writeFile(outputPath, payload, "utf8");
console.log(outputPath);
