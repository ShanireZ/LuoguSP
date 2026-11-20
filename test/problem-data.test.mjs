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

test("first explicit viewer confirmation keeps the legacy viewer's cache and pending detail", async () => {
  const reply = deferred();
  const data = createProblemData({ origin, text: () => reply.promise, legacyViewer: () => 42, now: () => 7 });
  const training = url("/training/1");
  data.rememberPage({ data: { training: { problems: [problem] } } }, training, 7);
  const pending = data.load("P1002", { fields: ["difficulty"] });
  const { key } = data.peekDifficulty(problem.pid);

  data.rememberPage({ viewer: 42, data: {} }, url("/problem/P1003?lang=en"), 7);
  reply.resolve(JSON.stringify({ user: { uid: 42 }, data: { problem: { pid: "P1002", difficulty: 4 } } }));

  assert.equal((await pending)?.data.problem.difficulty, 4);
  assert.deepEqual(data.peekDifficulty(problem.pid), { key, difficulty: 1, at: 7, order: undefined });
});

test("native record lists break timestamp ties by request order", () => {
  const { pid } = problem;
  const data = createProblemData({ origin, now: () => 1000 });
  const recordsUrl = url(`/record/list?user=42&pid=${pid}`);
  const remember = (at, order, scores) => data.rememberPage({
    viewer: 42,
    template: "record.list",
    data: { records: { result: scores.map(score => ({ score, problem, user: { uid: 42 } })) } },
  }, recordsUrl, at, order);
  const scores = () => data.records(pid)?.map(({ score }) => score);

  remember(999, 2, [50]);
  remember(999, 1, [25]);
  assert.deepEqual(scores(), [50]);
  remember(1000, 3, []);
  remember(999, 2, [50]);
  assert.deepEqual(scores(), []);
});

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
      assert.equal(init.redirect, "manual");
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

test("empty and unusable detail replies leave native summaries available and retryable", async () => {
  const incomplete = { pid: problem.pid, name: " ", tags: ["unknown"], limits: { time: [] }, samples: null };
  for (const summary of [undefined, { ...problem, totalAccepted: 0, submitted: false }]) {
    const replies = [{}, incomplete, { pid: problem.pid, name: "Full title" }];
    const data = createProblemData({ origin, now: () => 3, text: async () => JSON.stringify({
      data: { problem: replies.shift() },
    }) });
    data.rememberPage({ viewer: 42, data: { recommendations: summary ? [summary] : [] } },
      url("/problem/P2000"), 1);

    assert.deepEqual((await data.load(problem.pid))?.data.problem, summary);
    data.rememberPage({ viewer: 42, data: { problem: incomplete, bookmarked: false } },
      url("/problem/P1001"), 2);
    assert.deepEqual(data.peek(problem.pid)?.data.problem, summary);
    assert.deepEqual((await data.load(problem.pid))?.data.problem, summary);
    assert.equal(replies.length, 1);
    assert.deepEqual((await data.load(problem.pid))?.data.problem,
      { ...summary, pid: problem.pid, name: "Full title" });
    assert.equal((await data.load(problem.pid))?.data.problem.name, "Full title");
    assert.equal(replies.length, 0);
  }
});

test("partial details retry only for missing consumer fields and preserve known data", async () => {
  const { pid, name, samples } = problem;
  const replies = [
    { problem: { pid, difficulty: 0, limits: { time: [1000] } }, bookmarked: false },
    { problem: { pid, name, limits: { memory: [128000] } } },
    { problem: { pid, samples } },
  ];
  const data = createProblemData({ origin, text: async () => JSON.stringify({ data: replies.shift() }) });
  const load = (...fields) => data.load(pid, { fields });

  assert.equal((await load("name", "difficulty")).data.problem.name, undefined);
  assert.equal((await load("difficulty")).data.problem.difficulty, 0);
  assert.equal(replies.length, 2);

  const titled = await load("name", "difficulty");
  assert.equal(titled.data.problem.name, name);
  assert.equal(titled.data.problem.difficulty, 0);
  assert.equal(titled.data.bookmarked, false);
  assert.deepEqual(titled.data.problem.limits, { time: [1000], memory: [128000] });
  await load("name", "difficulty");
  assert.equal(replies.length, 1);

  const complete = await load("samples");
  assert.deepEqual(complete.data.problem, { ...titled.data.problem, samples });
  assert.deepEqual(await load("samples"), complete);
  assert.equal(replies.length, 0);
});

