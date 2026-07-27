import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarkdownRenderer, sha256, sri } from "./build-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const body = await buildMarkdownRenderer({ root });
const hash = sha256(body);
const outputPath = resolve(
  root,
  "dist",
  `markdown-renderer.${hash.slice(0, 16)}.js`,
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, body);
console.log(
  JSON.stringify(
    {
      output: outputPath,
      bytes: body.length,
      sha256: hash,
      sri: sri(body),
    },
    null,
    2,
  ),
);
