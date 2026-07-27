import test from "node:test";
import assert from "node:assert/strict";
import {
  createQaRendererFetch,
  createQaRendererOptions,
  getQaHiddenIntroMode,
  isQaForcedFallback,
} from "../src/cdn/qa-hidden-intro.js";

const origins = [
  "https://primary.example",
  "https://fallback.example",
];
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

test("primary-failure mode rejects only the primary renderer request", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return { ok: true, status: 200 };
  };
  const qaFetch = createQaRendererFetch({
    mode: "fallback-primary-fail",
    origins,
    fetchImpl,
  });

  assert.equal(
    (
      await qaFetch(`${origins[0]}${rendererPath}`)
    ).status,
    503,
  );
  assert.equal(
    (
      await qaFetch(`${origins[1]}${rendererPath}`)
    ).status,
    200,
  );
  assert.equal(
    (
      await qaFetch(
        `${origins[0]}/releases/test/compat/runtime.0123456789abcdef.js`,
      )
    ).status,
    200,
  );
  assert.deepEqual(requested, [
    `${origins[1]}${rendererPath}`,
    `${origins[0]}/releases/test/compat/runtime.0123456789abcdef.js`,
  ]);
});

test("retry mode fails one complete origin cycle and then recovers", async () => {
  let realFetches = 0;
  const qaFetch = createQaRendererFetch({
    mode: "fallback-retry",
    origins,
    fetchImpl: async () => {
      realFetches++;
      return { ok: true, status: 200 };
    },
  });

  assert.equal(
    (
      await qaFetch(`${origins[0]}${rendererPath}`)
    ).status,
    503,
  );
  assert.equal(
    (
      await qaFetch(`${origins[1]}${rendererPath}`)
    ).status,
    503,
  );
  assert.equal(
    (
      await qaFetch(`${origins[0]}${rendererPath}`)
    ).status,
    200,
  );
  assert.equal(realFetches, 1);
});
