import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserProblemResources } from "../src/browser/luogu-problem-resources.js";
import { createProblemData } from "../src/features/problem-color/problem-data.js";
import { createGetRequestScheduler } from "../src/core/get-request-scheduler.js";
import { createHoverCardSources } from "../src/features/hover-card/sources.js";
import { FakeClock, deferred, flushMicrotasks, textResponse } from "./helpers.js";

const origin = "https://www.luogu.com.cn";
const url = (path) => new URL(path, origin);
const problem = { pid: "P1001", name: "A+B", difficulty: 1, samples: [["1 2", "3"]] };

function browserProblemData(t, fetchPage) {
  const { document, location } = globalThis;
  globalThis.document = { URL: origin };
  globalThis.location = { origin };
  t.after(() => Object.assign(globalThis, { document, location }));
  t.mock.method(globalThis, "fetch", fetchPage);
  return createBrowserProblemResources().data;
}

test("direct problem reads validate the request and response before decoding", async (t) => {
  const href = "/problem/P1001?contestId=123&lang=en";
  const expectedUrl = `${origin}${href}&_contentOnly=1`;
  const good = {
    ...textResponse(JSON.stringify({ data: { problem } }), 200, { "content-type": "Application/JSON; charset=utf-8" }),
    url: expectedUrl,
    redirected: false,
  };
  for (const [name, overrides] of [
    ["missing URL", { url: "" }],
    ["different query", { url: expectedUrl.replace("lang=en", "lang=zh") }],
    ["redirect flag", { redirected: true }],
    ["accepted status", { status: 202 }],
    ["partial status", { status: 206 }],
    ["missing media", { headers: new Headers() }],
    ["plain-text media", { headers: new Headers({ "content-type": "text/plain" }) }],
  ]) {
    await t.test(name, async (child) => {
      const reads = [];
      let decodes = 0;
      const data = browserProblemData(child, (requestedUrl, init) => {
        reads.push({ requestedUrl, init });
        return { ...good, ...overrides, text: async () => { decodes++; return good.text(); } };
      });
      await assert.rejects(data.load(problem.pid, { href }));
      assert.equal(data.peek(problem.pid, { href }), null);
      assert.equal(decodes, 0);
      assert.equal(reads.length, 1);
      const [{ requestedUrl, init }] = reads;
      assert.equal(requestedUrl, expectedUrl);
      assert.equal(init.mode, "same-origin");
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers["x-lentille-request"], "content-only");
    });
  }
});

test("a direct problem read can retry after rejected metadata and accept native HTML", async (t) => {
  let reads = 0;
  const html = `<script id="lentille-context" type="application/json">${JSON.stringify({ data: { problem } })}</script>`;
  const data = browserProblemData(t, (requestedUrl) => ({
    ...textResponse(html, 200, { "content-type": ++reads === 1 ? "text/plain" : "text/html; charset=utf-8" }),
    url: requestedUrl,
    redirected: false,
  }));
  await assert.rejects(data.load(problem.pid));
  assert.deepEqual((await data.load(problem.pid)).data.problem.samples, problem.samples);
  assert.equal((await data.load(problem.pid)).data.problem.pid, problem.pid);
  assert.equal(reads, 2);
});

test("native detail supplies difficulty, hover fields and IDE samples without a lookup", async () => {
  const data = createProblemData({ origin, text: () => assert.fail("unexpected lookup") });
  data.rememberPage({ viewer: 42, data: { problem, bookmarked: true } }, url("/problem/P1001"), Date.now());
  assert.equal(data.peek(problem.pid).data.problem.difficulty, 1);
  assert.equal(data.peek(problem.pid).data.problem.name, "A+B");
  assert.deepEqual((await data.load(problem.pid)).data.problem.samples, problem.samples);
});

