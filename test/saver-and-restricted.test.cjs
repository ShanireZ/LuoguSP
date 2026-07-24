"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRestrictedReplyFetchAdapter,
  createRestrictedUrlPolicy,
  createSaverProtocol,
  createSaverTransport,
} = require("../LuoguSP.user.js");
const { FakeClock } = require("./helpers.cjs");

test("Saver transport separates HTTP, malformed JSON and business responses", async () => {
  const clock = new FakeClock();
  const responses = [
    new Response('{"code":200}', { status: 400 }),
    new Response("not-json", { status: 200 }),
    new Response('{"code":400,"message":"bad"}', { status: 200 }),
  ];
  const transport = createSaverTransport({
    baseUrl: "https://api.luogu.me",
    fetch: async () => responses.shift(),
    clock: clock.adapter(),
  });

  await assert.rejects(transport.get("/http"), {
    kind: "transport",
    status: 400,
  });
  await assert.rejects(transport.get("/json"), {
    kind: "malformed-response",
  });
  assert.deepEqual(await transport.get("/business"), {
    code: 400,
    message: "bad",
  });
});

test("Saver transport times out and never retries POST", async () => {
  const clock = new FakeClock();
  let attempts = 0;
  const transport = createSaverTransport({
    baseUrl: "https://api.luogu.me",
    fetch: (_url, { signal }) => {
      attempts++;
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    },
    clock: clock.adapter(),
    timeoutMs: 15000,
  });

  const request = transport.post("/workflow", { targetId: "x" });
  const assertion = assert.rejects(request, { kind: "timeout" });
  await clock.advance(15000);
  await assertion;
  assert.equal(attempts, 1);
});

test("Saver protocol treats only business 404 as missing", () => {
  const protocol = createSaverProtocol();
  const data = { id: "abc" };
  assert.deepEqual(protocol.classifyLookup({ code: 200, data }), {
    kind: "archived",
    data,
  });
  assert.deepEqual(protocol.classifyLookup({ code: 404 }), {
    kind: "missing",
  });
  assert.equal(protocol.classifyLookup({ code: 400 }).kind, "unavailable");
  assert.equal(protocol.classifyLookup({ code: 500 }).kind, "unavailable");
  assert.equal(protocol.classifyLookup(null).kind, "unavailable");
  assert.equal(protocol.isSuccess({ code: 202 }), true);
  assert.equal(protocol.isSuccess({ code: 400 }), false);
});

test("restricted original URL policy discards untrusted input", () => {
  const policy = createRestrictedUrlPolicy();
  assert.equal(
    policy.originalUrl("article", "abc"),
    "https://www.luogu.com/article/abc",
  );
});

test("reply fetch adapter intercepts only exact same-origin GET", async () => {
  const fallbackCalls = [];
  const replies = [
    { id: 1, time: 10, content: "old" },
    { id: 2, time: 30, content: "new" },
    { id: 3, time: 20, content: "middle" },
  ];
  const adapter = createRestrictedReplyFetchAdapter({
    fetch: async (input, init) => {
      fallbackCalls.push({ input: String(input), method: init && init.method });
      return "fallback";
    },
    origin: "https://www.luogu.com.cn",
    Response,
    URL,
    lid: "abc",
    replies,
  });

  const exact = await adapter.fetch(
    "/article/abc/replies?sort=time-d&after=2",
  );
  assert.equal(exact.status, 200);
  assert.deepEqual((await exact.json()).replySlice.map((reply) => reply.id), [
    3,
    1,
  ]);

  assert.equal(
    await adapter.fetch("https://evil.example/article/abc/replies"),
    "fallback",
  );
  assert.equal(
    await adapter.fetch("/article/abc/replies", { method: "POST" }),
    "fallback",
  );
  assert.equal(
    await adapter.fetch("/other?next=/article/abc/replies"),
    "fallback",
  );
  assert.equal(fallbackCalls.length, 3);
});
