import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveConfiguredOrigins,
} from "../scripts/cdn/origin-policy.mjs";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const config = {
  origins: {
    primary: "https://spcdn.betaoi.cn",
    fallback: "https://spcdn.betaoi.cc",
  },
};

test("CDN tooling accepts only the two configured custom origins", () => {
  assert.deepEqual(
    resolveConfiguredOrigins({ config }),
    {
      primary: "https://spcdn.betaoi.cn",
      fallback: "https://spcdn.betaoi.cc",
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
        primaryOverride: "https://spcdn.betaoi.cn/?token=preview",
      }),
    /clean HTTPS origin/,
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
