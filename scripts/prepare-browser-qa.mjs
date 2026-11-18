import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInjection } from "./qa/build-injection.mjs";

const { payload } = await buildInjection();
const directory = await mkdtemp(join(tmpdir(), "luogusp-browser-qa-"));
const outputPath = join(directory, "inject.js");

await writeFile(outputPath, payload, "utf8");
console.log(outputPath);