test("one detail request serves concurrent consumers and survives one aborted route", async () => {
  const clock = new FakeClock();
  const request = deferred();
  const calls = [];
  const scheduler = createGetRequestScheduler({
    clock: clock.adapter(),
    fetch: (path) => { calls.push(path); return request.promise; },
  });
  const data = createProblemData({ origin, text: scheduler.text, now: clock.adapter().now });
  const route = new AbortController();
  const color = data.load(problem.pid, { signal: route.signal });
  const hover = data.load(problem.pid);
  const ide = data.load(problem.pid, { href: "/problem/P1001#ide" });
  route.abort();
  request.resolve(textResponse(JSON.stringify({ data: { problem } })));
  assert.equal(await color, null);
  assert.equal((await hover).data.problem.name, "A+B");
  assert.deepEqual((await ide).data.problem.samples, problem.samples);
  assert.deepEqual(calls, ["/problem/P1001?_contentOnly=1"]);
  scheduler.dispose();
});

test("legacy problem HTML is read only from an identified data context", async () => {
  const payload = encodeURIComponent(JSON.stringify({ currentData: { problem } }));
  const data = createProblemData({
    origin, text: async () => `<script>window._feInjection = JSON.parse(decodeURIComponent("${payload}"))</script>`,
  });
  assert.equal((await data.load(problem.pid)).data.problem.difficulty, 1);
  assert.equal(await data.load("P2000"), null);
});

