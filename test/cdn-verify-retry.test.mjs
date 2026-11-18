import test from "node:test";
import assert from "node:assert/strict";
import { fetchVerified } from "../scripts/cdn/verify-lib.mjs";

const url = "https://cdn.example/release.js";
const exactResponse = (body, status) => Object.defineProperty(new Response(body, { status }), "url", { value: url });

const checkText = (response, body) => ({
  status: response.status,
  bytes: body.length,
  ok: response.ok && body.toString() === "ready",
});

test("CDN verification retries a transient 404 and records recovery", async () => {
  let calls = 0;
  const retries = [];
  const result = await fetchVerified({
    url,
    delaysMs: [0, 1],
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      return exactResponse(
        calls === 1 ? "missing" : "ready",
        calls === 1 ? 404 : 200,
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
      url,
      delaysMs: [0, 1, 2],
      sleep: async () => {},
      fetchImpl: async () =>
        exactResponse("missing", 404),
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

for (const response of [
  { status: 206, url, redirected: false, error: /expected HTTP 200/ },
  { status: 200, url: "https://other.example/release.js", redirected: false, error: /exact URL/ },
  { status: 200, url, redirected: true, error: /redirect/ },
]) {
  test(`CDN verification checks response provenance before reading bytes (${response.error})`, async () => {
    let bodyReads = 0;
    let checks = 0;
    let redirectMode;
    await assert.rejects(fetchVerified({
      url, delaysMs: [0],
      fetchImpl: async (_, options) => {
        redirectMode = options.redirect;
        return { ...response, ok: true, arrayBuffer() { bodyReads++; return Buffer.from("ready"); } };
      },
      check() { checks++; return { ok: true }; },
    }), (error) => {
      assert.match(error.lastResult.error, response.error);
      assert.equal(error.lastResult.status, response.status);
      return true;
    });
    assert.equal(redirectMode, "error");
    assert.equal(bodyReads, 0);
    assert.equal(checks, 0);
  });
}
