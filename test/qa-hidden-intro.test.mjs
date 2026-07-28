import test from "node:test";
import assert from "node:assert/strict";
import {
  createQaRendererFetch,
  createQaRendererOptions,
  getQaHiddenIntroMode,
  isQaForcedFallback,
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
