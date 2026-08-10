import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchVerifiedAsset,
  getOptionalBundle,
  importVerifiedModule,
  loadVerifiedManifest,
} from "../src/cdn/canary-loader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const channelPath = path.join(root, "cdn/channels/canary.json");
const channel = JSON.parse(fs.readFileSync(channelPath, "utf8"));
const cdnConfig = JSON.parse(
  fs.readFileSync(path.join(root, "config/cdn.json"), "utf8"),
);
const manifestPath = path.join(root, "cdn", channel.manifestPath);
const manifestBody = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBody);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("CDN release manifest pins every compatibility and ESM artifact", () => {
  assert.ok([1, 2].includes(channel.schemaVersion));
  assert.ok([1, 2, 3].includes(manifest.schemaVersion));
  assert.equal(channel.release, manifest.release);
  assert.equal(sha256(manifestBody), channel.manifestSha256);
  if (channel.schemaVersion === 2) {
    assert.equal(channel.origin, manifest.origin);
    assert.equal(
      [
        cdnConfig.origins.primary,
        ...cdnConfig.origins.legacy,
      ].includes(channel.origin),
      true,
    );
    assert.equal(channel.origins, undefined);
  }
  if (manifest.schemaVersion === 3) {
    assert.equal(typeof manifest.origin, "string");
    assert.equal(manifest.origins, undefined);
  }
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
    const body = fs.readFileSync(path.join(root, "cdn", relativePath));
    assert.equal(body.length, metadata.bytes, relativePath);
    assert.equal(sha256(body), metadata.sha256, relativePath);
    assert.match(metadata.sri, /^sha256-[A-Za-z0-9+/]+=*$/);
  }
});

test("version 2 manifests require a complete optional markdown renderer bundle", async () => {
  const rendererPath =
    "releases/test/render/markdown-renderer.0123456789abcdef.js";
  const rendererFile = {
    path: rendererPath,
    bytes: 123,
    sha256: "a".repeat(64),
    sri: "sha256-YQ==",
  };
  const createManifest = (bundle) => ({
    schemaVersion: 2,
    release: "test",
    esm: { entries: {} },
    files: { [rendererPath]: rendererFile },
    optionalBundles: { markdownRenderer: bundle },
  });
  const validBundle = {
    apiVersion: 1,
    ...rendererFile,
    gzipBytes: 100,
    dependencies: {
      katex: "0.18.1",
      marked: "18.0.7",
      dompurify: "3.4.12",
      "highlight.js": "11.11.1",
    },
  };
  const validBody = Buffer.from(JSON.stringify(createManifest(validBundle)));
  const result = await loadVerifiedManifest({
    origin: "https://primary.example",
    path: "manifest.json",
    sha256: sha256(validBody),
    fetchImpl: async () => new Response(validBody),
  });
  assert.deepEqual(
    getOptionalBundle(result.manifest, "markdownRenderer"),
    validBundle,
  );

  const invalidBody = Buffer.from(
    JSON.stringify(createManifest({ ...validBundle, gzipBytes: undefined })),
  );
  await assert.rejects(
    () =>
      loadVerifiedManifest({
        origin: "https://primary.example",
        path: "manifest.json",
        sha256: sha256(invalidBody),
        fetchImpl: async () => new Response(invalidBody),
      }),
    { kind: "manifest-invalid" },
  );
});

test("CDN HTML relies on Cloudflare automatic Web Analytics injection", () => {
  const prepareSource = fs.readFileSync(
    path.join(root, "scripts/cdn/prepare.mjs"),
    "utf8",
  );
  assert.equal(prepareSource.includes("static.cloudflareinsights.com"), false);
  for (const relativePath of Object.keys(manifest.files)) {
    const body = fs.readFileSync(path.join(root, "cdn", relativePath), "utf8");
    assert.equal(
      body.includes("static.cloudflareinsights.com"),
      false,
      relativePath,
    );
  }
});

test("verified asset loading rejects bytes that fail integrity", async () => {
  const expected = Buffer.from("export const ok = true;");
  const expectedHash = sha256(expected);
  await assert.rejects(
    () =>
      fetchVerifiedAsset({
        origin: "https://primary.example",
        path: "module.js",
        sha256: expectedHash,
        fetchImpl: async () =>
          new Response("tampered", {
            headers: { "content-type": "text/javascript" },
          }),
      }),
    { kind: "cdn-unavailable" },
  );
});

test("version 3 manifests bind verified bytes to one transport origin", async () => {
  const rendererPath =
    "releases/test/render/markdown-renderer.0123456789abcdef.js";
  const rendererFile = {
    path: rendererPath,
    bytes: 123,
    sha256: "a".repeat(64),
    sri: "sha256-YQ==",
  };
  const manifestV3 = {
    schemaVersion: 3,
    release: "test",
    origin: "https://primary.example",
    esm: { entries: {} },
    files: { [rendererPath]: rendererFile },
    optionalBundles: {
      markdownRenderer: {
        apiVersion: 1,
        ...rendererFile,
        gzipBytes: 100,
        dependencies: {
          katex: "0.18.1",
          marked: "18.0.7",
          dompurify: "3.4.12",
          "highlight.js": "11.11.1",
        },
      },
    },
  };
  const body = Buffer.from(JSON.stringify(manifestV3));
  await assert.rejects(
    () =>
      loadVerifiedManifest({
        origin: "https://other.example",
        path: "manifest.json",
        sha256: sha256(body),
        fetchImpl: async () => new Response(body),
      }),
    { kind: "manifest-invalid" },
  );
});

test("verified manifest rejects malformed JSON", async () => {
  const body = Buffer.from("not-json");
  await assert.rejects(
    () =>
      loadVerifiedManifest({
        origin: "https://primary.example",
        path: "manifest.json",
        sha256: sha256(body),
        fetchImpl: async () => new Response(body),
      }),
    { kind: "manifest-invalid" },
  );
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
    origin: "https://primary.example",
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
