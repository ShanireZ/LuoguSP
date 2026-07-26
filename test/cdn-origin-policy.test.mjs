import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveConfiguredOrigins,
} from "../scripts/cdn/origin-policy.mjs";

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
