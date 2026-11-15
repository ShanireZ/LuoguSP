import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolveConfiguredOrigin } from "./origin-policy.mjs";
import { prepareCdn } from "./prepare-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
  options: { output: { type: "string" } },
});
const config = JSON.parse(await readFile(resolve(root, "config/cdn.json"), "utf8"));
await prepareCdn({ root, explicitOutput: values.output, origin: resolveConfiguredOrigin({ config }) });
