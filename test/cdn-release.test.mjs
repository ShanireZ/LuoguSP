import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchVerifiedAsset,
  importVerifiedModule,
  loadVerifiedManifest,
} from "../src/cdn/canary-loader.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const channelPath = path.join(root, "cdn/channels/canary.json");
const channel = JSON.parse(fs.readFileSync(channelPath, "utf8"));
const manifestPath = path.join(root, "cdn", channel.manifestPath);
const manifestBody = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBody);
const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

test("CDN release manifest pins every compatibility and ESM artifact", () => {
  assert.equal(channel.schemaVersion, 1);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(channel.release, manifest.release);
  assert.equal(sha256(manifestBody), channel.manifestSha256);
  assert.equal(manifest.esm.status, "canary");
  assert.equal(manifest.esm.enabled, false);
  const releasePrefix = `releases/${manifest.release}/`;
  assert.match(
    manifest.compat.earlyGate.path,
    new RegExp(`^${releasePrefix}compat/early-gate\\.`),
  );
  assert.match(
    manifest.compat.runtime.path,
    new RegExp(`^${releasePrefix}compat/runtime\\.`),
  );
  for (const entry of [
    "canary-loader",
    "early-gate-api",
    "app-core",
    "settings",
    "problem-color",
    "chat-shortcut",
    "hidden-intro",
    "ide-batch",
    "restricted-content",
  ])
    assert.equal(typeof manifest.esm.entries[entry], "string", entry);

  for (const [relativePath, metadata] of Object.entries(manifest.files)) {
    const body = fs.readFileSync(
      path.join(root, "cdn", relativePath),
    );
    assert.equal(body.length, metadata.bytes, relativePath);
    assert.equal(sha256(body), metadata.sha256, relativePath);
    assert.match(metadata.sri, /^sha256-[A-Za-z0-9+/]+=*$/);
  }
});

test("Web Analytics stays on the CDN HTML status page only", () => {
  const token = "c113fb69d7e84d38a645c5160f6f1bda";
  const prepareSource = fs.readFileSync(
    path.join(root, "scripts/cdn/prepare.mjs"),
    "utf8",
  );
  assert.equal((prepareSource.match(new RegExp(token, "g")) || []).length, 1);
  for (const relativePath of Object.keys(manifest.files)) {
    const body = fs.readFileSync(
      path.join(root, "cdn", relativePath),
      "utf8",
    );
    assert.equal(body.includes(token), false, relativePath);
  }
});

test("verified asset loading falls back after HTTP and integrity failures", async () => {
  const expected = Buffer.from("export const ok = true;");
  const expectedHash = sha256(expected);
  const calls = [];
  const result = await fetchVerifiedAsset({
    origins: ["https://primary.example", "https://fallback.example"],
    path: "module.js",
    sha256: expectedHash,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.startsWith("https://primary.example"))
        return new Response("tampered", {
          headers: { "content-type": "text/javascript" },
        });
      return new Response(expected, {
        headers: { "content-type": "text/javascript" },
      });
    },
  });
  assert.deepEqual(calls, [
    "https://primary.example/module.js",
    "https://fallback.example/module.js",
  ]);
  assert.equal(result.origin, "https://fallback.example");
  assert.equal(Buffer.from(result.bytes).equals(expected), true);
});

test("verified manifest rejects malformed JSON and accepts the fallback", async () => {
  const body = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      release: "test",
      esm: { entries: {} },
      files: {},
    }),
  );
  const result = await loadVerifiedManifest({
    origins: ["https://primary.example", "https://fallback.example"],
    path: "manifest.json",
    sha256: sha256(body),
    fetchImpl: async (url) =>
      url.startsWith("https://primary.example")
        ? new Response("not-json")
        : new Response(body),
  });
  assert.equal(result.origin, "https://fallback.example");
  assert.equal(result.manifest.release, "test");
});

test("verified module execution uses only bytes that passed SHA-256", async () => {
  const body = Buffer.from("export const value = 42;");
  const metadata = {
    path: "esm/example.js",
    sha256: sha256(body),
  };
  const revoked = [];
  const result = await importVerifiedModule({
    manifest: {
      esm: { entries: { example: metadata.path } },
      files: { [metadata.path]: metadata },
    },
    entry: "example",
    origins: ["https://primary.example"],
    fetchImpl: async () => new Response(body),
    importer: async (url) => ({ value: 42, url }),
    urlApi: {
      createObjectURL: () => "blob:verified-module",
      revokeObjectURL: (url) => revoked.push(url),
    },
  });
  assert.equal(result.module.value, 42);
  assert.equal(result.module.url, "blob:verified-module");
  assert.deepEqual(revoked, ["blob:verified-module"]);
});
