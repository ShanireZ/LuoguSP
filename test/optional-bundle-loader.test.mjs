import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createOptionalBundleLoader,
} from "../src/cdn/optional-bundle-loader.js";

const body = Buffer.from("export const apiVersion = 1;");
const sha256 = createHash("sha256").update(body).digest("hex");
const bundle = Object.freeze({
  apiVersion: 1,
  path: "releases/test/render/markdown-renderer.0123456789abcdef.js",
  sha256,
});
const moduleApi = Object.freeze({
  apiVersion: 1,
  renderMarkdown: () => ({ html: "<p>ok</p>", mode: "full", warnings: [] }),
  enhanceCodeBlocks: () => {},
});
const urlApi = Object.freeze({
  createObjectURL: () => "blob:verified-renderer",
  revokeObjectURL: () => {},
});

test("optional bundle loader verifies once and shares the in-page request", async () => {
  let fetches = 0;
  let imports = 0;
  const events = [];
  const loader = createOptionalBundleLoader({
    bundle,
    origin: "https://primary.example",
    expectedApiVersion: 1,
    fetchImpl: async () => {
      fetches++;
      return new Response(body);
    },
    importer: async () => {
      imports++;
      return moduleApi;
    },
    urlApi,
    onEvent: (event) => events.push(event),
  });

  const [first, second] = await Promise.all([loader.load(), loader.load()]);
  const third = await loader.load();

  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(fetches, 1);
  assert.equal(imports, 1);
  assert.deepEqual(loader.getState(), {
    status: "loaded",
    origin: "https://primary.example",
  });
  assert.deepEqual(events, [
    {
      type: "request-start",
      path: bundle.path,
    },
    {
      type: "loaded",
      origin: "https://primary.example",
      path: bundle.path,
    },
  ]);
});

test("optional bundle loader rejects descriptor and loaded API mismatches", async () => {
  let fetches = 0;
  const descriptorMismatch = createOptionalBundleLoader({
    bundle: { ...bundle, apiVersion: 2 },
    origin: "https://primary.example",
    expectedApiVersion: 1,
    fetchImpl: async () => {
      fetches++;
      return new Response(body);
    },
    importer: async () => moduleApi,
    urlApi,
  });
  await assert.rejects(() => descriptorMismatch.load(), {
    kind: "api-version",
  });
  assert.equal(fetches, 0);

  const moduleMismatch = createOptionalBundleLoader({
    bundle,
    origin: "https://primary.example",
    expectedApiVersion: 1,
    fetchImpl: async () => new Response(body),
    importer: async () => ({ ...moduleApi, apiVersion: 2 }),
    urlApi,
  });
  await assert.rejects(() => moduleMismatch.load(), {
    kind: "api-version",
  });
});

test("optional bundle loader retries after failure and honors AbortSignal", async () => {
  let attempt = 0;
  const loader = createOptionalBundleLoader({
    bundle,
    origin: "https://primary.example",
    expectedApiVersion: 1,
    fetchImpl: async () => {
      attempt++;
      if (attempt === 1) return new Response("offline", { status: 503 });
      return new Response(body);
    },
    importer: async () => moduleApi,
    urlApi,
  });
  await assert.rejects(() => loader.load(), { kind: "cdn-unavailable" });
  assert.equal(loader.getState().status, "idle");
  const recovered = await loader.load();
  assert.equal(recovered.module, moduleApi);
  assert.equal(attempt, 2);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => loader.load({ signal: controller.signal }), {
    kind: "cancelled",
  });
});

// 可选块机制原本把模块契约写死成 markdown 渲染器的两个导出。
// 启动包减肥（把 restricted-content 挪成按需块）和 hover 卡都需要**第二个**可选块，
// 所以契约改成可注入；默认值保持 markdown 渲染器那两个，既有调用方不必改。
test("模块契约可注入，缺哪个导出要点名报出", async () => {
  const loader = createOptionalBundleLoader({
    bundle,
    origin: "https://primary.example",
    expectedApiVersion: 1,
    exports: ["mountCard", "disposeCard"],
    fetchImpl: async () => new Response(body),
    importer: async () => ({ apiVersion: 1, mountCard: () => {} }),
    urlApi,
  });
  const error = await loader.load().then(
    () => null,
    (e) => e,
  );
  assert.equal(error?.kind, "api-invalid");
  assert.deepEqual(error?.missing, ["disposeCard"]);
  assert.match(error.message, /disposeCard/);
});
