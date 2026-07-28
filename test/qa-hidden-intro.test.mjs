import test from "node:test";
import assert from "node:assert/strict";
import {
  createQaRendererFetch,
  createQaRendererOptions,
  getQaHiddenIntroMode,
  isQaForcedFallback,
  updateQaRendererProbeDataset,
} from "../src/cdn/qa-hidden-intro.js";

const origin = "https://primary.example";
const rendererPath =
  "/releases/test/render/markdown-renderer.0123456789abcdef.js";

test("hidden-intro fault modes are restricted to prerelease QA URLs", () => {
  assert.equal(
    getQaHiddenIntroMode(
      "2.13.5-canary.17",
      "https://www.luogu.com.cn/user/2?luogusp-qa=fallback-lite",
    ),
    "fallback-lite",
  );
  assert.equal(
    getQaHiddenIntroMode(
      "2.13.5",
      "https://www.luogu.com.cn/user/2?luogusp-qa=fallback-lite",
    ),
    null,
  );
  assert.equal(
    getQaHiddenIntroMode(
      "2.13.5-canary.17",
      "https://www.luogu.com.cn/user/2?luogusp-qa=unknown",
    ),
    null,
  );
  assert.equal(isQaForcedFallback("fallback-retry"), true);
  assert.equal(isQaForcedFallback("native"), false);
  assert.deepEqual(createQaRendererOptions("fallback-lite"), {
    forceFullFailure: true,
  });
});

test("retry mode fails the first renderer request and then recovers", async () => {
  let realFetches = 0;
  const qaFetch = createQaRendererFetch({
    mode: "fallback-retry",
    origin,
    fetchImpl: async () => {
      realFetches++;
      return { ok: true, status: 200 };
    },
  });

  assert.equal(
    (
      await qaFetch(`${origin}${rendererPath}`)
    ).status,
    503,
  );
  assert.equal(
    (
      await qaFetch(`${origin}${rendererPath}`)
    ).status,
    200,
  );
  assert.equal(realFetches, 1);
});

test("renderer probe clears stale failure diagnostics after retry recovery", () => {
  const dataset = {
    rendererStatus: "idle",
    rendererLoads: "0",
    rendererOrigin: "",
    rendererFailure: "",
    rendererDetail: "",
  };

  updateQaRendererProbeDataset(dataset, {
    type: "request-start",
  });
  updateQaRendererProbeDataset(dataset, {
    type: "load-failed",
    kind: "cdn-unavailable",
    message: "HTTP 503",
  });
  assert.deepEqual(dataset, {
    rendererStatus: "load-failed",
    rendererLoads: "1",
    rendererOrigin: "",
    rendererFailure: "cdn-unavailable",
    rendererDetail: "HTTP 503",
  });

  updateQaRendererProbeDataset(dataset, {
    type: "request-start",
  });
  assert.deepEqual(dataset, {
    rendererStatus: "request-start",
    rendererLoads: "2",
    rendererOrigin: "",
    rendererFailure: "",
    rendererDetail: "",
  });

  updateQaRendererProbeDataset(dataset, {
    type: "loaded",
    origin: "https://primary.example",
  });
  assert.deepEqual(dataset, {
    rendererStatus: "loaded",
    rendererLoads: "2",
    rendererOrigin: "https://primary.example",
    rendererFailure: "",
    rendererDetail: "",
  });
});
