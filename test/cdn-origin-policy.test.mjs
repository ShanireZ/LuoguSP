import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveBootstrapOrigin,
  resolveConfiguredOrigin,
  resolveLegacyOrigins,
  resolveSupportedOrigins,
} from "../scripts/cdn/origin-policy.mjs";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const config = {
  origins: {
    primary: "https://luogusp.round1.cc",
    bootstrap: "https://luogusp.round1.cc",
    legacy: ["https://spcdn.betaoi.cc"],
  },
};

test("CDN tooling accepts only the configured Cloudflare custom origin", () => {
  assert.equal(
    resolveConfiguredOrigin({ config }),
    "https://luogusp.round1.cc",
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
        originOverride: "https://luogusp.round1.cc/?token=preview",
      }),
    /clean HTTPS origin/,
  );
});

test("userscript bootstrap uses one configured custom origin", () => {
  assert.equal(
    resolveBootstrapOrigin(config),
    "https://luogusp.round1.cc",
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

test("CDN tooling preserves only explicit legacy custom origins", () => {
  assert.deepEqual(resolveLegacyOrigins(config), [
    "https://spcdn.betaoi.cc",
  ]);
  assert.deepEqual(resolveSupportedOrigins(config), [
    "https://luogusp.round1.cc",
    "https://spcdn.betaoi.cc",
  ]);
  assert.throws(
    () =>
      resolveLegacyOrigins({
        origins: {
          ...config.origins,
          legacy: ["https://luogusp.round1.cc"],
        },
      }),
    /must differ from primary/,
  );
  assert.throws(
    () =>
      resolveLegacyOrigins({
        origins: {
          ...config.origins,
          legacy: ["https://old.example.workers.dev"],
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
    "legacy",
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
      pattern: "luogusp.round1.cc",
      custom_domain: true,
    },
    {
      pattern: "spcdn.betaoi.cc",
      custom_domain: true,
    },
  ]);
});