test("empty sample lists from detail and native data satisfy IDE lookups", async () => {
  for (const native of [false, true]) {
    let reads = 0;
    const detail = { pid: problem.pid, samples: [] };
    const data = createProblemData({ origin, text: async () => {
      reads++;
      return JSON.stringify({ data: { problem: detail } });
    } });
    const href = `/problem/${problem.pid}?contestId=42&lang=en`;
    if (native) data.rememberPage({ viewer: 0, data: { problem: detail } }, url(href), Date.now());

    assert.deepEqual((await data.load(problem.pid, { href, fields: ["samples"] })).data.problem.samples, []);
    assert.deepEqual((await data.load(problem.pid, { href, fields: ["samples"] })).data.problem.samples, []);
    assert.equal(reads, native ? 0 : 1);
  }
});

test("a partial detail preserves newer summary fields and the original sample expiry", async () => {
  const { pid, samples } = problem;
  let time = 0;
  const requests = [];
  const data = createProblemData({ origin, now: () => time, text: async (path) => {
    requests.push(path);
    return JSON.stringify({ data: {
      problem: requests.length === 1 ? { pid, difficulty: 3 } : { pid, samples },
    } });
  } });
  const load = (...fields) => data.load(pid, { fields });
  const initial = { pid, name: "Original title", accepted: false, totalAccepted: 12, samples: [] };
  data.rememberPage({ data: { problem: initial } }, url(`/problem/${pid}`), time);
  time = 60_000;
  const updated = { pid, name: "Updated title", accepted: true, totalAccepted: 13 };
  data.rememberPage({ data: { training: { problems: [updated] } } }, url("/training/123"), time);
  assert.deepEqual(data.peek(pid).data.problem, { ...updated, samples: [] });

  time = 299_000;
  const combined = { ...updated, difficulty: 3 };
  assert.deepEqual((await load("name", "difficulty")).data.problem, { ...combined, samples: [] });
  time = 299_999;
  assert.deepEqual((await load("samples")).data.problem.samples, []);
  assert.equal(requests.length, 1);

  time = 300_000;
  assert.deepEqual(data.peek(pid).data.problem, combined);
  assert.deepEqual((await load("samples")).data.problem, { ...combined, samples });
  assert.deepEqual(requests, Array(2).fill(`/problem/${pid}?_contentOnly=1`));
  time = 360_000;
  assert.deepEqual(data.peek(pid).data.problem, { pid, difficulty: 3, samples });
});

test("partial summaries and details retain separate expiry for each limit and bookmark", () => {
  const { pid } = problem;
  let time = 0;
  const data = createProblemData({ origin, now: () => time, ttlMs: 100 });
  const native = (problem, bookmarked) =>
    data.rememberPage({ data: { problem, bookmarked } }, url(`/problem/${pid}`), time);
  const summary = (problem) => data.rememberPage(
    { data: { training: { problems: [problem] } } }, url("/training/123"), time);
  const peek = () => data.peek(pid)?.data;
  native({ pid, limits: { time: [1000], memory: [128000] } }, false);
  time = 30;
  summary({ pid, name: "New title", limits: { time: [2000] } });
  time = 50;
  native({ pid, limits: { memory: [256000] } });
  time = 70;
  summary({ pid, totalAccepted: 0, tags: [] });

  assert.deepEqual(peek(), {
    problem: { pid, name: "New title", limits: { time: [2000], memory: [256000] }, totalAccepted: 0, tags: [] },
    bookmarked: false,
  });
  time = 100;
  assert.equal(peek().bookmarked, undefined);
  assert.deepEqual(peek().problem.limits, { time: [2000], memory: [256000] });
  time = 130;
  assert.deepEqual(peek().problem, { pid, limits: { memory: [256000] }, totalAccepted: 0, tags: [] });
  time = 150;
  assert.deepEqual(peek().problem, { pid, totalAccepted: 0, tags: [] });
  time = 170;
  assert.equal(peek(), undefined);
});