test("contest and account contexts cannot reuse another context's details", async () => {
  const calls = [];
  const data = createProblemData({
    origin, text: async (path, { key }) => {
      calls.push({ path, key });
      return JSON.stringify({ data: { problem } });
    },
  });
  const at = Date.now();
  data.rememberPage({ viewer: 42, data: { problem } }, url("/problem/P1001"), at);
  assert.equal(data.peek(problem.pid, { href: "/problem/P1001?contestId=123" }), null);
  await data.load(problem.pid, { href: "/problem/P1001?contestId=123" });
  data.rememberPage({ viewer: 43, data: {} }, url("/problem/list"), at + 1);
  assert.equal(data.peek(problem.pid), null);
  await data.load(problem.pid, { href: "/problem/P1001?contestId=123" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/problem/P1001?contestId=123&_contentOnly=1");
  assert.notEqual(calls[0].key, calls[1].key);
});

test("hover card publishes a native preview before the Lentille detail and record responses", async () => {
  const detail = deferred();
  const record = deferred();
  const detailRequests = [];
  const supplemental = [];
  const data = createProblemData({
    origin,
    text: (path) => { detailRequests.push(path); return detail.promise; },
  });
  data.rememberPage({ viewer: 42, data: { recommendations: [{ ...problem, samples: undefined }] } },
    url("/problem/P2000"), Date.now());
  const sources = createHoverCardSources({
    origin,
    problemData: data,
    fetchPage(requestedUrl, _signal, init) {
      supplemental.push({ requestedUrl, type: init?.headers["x-lentille-request"] });
      return record.promise;
    },
  });
  const updates = [];
  const card = sources.problem(problem.pid, 42, undefined, { onUpdate: (model) => updates.push(model) });
  assert.equal(updates[0].name, "A+B");
  assert.equal(updates[0].difficulty, 1);
  assert.equal(updates[0].mine.lastAttempt, null);
  detail.resolve(JSON.stringify({ user: { uid: 42 }, data: { problem } }));
  await flushMicrotasks();
  assert.deepEqual(detailRequests, ["/problem/P1001?_contentOnly=1"]);
  assert.deepEqual(supplemental, [{ requestedUrl: recordUrl, type: "content-only" }]);
  record.resolve(jsonReply(recordUrl, {
    template: "record.list", user: { uid: 42 },
    data: { records: { result: [
      { id: 1, user: { uid: 42 }, problem, submitTime: 123 },
      { id: 2, user: { uid: 43 }, problem, submitTime: 456 },
    ] } },
  }));
  assert.equal((await card).mine.lastAttempt.id, 1);
  assert.equal(updates.at(-1).mine.lastAttempt.id, 1);
});

function recordPreviewSources(fetchPage, clock) {
  const data = createProblemData({ origin, text: () => assert.fail("unexpected detail lookup") });
  data.rememberPage({ viewer: 42, data: { problem } }, url("/problem/P1001"), Date.now());
  return createHoverCardSources({ origin, problemData: data, fetchPage, clock });
}

const recordUrl = `${origin}/record/list?user=42&pid=P1001`;
const jsonReply = (requestedUrl, payload) => ({
  ok: true, status: 200, redirected: false, url: requestedUrl,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => payload,
});
const recordReply = (result) => jsonReply(recordUrl,
  { template: "record.list", user: { uid: 42 }, data: { records: { result } } });

for (const [endpoint, overrides] of [
  ["/problem/P1001", { status: 202 }],
  ["/_lfe/tags", { headers: new Headers({ "content-type": "text/html" }) }],
  ["/record/list?user=42&pid=P1001", { url: `${recordUrl}&page=2` }],
  ["/record/list?user=42&pid=P1001", { redirected: true }],
]) {
  test(`hover problem read of ${endpoint} retries after rejected metadata ${Object.keys(overrides)[0]}`, async () => {
    const requests = [];
    let attempts = 0;
    let decodes = 0;
    const sources = createHoverCardSources({ origin, fetchPage: (requestedUrl, _signal, init) => {
      const responseUrl = new URL(requestedUrl, origin).href;
      const routes = {
        [`${origin}/problem/P1001`]: jsonReply(responseUrl, { data: { problem: { ...problem, tags: [1] } } }),
        [`${origin}/_lfe/tags`]: jsonReply(responseUrl, { tags: [{ id: 1, name: "Math" }] }),
        [recordUrl]: recordReply([{ id: 77, user: { uid: 42 }, problem, submitTime: 123 }]),
      };
      requests.push({ requestedUrl, init });
      const reply = routes[responseUrl];
      if (responseUrl !== `${origin}${endpoint}` || ++attempts > 1) return reply;
      return { ...reply, ...overrides, json: async () => { decodes++; return reply.json(); } };
    } });
    const partial = await sources.problem(problem.pid, 42);
    if (endpoint.startsWith("/problem/")) assert.equal(partial, null);
    else {
      assert.equal(partial.name, problem.name);
      if (endpoint === "/_lfe/tags") assert.deepEqual(partial.tags, []);
      else assert.equal(partial.mine.lastAttempt, null);
    }
    const recovered = await sources.problem(problem.pid, 42);
    assert.deepEqual(recovered.tags, ["Math"]);
    assert.equal(recovered.mine.lastAttempt.id, 77);
    assert.equal(attempts, 2);
    assert.equal(decodes, 0);
    for (const { requestedUrl, init } of requests) {
      assert.ok(requestedUrl.startsWith(origin));
      assert.equal(init.mode, "same-origin");
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers?.["x-lentille-request"], requestedUrl.endsWith("/_lfe/tags") ? undefined : "content-only");
    }
  });
}

test("record previews retry transient failures but cache a successful empty list", async () => {
  const clock = new FakeClock();
  let reads = 0;
  const sources = recordPreviewSources(() => ++reads <= 2
    ? { ok: false, status: 503 }
    : recordReply([]), clock.adapter());
  const open = () => sources.problem(problem.pid, 42);

  await open();
  await open();
  assert.equal(reads, 2);
  await clock.advance(1999);
  await open();
  assert.equal(reads, 2);
  await clock.advance(1);
  const recovered = await Promise.all([open(), open()]);
  assert.equal(reads, 3);
  assert.ok(recovered.every(card => card.mine.lastAttempt === null));
  await clock.advance(2000);
  await open();
  assert.equal(reads, 3);
});

test("reopening a preview does not join or cache an aborted record request", async () => {
  const started = deferred();
  const oldResponse = deferred();
  let reads = 0;
  const sources = recordPreviewSources((_path, signal) => {
    if (++reads !== 1) return recordReply([{ id: 77, user: { uid: 42 }, problem, submitTime: 123 }]);
    started.resolve(signal);
    return oldResponse.promise;
  });
  const controller = new AbortController();
  const old = sources.problem(problem.pid, 42, controller.signal);
  const oldSignal = await started.promise;
  controller.abort();
  assert.equal(oldSignal.aborted, true);
  try {
    const recovered = await sources.problem(problem.pid, 42);
    assert.equal(recovered.mine.lastAttempt.id, 77);
  } finally {
    oldResponse.resolve({ ok: false, status: 503 });
    await old;
  }
  assert.equal((await sources.problem(problem.pid, 42)).mine.lastAttempt.id, 77);
  assert.equal(reads, 2);
});
