import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfiguredOrigin } from "./origin-policy.mjs";
import { verifyDeployment } from "./verify-deployment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const originOverride = argument("--origin");
if (!originOverride) throw new Error("Pass --origin for the CDN");

const [channelBody, configText] = await Promise.all([
  readFile(resolve(root, "cdn/channels/canary.json")),
  readFile(resolve(root, "config/cdn.json"), "utf8"),
]);
const channel = JSON.parse(channelBody);
const config = JSON.parse(configText);
const origin = resolveConfiguredOrigin({
  config,
  originOverride,
});
const manifestBody = await readFile(
  resolve(root, "cdn", channel.manifestPath),
);
await verifyDeployment({ root, origin, channelBody, manifestBody });
