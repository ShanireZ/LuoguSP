import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveBootstrapOrigin,
  resolveConfiguredOrigin,
} from "../scripts/cdn/origin-policy.mjs";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const config = {
  origins: {
    primary: "https://spcdn.betaoi.cc",
    bootstrap: "https://spcdn.betaoi.cc",
  },
};

test("CDN tooling accepts only the configured Cloudflare custom origin", () => {
  assert.equal(
    resolveConfiguredOrigin({ config }),
    "https://spcdn.betaoi.cc",
  );
  assert.throws(
    () =>
      resolveConfiguredOrigin({
        config,
        originOverride: "https://example.workers.dev",
      }),
    /platform default domain/,
  );
  assert.throws(
    () =>
      resolveConfiguredOrigin({
        config,
        originOverride: "https://other.example.com",
      }),
    /must match config\/cdn\.json/,
  );
  assert.throws(
    () =>
      resolveConfiguredOrigin({
        config,
        originOverride: "https://spcdn.betaoi.cc/?token=preview",
      }),
    /clean HTTPS origin/,
  );
});

test("userscript bootstrap uses one configured custom origin", () => {
  assert.equal(
    resolveBootstrapOrigin(config),
    "https://spcdn.betaoi.cc",
  );
  assert.throws(
    () =>
      resolveBootstrapOrigin({
        origins: {
          ...config.origins,
          bootstrap: "https://other.example.com",
        },
      }),
    /must match primary/,
  );
  assert.throws(
    () =>
      resolveBootstrapOrigin({
        origins: {
          ...config.origins,
          bootstrap: "https://example.workers.dev",
        },
      }),
    /platform default domain/,
  );
});

test("Cloudflare deployment keeps the workers.dev default domain disabled", async () => {
  const repositoryConfig = JSON.parse(
    await readFile(resolve(root, "config/cdn.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(repositoryConfig.projects), [
    "cloudflare",
  ]);
  assert.deepEqual(Object.keys(repositoryConfig.origins), [
    "primary",
    "bootstrap",
  ]);
  assert.deepEqual(Object.keys(repositoryConfig.cli), ["wrangler"]);
  assert.deepEqual(
    (await readdir(resolve(root, "deploy"))).sort(),
    ["cloudflare"],
  );

  const wrangler = JSON.parse(
    await readFile(
      resolve(root, "deploy/cloudflare/wrangler.jsonc"),
      "utf8",
    ),
  );
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.deepEqual(wrangler.routes, [
    {
      pattern: "spcdn.betaoi.cc",
      custom_domain: true,
    },
  ]);
});
