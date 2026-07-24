"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createGetRequestScheduler,
} = require("../LuoguSP.user.js");
const {
  FakeClock,
  deferred,
  flushMicrotasks,
  textResponse,
} = require("./helpers.cjs");

test("GET scheduler keeps FIFO order, 300ms launch gap and 3 concurrency", async () => {
  const clock = new FakeClock();
  const starts = [];
  const pending = [];
  let active = 0;
  let maxActive = 0;
  const scheduler = createGetRequestScheduler({
    fetch: (url) => {
      starts.push({ url, at: clock.nowMs });
      active++;
      maxActive = Math.max(maxActive, active);
      const request = deferred();
      pending.push({
        url,
        resolve() {
          active--;
          request.resolve(textResponse(url));
        },
      });
      return request.promise;
    },
    clock: clock.adapter(),
    launchGap: 300,
    concurrency: 3,
    timeoutMs: 15000,
  });

  const urls = ["/1", "/2", "/3", "/4", "/5"];
  const results = urls.map((url) => scheduler.text(url));
  assert.deepEqual(starts, [{ url: "/1", at: 0 }]);

  await clock.advance(300);
  await clock.advance(300);
  assert.deepEqual(
    starts,
    [
      { url: "/1", at: 0 },
      { url: "/2", at: 300 },
      { url: "/3", at: 600 },
    ],
  );
  assert.equal(maxActive, 3);

  await clock.advance(300);
  assert.equal(starts.length, 3, "fourth request launched above concurrency");
  pending[0].resolve();
  await flushMicrotasks();
  assert.deepEqual(starts[3], { url: "/4", at: 900 });

  pending[1].resolve();
  pending[2].resolve();
  await flushMicrotasks();
  await clock.advance(300);
  assert.deepEqual(starts[4], { url: "/5", at: 1200 });

  pending[3].resolve();
  pending[4].resolve();
  assert.deepEqual(await Promise.all(results), urls);
  assert.equal(maxActive, 3);
  scheduler.dispose();
});

test("GET scheduler deduplicates only in-flight success and never caches HTTP errors", async () => {
  const clock = new FakeClock();
  const first = deferred();
  let attempts = 0;
  const scheduler = createGetRequestScheduler({
    fetch: () => {
      attempts++;
      return attempts === 1
        ? first.promise
        : Promise.resolve(textResponse("bad", 500));
    },
    clock: clock.adapter(),
    launchGap: 0,
    concurrency: 3,
  });

  const one = scheduler.text("/same");
  const duplicate = scheduler.text("/same");
  assert.equal(one, duplicate);
  assert.equal(attempts, 1);
  first.resolve(textResponse("ok"));
  assert.equal(await one, "ok");

  await assert.rejects(scheduler.text("/same"), /HTTP 500/);
  await assert.rejects(scheduler.text("/same"), /HTTP 500/);
  assert.equal(attempts, 3);
  scheduler.dispose();
});

test("GET scheduler honors Retry-After and retries 503 only once", async () => {
  const clock = new FakeClock();
  let attempts = 0;
  const scheduler = createGetRequestScheduler({
    fetch: async () => {
      attempts++;
      return attempts === 1
        ? textResponse("busy", 503, { "retry-after": "2" })
        : textResponse("ready");
    },
    clock: clock.adapter(),
    launchGap: 300,
    concurrency: 3,
    maxRetries: 1,
  });

  const result = scheduler.text("/retry");
  await flushMicrotasks();
  assert.equal(attempts, 1);
  await clock.advance(1999);
  assert.equal(attempts, 1);
  await clock.advance(1);
  assert.equal(await result, "ready");
  assert.equal(attempts, 2);
  scheduler.dispose();
});

test("GET scheduler parses HTTP-date Retry-After for 429", async () => {
  const now = Date.parse("2026-07-24T00:00:00Z");
  const clock = new FakeClock(now);
  let attempts = 0;
  const scheduler = createGetRequestScheduler({
    fetch: async () => {
      attempts++;
      return attempts === 1
        ? textResponse("limited", 429, {
            "retry-after": new Date(now + 3000).toUTCString(),
          })
        : textResponse("ready");
    },
    clock: clock.adapter(),
    launchGap: 300,
    concurrency: 3,
    maxRetries: 1,
  });

  const result = scheduler.text("/date-retry");
  await flushMicrotasks();
  await clock.advance(2999);
  assert.equal(attempts, 1);
  await clock.advance(1);
  assert.equal(await result, "ready");
  assert.equal(attempts, 2);
  scheduler.dispose();
});

test("GET scheduler aborts timed-out work and rejects queued work on dispose", async () => {
  const clock = new FakeClock();
  const scheduler = createGetRequestScheduler({
    fetch: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    clock: clock.adapter(),
    launchGap: 300,
    concurrency: 1,
    timeoutMs: 15000,
  });

  const timedOut = scheduler.text("/hang");
  const timeoutAssertion = assert.rejects(timedOut, {
    name: "AbortError",
  });
  await clock.advance(15000);
  await timeoutAssertion;

  const active = scheduler.text("/active");
  const queued = scheduler.text("/queued");
  const activeAssertion = assert.rejects(active, { name: "AbortError" });
  const queuedAssertion = assert.rejects(queued, { name: "AbortError" });
  scheduler.dispose();
  await Promise.all([activeAssertion, queuedAssertion]);
});