test("a pending detail lookup fills omissions without replacing newer native fields", async () => {
  const reply = deferred();
  let time = 1;
  const data = createProblemData({ origin, now: () => time, text: () => reply.promise });
  const { pid } = problem;
  const notices = [];
  data.subscribeDifficulty((changedPid) => notices.push(changedPid));
  const ide = data.load(pid, { fields: ["samples"] });
  time++;
  data.rememberPage({ data: { problem: { pid, difficulty: 2 } } }, url(`/problem/${pid}`), time);
  reply.resolve(JSON.stringify({ data: { problem } }));

  const result = await ide;
  assert.deepEqual(result.data.problem, { ...problem, difficulty: 2 });
  assert.equal(result.difficultyAt, 2);
  assert.deepEqual(notices, [], "an older detail leaves the selected difficulty intact");
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
  const notices = [];
  data.subscribeDifficulty((pid, key) => notices.push([pid, key]));
  const route = new AbortController();
  const color = data.load(problem.pid, { signal: route.signal, fields: ["difficulty"] });
  const hover = data.load(problem.pid, { fields: ["name", "difficulty"] });
  const ide = data.load(problem.pid, { href: "/problem/P1001#ide", fields: ["samples"] });
  route.abort();
  request.resolve(textResponse(JSON.stringify({ data: { problem } })));
  assert.equal(await color, null);
  assert.equal((await hover).data.problem.name, "A+B");
  assert.deepEqual((await ide).data.problem.samples, problem.samples);
  assert.deepEqual(calls, ["/problem/P1001?_contentOnly=1"]);
  assert.deepEqual(notices, [[problem.pid, data.peekDifficulty(problem.pid).key]]);
  scheduler.dispose();
});

for (const retry of [false, true]) {
  test(`a ${retry ? "retried" : "queued"} detail uses the successful transport start time`, async (t) => {
    const { pid } = problem;
    const clock = new FakeClock();
    const starts = [];
    const scheduler = createGetRequestScheduler({
      clock: clock.adapter(),
      fetch: (path) => {
        if (path === "/previous") return textResponse("previous");
        starts.push(clock.nowMs);
        if (retry && starts.length === 1) return textResponse("busy", 429, { "retry-after": "1" });
        return textResponse(JSON.stringify({ data: { problem } }));
      },
    });
    t.after(() => scheduler.dispose());
    if (!retry) {
      await scheduler.text("/previous");
      await clock.advance(20);
    }
    const data = createProblemData({ origin, text: scheduler.text, now: clock.adapter().now });
    const first = data.load(pid, { fields: ["name", "difficulty"] });
    await flushMicrotasks();
    await clock.advance(100 - clock.nowMs);
    data.rememberPage({
      data: { training: { problems: [{ pid, name: "Older summary", difficulty: 2 }] } },
    }, url("/training/100"), clock.nowMs);
    const samples = data.load(pid, { fields: ["samples"] });
    await clock.advance(retry ? 900 : 200);
    const results = await Promise.all([first, samples]);
    assert.deepEqual(starts, retry ? [0, 1000] : [300]);
    assert.deepEqual(results.map(({ data }) => data.problem), [problem, problem]);
    assert.deepEqual(results.map(({ difficultyAt }) => difficultyAt), Array(2).fill(starts.at(-1)));
  });
}

test("a late subscriber keeps the start time of an already-running detail attempt", async (t) => {
  const { pid } = problem;
  const clock = new FakeClock();
  const pending = deferred();
  let reads = 0;
  const scheduler = createGetRequestScheduler({
    clock: clock.adapter(),
    launchGap: 0,
    fetch: () => ++reads === 1 ? pending.promise :
      textResponse(JSON.stringify({ data: { problem } })),
  });
  t.after(() => scheduler.dispose());
  const data = createProblemData({ origin, text: scheduler.text, now: clock.adapter().now, ttlMs: 100 });
  const route = new AbortController();
  const first = data.load(pid, { signal: route.signal });
  await clock.advance(10);
  const native = { pid, name: "New title", difficulty: 2 };
  data.rememberPage({ data: { problem: native } }, url(`/problem/${pid}`), clock.nowMs);
  await clock.advance(10);
  const later = data.load(pid, { fields: ["samples"] });
  route.abort();
  pending.resolve(textResponse(JSON.stringify({ data: { problem: { ...problem, samples: [] } } })));

  assert.equal(await first, null);
  assert.deepEqual((await later).data.problem, { ...native, samples: [] });
  assert.equal(reads, 1);
  await clock.advance(80);
  assert.deepEqual(data.peek(pid).data.problem, native);
  assert.deepEqual((await data.load(pid, { fields: ["samples"] })).data.problem.samples, problem.samples);
  assert.equal(reads, 2);
});

test("legacy problem HTML is read only from an identified data context", async () => {
  const payload = encodeURIComponent(JSON.stringify({ currentData: { problem } }));
  const data = createProblemData({
    origin, text: async () => `<script>window._feInjection = JSON.parse(decodeURIComponent("${payload}"))</script>`,
  });
  assert.equal((await data.load(problem.pid)).data.problem.difficulty, 1);
  assert.equal(await data.load("P2000"), null);
});

