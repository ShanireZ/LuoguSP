import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveBootstrapOrigin,
  resolveConfiguredOrigins,
} from "../scripts/cdn/origin-policy.mjs";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const config = {
  origins: {
    primary: "https://spcdn.betaoi.cc",
    fallback: "https://spcdn.betaoi.cn",
    bootstrap: "https://spcdn.betaoi.cc",
  },
};

test("CDN tooling accepts only the two configured custom origins", () => {
  assert.deepEqual(
    resolveConfiguredOrigins({ config }),
    {
      primary: "https://spcdn.betaoi.cc",
      fallback: "https://spcdn.betaoi.cn",
    },
  );
  assert.throws(
    () =>
      resolveConfiguredOrigins({
        config,
        primaryOverride: "https://example.edgeone.cool",
      }),
    /platform default domain/,
  );
  assert.throws(
    () =>
      resolveConfiguredOrigins({
        config,
        fallbackOverride: "https://example.workers.dev",
      }),
    /platform default domain/,
  );
  assert.throws(
    () =>
      resolveConfiguredOrigins({
        config,
        primaryOverride: "https://other.example.com",
      }),
    /must match config\/cdn\.json/,
  );
  assert.throws(
    () =>
      resolveConfiguredOrigins({
        config,
        primaryOverride: "https://spcdn.betaoi.cc/?token=preview",
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
    /must match primary or fallback/,
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
