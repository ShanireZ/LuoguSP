import test from "node:test";
import assert from "node:assert/strict";
import { fetchVerified } from "../scripts/cdn/verify-lib.mjs";

const checkText = (response, body) => ({
  status: response.status,
  bytes: body.length,
  ok: response.ok && body.toString() === "ready",
});

test("CDN verification retries a transient 404 and records recovery", async () => {
  let calls = 0;
  const retries = [];
  const result = await fetchVerified({
    url: "https://cdn.example/release.js",
    delaysMs: [0, 1],
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      return new Response(
        calls === 1 ? "missing" : "ready",
        { status: calls === 1 ? 404 : 200 },
      );
    },
    check: checkText,
    onRetry: (failure, delayMs, nextAttempt) =>
      retries.push({ failure, delayMs, nextAttempt }),
  });
  assert.equal(calls, 2);
  assert.equal(result.result.ok, true);
  assert.equal(result.result.attempts, 2);
  assert.equal(result.result.previousFailures[0].status, 404);
  assert.deepEqual(
    retries.map(({ delayMs, nextAttempt }) => ({
      delayMs,
      nextAttempt,
    })),
    [{ delayMs: 1, nextAttempt: 2 }],
  );
});

test("CDN verification reports every bounded failed attempt", async () => {
  await assert.rejects(
    fetchVerified({
      url: "https://cdn.example/release.js",
      delaysMs: [0, 1, 2],
      sleep: async () => {},
      fetchImpl: async () =>
        new Response("missing", { status: 404 }),
      check: checkText,
    }),
    (error) => {
      assert.match(error.message, /after 3 attempts/);
      assert.equal(error.history.length, 3);
      assert.equal(error.lastResult.status, 404);
      return true;
    },
  );
});