test("contest, language and account contexts cannot reuse another context's details", async () => {
  const calls = [];
  const data = createProblemData({
    origin, text: async (path, { key }) => {
      calls.push({ path, key });
      return JSON.stringify({ data: { problem } });
    },
  });
  const at = Date.now();
  data.rememberPage({ viewer: 42, data: { problem } }, url("/problem/P1001"), at);
  const english = "/problem/P1001?contestId=123&lang=en";
  const chinese = "/problem/P1001?contestId=123&lang=zh";
  const load = (href) => data.load(problem.pid, { href, fields: ["samples"] });
  assert.equal(data.peek(problem.pid, { href: english }), null);
  await load(english);
  assert.equal(data.peek(problem.pid, { href: chinese }), null);
  await load(chinese);
  data.rememberPage({ viewer: 43, data: {} }, url("/problem/list"), at + 1);
  assert.equal(data.peek(problem.pid), null);
  await load(english);
  assert.deepEqual(calls.map(({ path }) => path), [english, chinese, english].map((href) => `${href}&_contentOnly=1`));
  assert.equal(new Set(calls.map(({ key }) => key)).size, 3);
});

test("returning to a viewer starts a fresh detail without joining their earlier request", async (t) => {
  const { pid } = problem;
  const clock = new FakeClock();
  const earlier = deferred();
  const calls = [];
  const reply = (difficulty) => textResponse(JSON.stringify({ user: { uid: 42 }, data: {
    problem: { ...problem, difficulty },
  } }));
  const scheduler = createGetRequestScheduler({
    clock: clock.adapter(), launchGap: 0,
    fetch: (path) => calls.push(path) === 1 ? earlier.promise : reply(4),
  });
  t.after(() => scheduler.dispose());
  const data = createProblemData({ origin, text: scheduler.text, now: clock.adapter().now });
  const observe = (viewer) => data.rememberPage({ viewer, data: {} }, url("/problem/list"), clock.nowMs);
  observe(42);
  const previous = data.load(pid, { fields: ["difficulty"] });
  observe(43);
  observe(42);
  const current = data.load(pid, { fields: ["difficulty"] });
  earlier.resolve(reply(2));
  assert.equal(await previous, null);
  assert.equal((await current).data.problem.difficulty, 4);
  assert.equal(data.peekDifficulty(pid).difficulty, 4);
  assert.deepEqual(calls, Array(2).fill(`/problem/${pid}?_contentOnly=1`));
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

test("hover card shows available difficulty and fetches the missing title on reopening", async () => {
  const { pid, name, difficulty } = problem;
  let reads = 0;
  const data = createProblemData({ origin, text: async () => JSON.stringify({ data: {
    problem: ++reads === 1 ? { pid, difficulty } : { pid, name },
  } }) });
  const sources = createHoverCardSources({ origin, problemData: data,
    fetchPage: () => assert.fail("unexpected supplemental lookup") });

  const partial = await sources.problem(pid, 0);
  assert.equal(partial.name, pid);
  assert.equal(partial.difficulty, difficulty);
  const recovered = await sources.problem(pid, 0);
  assert.equal(recovered.name, name);
  assert.equal(recovered.difficulty, difficulty);
  assert.deepEqual(await sources.problem(pid, 0), recovered);
  assert.equal(reads, 2);
});

test("a hover refresh removes fields that expired during the detail read", async () => {
  const { pid, name } = problem;
  const reply = deferred();
  let time = 0;
  const data = createProblemData({ origin, text: () => reply.promise, now: () => time, ttlMs: 100 });
  data.rememberPage({ data: { problem: { pid, name, totalAccepted: 12 } } }, url(`/problem/${pid}`), time);
  const sources = createHoverCardSources({ origin, problemData: data,
    fetchPage: () => assert.fail("unexpected supplemental lookup") });
  const updates = [];
  time = 99;
  const shown = sources.problem(pid, 0, undefined, { onUpdate: (card) => updates.push(card) });
  assert.equal(updates[0].name, name);
  assert.equal(updates[0].acceptedCount, 12);
  time = 100;
  reply.resolve(JSON.stringify({ data: { problem: { pid, difficulty: 3 } } }));
  const refreshed = await shown;
  assert.equal(refreshed.difficulty, 3);
  assert.equal(refreshed.name, pid);
  assert.equal(refreshed.acceptedCount, null);
});

function recordPreviewSources(fetchPage, clock) {
  const now = clock?.now ?? Date.now;
  const data = createProblemData({ origin, now, text: () => assert.fail("unexpected detail lookup") });
  data.rememberPage({ viewer: 42, data: { problem } }, url("/problem/P1001"), now());
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

for (const status of [403, 503]) for (const [failFirst, closeFirst] of [[true, false], [false, false], [true, true]])
test(`a native record supersedes a cached ${status} after eviction (failure settled first: ${failFirst}, closed: ${closeFirst})`, async () => {
  const user = { uid: 42 };
  const row = score => ({ id: score, score, user, problem, submitTime: score });
  const data = createProblemData({ origin, now: () => 10, text: () => assert.fail("unexpected detail lookup") });
  data.rememberPage({ viewer: 42, data: { problem } }, url("/problem/P1001"), 10);
  const denied = { url: recordUrl, ok: false, status, redirected: false };
  const failures = status === 503 ? 2 : 1;
  const response = deferred();
  const controller = new AbortController();
  let requests = 0;
  let score;
  const sources = createHoverCardSources({ origin, problemData: data, clock: { now: () => 10 },
    fetchPage: () => {
      requests++;
      if (requests < failures) return denied;
      return requests === failures ? response.promise : recordReply([row(60)]);
    },
  });
  if (failures === 2) await sources.problem(problem.pid, 42);
  const open = sources.problem(problem.pid, 42, controller.signal, {
    onUpdate: card => { score = card.mine.lastAttempt?.score; },
  });
  await flushMicrotasks();
  if (failFirst) {
    response.resolve(denied);
    await open;
  }
  if (closeFirst) {
    controller.abort();
    data.rememberPage({ template: "record.list", data: { records: { result: [row(90)] } } },
      url(recordUrl + "&contestId=1"), 10, 1);
    assert.equal((await sources.problem(problem.pid, 42)).mine.lastAttempt, null);
    assert.equal(requests, failures, "another contest cannot retire the unresolved failure");
  }
  data.rememberPage({ template: "record.list", data: { records: { result: [row(50)] } } }, url(recordUrl), 10, 1);
  for (let i = 0; i < 30; i++)
    data.rememberPage({ template: "record.list", data: { records: { result: [] } } },
      url(`/record/list?user=42&pid=P${1100 + i}`), 10, i + 2);
  response.resolve(denied);
  await open;
  assert.equal(score, closeFirst ? undefined : 50);
  controller.abort();
  const reopened = await sources.problem(problem.pid, 42);
  assert.equal(reopened.mine.lastAttempt?.score, 60);
  assert.equal(requests, failures + 1);
});

for (const [nativeDelay, nativeScores, expected] of [
  [0, [50], 50],
  [1, [], null],
  [-1, [50], 25],
]) test(`an open hover preview orders an overlapping native record and fallback (${nativeDelay}, ${nativeScores})`, async () => {
  const { pid } = problem;
  const user = { uid: 42 };
  const row = (score) => ({ id: score, user, problem, submitTime: score, score });
  const request = deferred();
  const started = deferred();
  const controller = new AbortController();
  const data = createProblemData({ origin, now: () => 10, text: () => assert.fail("unexpected detail lookup") });
  data.rememberPage({ viewer: 42, data: { problem } }, url(`/problem/${pid}`), 10);
  let requests = 0;
  const sources = createHoverCardSources({ origin, problemData: data, clock: { now: () => 10 },
    fetchPage(path) {
      assert.equal(path, recordUrl);
      requests++;
      started.resolve();
      return request.promise;
    },
  });
  const updates = [];
  const score = (card) => card.mine.lastAttempt?.score ?? null;
  const shown = sources.problem(pid, 42, controller.signal, { onUpdate: (card) => updates.push(score(card)) });
  await started.promise;
  const native = (path, at, order, scores) => data.rememberPage({
    viewer: 42, template: "record.list", data: { records: { result: scores.map(row) } },
  }, url(path), at, order);
  const beforeOtherScope = [...updates];
  native(recordUrl + "&contestId=1", 10, 1, [90]);
  assert.deepEqual(updates, beforeOtherScope);
  native(recordUrl, 10 + nativeDelay, 2, nativeScores);
  const early = updates.at(-1);
  request.resolve(recordReply([row(25)]));
  assert.equal(score(await shown), expected);
  assert.equal(updates.at(-1), expected);
  if (nativeScores.length) assert.equal(early, 50, "native result should publish while the fallback is pending");
  native(recordUrl, 11, 3, []);
  assert.equal(updates.at(-1), null);
  controller.abort();
  native(recordUrl, 11, 4, [60]);
  assert.equal(updates.at(-1), null, "closed preview should stop receiving records");
  assert.equal(score(await sources.problem(pid, 42)), 60);
  assert.equal(requests, 1);
});

for (const scores of [[50], []]) test(`an open hover preview keeps its native result after record cache eviction (${scores})`, async (t) => {
  const user = { uid: 42 };
  const row = (score) => ({ id: score, user, problem, submitTime: score, score });
  const pending = deferred();
  const started = deferred();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const data = createProblemData({ origin, now: () => 10, text: () => assert.fail("unexpected detail lookup") });
  data.rememberPage({ viewer: 42, data: { problem } }, url("/problem/P1001"), 10);
  let requests = 0;
  const sources = createHoverCardSources({ origin, problemData: data, clock: { now: () => 10 },
    fetchPage(path) {
      assert.equal(path, recordUrl);
      requests++;
      started.resolve();
      return requests === 1 ? pending.promise : recordReply(scores.map(row));
    },
  });
  const score = (card) => card.mine.lastAttempt?.score ?? null;
  const updates = [];
  const shown = sources.problem(problem.pid, 42, controller.signal, { onUpdate: card => updates.push(score(card)) });
  await started.promise;
  data.rememberPage({ viewer: 42, template: "record.list", data: { records: { result: scores.map(row) } } },
    url(recordUrl), 10, 1);
  for (let id = 1100; id < 1130; id++) {
    const pid = `P${id}`;
    data.rememberPage({ viewer: 42, template: "record.list", data: { records: { result: [] } } },
      url(`/record/list?user=42&pid=${pid}`), 10, id);
  }
  pending.resolve(recordReply([row(25)]));
  const expected = scores[0] ?? null;
  assert.equal(score(await shown), expected);
  assert.equal(updates.at(-1), expected);
  assert.equal(requests, 1);
  controller.abort();
  assert.equal(data.records(problem.pid), undefined, "closing the preview releases its evicted result");
  assert.equal(score(await sources.problem(problem.pid, 42)), expected);
  assert.equal(score(await sources.problem(problem.pid, 42)), expected);
  assert.equal(requests, 2, "reuse the fresh shared result after fetching it once on reopen");
});

for (const legacy of [false, true]) test(`returning to a viewer does not join or publish their old pending record fallback (legacy: ${legacy})`, async (t) => {
  const controller = new AbortController();
  t.after(() => controller.abort());
  let legacyUid = 42;
  const data = createProblemData({ origin, legacyViewer: () => legacy ? legacyUid : 0,
    now: () => 10, text: () => assert.fail("unexpected detail lookup") });
  const viewer = (uid) => {
    legacyUid = uid;
    if (legacy) assert.equal(data.viewerUid(), uid);
    data.rememberPage({ viewer: legacy ? undefined : uid, data: { problem } }, url("/problem/P1001"), 10);
    assert.equal(data.viewerUid(), uid);
  };
  viewer(42);
  const planned = [deferred(), deferred()];
  const started = [deferred(), deferred()];
  let requests = 0;
  const sources = createHoverCardSources({ origin, problemData: data, clock: { now: () => 10 },
    fetchPage(path) {
      assert.equal(path, recordUrl);
      const index = requests++;
      started[index].resolve();
      return planned[index].promise;
    },
  });
  const scores = [];
  const score = (card) => card.mine.lastAttempt?.score ?? null;
  const old = sources.problem(problem.pid, 42, controller.signal, { onUpdate: model => scores.push(score(model)) });
  await started[0].promise;
  viewer(43);
  viewer(42);
  const recent = sources.problem(problem.pid, 42);
  await flushMicrotasks();
  assert.equal(requests, 2, "the fresh preview should start its own request");
  const reply = (score) => recordReply([{ id: score, user: { uid: 42 }, problem, submitTime: score, score }]);
  planned[0].resolve(reply(25));
  await old;
  assert.equal(data.records(problem.pid), undefined);
  assert.ok(!scores.includes(25));
  planned[1].resolve(reply(60));
  assert.equal(score(await recent), 60);
  assert.deepEqual(data.records(problem.pid).map(row => row.score), [60]);
});

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
      assert.equal(init.redirect, "manual");
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
