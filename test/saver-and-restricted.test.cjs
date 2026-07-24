"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRestrictedReplyFetchAdapter,
  createRestrictedUrlPolicy,
  createSaverProtocol,
  createSaverTransport,
  createSaverWorkflow,
} = require("../LuoguSP.user.js");
const { FakeClock, flushMicrotasks } = require("./helpers.cjs");

test("Saver transport separates HTTP, malformed JSON and business responses", async () => {
  const clock = new FakeClock();
  const responses = [
    new Response('{"code":200}', { status: 400 }),
    new Response("not-json", { status: 200 }),
    new Response('{"message":"missing code"}', { status: 200 }),
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
  await assert.rejects(transport.get("/shell"), {
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

test("Saver transport distinguishes caller Abort from timeout", async () => {
  const clock = new FakeClock();
  const controller = new AbortController();
  const transport = createSaverTransport({
    baseUrl: "https://api.luogu.me",
    fetch: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    clock: clock.adapter(),
  });

  const request = transport.get("/query", { signal: controller.signal });
  const assertion = assert.rejects(request, { kind: "cancelled" });
  controller.abort();
  await assertion;
  assert.equal(clock.timers.size, 0);
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

test("Saver Workflow only creates after explicit business 404", async () => {
  const clock = new FakeClock();
  let posts = 0;
  const workflow = createSaverWorkflow({
    transport: {
      get: async () => ({ code: 400, message: "bad request" }),
      post: async () => {
        posts++;
        return { code: 202 };
      },
    },
    clock: clock.adapter(),
  });

  const result = await workflow.ensureArchived("article", "abc");
  assert.equal(result.kind, "unavailable");
  assert.equal(result.category, "business");
  assert.equal(result.stage, "lookup");
  assert.equal(posts, 0);
  assert.equal(clock.timers.size, 0);
});

test("Saver Workflow does not poll after create failure or retry a timed-out POST", async () => {
  const clock = new FakeClock();
  let posts = 0;
  const businessFailure = createSaverWorkflow({
    transport: {
      get: async () => ({ code: 404 }),
      post: async () => {
        posts++;
        return { code: 400, message: "denied" };
      },
    },
    clock: clock.adapter(),
  });

  const failed = await businessFailure.ensureArchived("paste", "abc");
  assert.equal(failed.kind, "unavailable");
  assert.equal(failed.stage, "create");
  assert.equal(posts, 1);
  assert.equal(clock.timers.size, 0);

  const timeout = Object.assign(new Error("unknown result"), {
    kind: "timeout",
  });
  const timedOut = createSaverWorkflow({
    transport: {
      get: async () => ({ code: 404 }),
      post: async () => {
        posts++;
        throw timeout;
      },
    },
    clock: clock.adapter(),
  });
  const unknown = await timedOut.ensureArchived("paste", "def");
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.stage, "create");
  assert.equal(posts, 2);
  assert.equal(clock.timers.size, 0);
});

test("Saver Workflow continues polling after transient network errors", async () => {
  const clock = new FakeClock();
  let gets = 0;
  let accepted = 0;
  const workflow = createSaverWorkflow({
    transport: {
      get: async () => {
        gets++;
        if (gets === 1) return { code: 404 };
        if (gets === 2)
          throw Object.assign(new Error("offline"), { kind: "transport" });
        return { code: 200, data: { id: "abc" } };
      },
      post: async () => ({ code: 202 }),
    },
    clock: clock.adapter(),
  });

  const result = workflow.ensureArchived("article", "abc", {
    onAccepted: () => accepted++,
  });
  await flushMicrotasks();
  await clock.advance(3000);
  assert.equal(gets, 2);
  await clock.advance(3000);
  assert.deepEqual(await result, {
    kind: "archived",
    data: { id: "abc" },
  });
  assert.equal(accepted, 1);
  assert.equal(gets, 3);
});

test("Saver Workflow stops polling on explicit business error and cancels timers", async () => {
  const clock = new FakeClock();
  let gets = 0;
  const workflow = createSaverWorkflow({
    transport: {
      get: async () => {
        gets++;
        return gets === 1 ? { code: 404 } : { code: 500, message: "failed" };
      },
      post: async () => ({ code: 200 }),
    },
    clock: clock.adapter(),
  });

  const result = workflow.ensureArchived("article", "abc");
  await flushMicrotasks();
  await clock.advance(3000);
  const stopped = await result;
  assert.equal(stopped.kind, "unavailable");
  assert.equal(stopped.category, "business");
  assert.equal(stopped.stage, "poll");
  assert.equal(gets, 2);
  assert.equal(clock.timers.size, 0);

  const pending = createSaverWorkflow({
    transport: {
      get: async () => ({ code: 404 }),
      post: async () => ({ code: 202 }),
    },
    clock: clock.adapter(),
  });
  const cancelled = pending.ensureArchived("paste", "abc");
  await flushMicrotasks();
  assert.equal(clock.timers.size, 1);
  pending.dispose();
  assert.equal((await cancelled).category, "cancelled");
  assert.equal(clock.timers.size, 0);
});

test("Saver Workflow manual refresh locks only on business success", async () => {
  const clock = new FakeClock();
  const replies = [{ code: 400, message: "retry" }, { code: 202 }];
  const workflow = createSaverWorkflow({
    transport: {
      get: async () => ({ code: 404 }),
      post: async () => replies.shift(),
    },
    clock: clock.adapter(),
  });

  const first = await workflow.requestRefresh("article", "abc");
  assert.equal(first.kind, "unavailable");
  assert.equal(first.retryable, true);
  assert.deepEqual(await workflow.requestRefresh("article", "abc"), {
    kind: "accepted",
  });
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
