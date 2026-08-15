import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRestrictedPasteScaffold,
} from "../src/features/restricted-content/paste-scaffold.js";
import {
  createRestrictedPageDetector,
} from "../src/features/restricted-content/page-detector.js";
import {
  completeRestrictedArticleInteraction,
} from "../src/features/restricted-content/article-interaction-state.js";
import {
  createOfficialArticleWriteAdapter,
} from "../src/features/restricted-content/article-write-adapter.js";
import {
  createRestrictedReplyFetchAdapter,
} from "../src/features/restricted-content/reply-fetch-adapter.js";
import {
  createRestrictedReplyFetchInstaller,
} from "../src/features/restricted-content/reply-fetch-installer.js";
import {
  createRestrictedReplyXhrAdapter,
} from "../src/features/restricted-content/reply-xhr-adapter.js";
import {
  createRestrictedUrlPolicy,
} from "../src/features/restricted-content/url-policy.js";
import {
  createSaverProtocol,
} from "../src/features/restricted-content/saver-protocol.js";
import {
  createSaverTransport,
} from "../src/features/restricted-content/saver-transport.js";
import {
  createSaverWorkflow,
} from "../src/features/restricted-content/saver-workflow.js";
import { FakeClock, flushMicrotasks } from "./helpers.js";

test("Paste scaffold parser accepts the quoted config version used by Luogu", () => {
  const injection = encodeURIComponent(
    JSON.stringify({ currentTheme: null, currentUser: null }),
  );
  const scaffold = [
    '<meta name="csrf-token" content="token:abc=">',
    '<link rel="stylesheet" href="https://fecdn.luogu.com.cn/luogu/loader.css?ver=20260422">',
    `<script>window._feInjection = JSON.parse(decodeURIComponent("${injection}"));`,
    "window._feConfigVersion='1784804286';",
    "window._tagVersion=1784876547;</script>",
    '<script src="https://fecdn.luogu.com.cn/luogu/loader.js?ver=20260422" charset="utf-8" defer></script>',
  ].join("");

  assert.deepEqual(parseRestrictedPasteScaffold(scaffold), {
    injection: { currentTheme: null, currentUser: null },
    configVersionLiteral: "'1784804286'",
    tagVersionLiteral: "1784876547",
    csrf: "token:abc=",
    loaderCss:
      "https://fecdn.luogu.com.cn/luogu/loader.css?ver=20260422",
    loaderJs: "https://fecdn.luogu.com.cn/luogu/loader.js?ver=20260422",
  });

  assert.equal(
    parseRestrictedPasteScaffold(
      scaffold.replace(
        "window._feConfigVersion='1784804286';",
        "window._feConfigVersion=1784804286;",
      ),
    ).configVersionLiteral,
    "1784804286",
  );
  assert.equal(
    parseRestrictedPasteScaffold(
      scaffold.replace(
        "window._feConfigVersion='1784804286';",
        "window._feConfigVersion=1784804286+alert(1);",
      ),
    ),
    null,
  );
});

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

  const cancelledPost = createSaverWorkflow({
    transport: {
      get: async () => ({ code: 404 }),
      post: async () => {
        throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
      },
    },
    clock: clock.adapter(),
  });
  const cancelled = await cancelledPost.ensureArchived("paste", "ghi");
  assert.equal(cancelled.kind, "unavailable");
  assert.equal(cancelled.category, "cancelled");
  assert.equal(cancelled.stage, "create");
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
  const requests = [];
  const workflow = createSaverWorkflow({
    transport: {
      get: async () => ({ code: 404 }),
      post: async (path, body) => {
        requests.push({ path, body });
        return replies.shift();
      },
    },
    clock: clock.adapter(),
  });

  const first = await workflow.requestRefresh("article", "abc");
  assert.equal(first.kind, "unavailable");
  assert.equal(first.retryable, true);
  assert.deepEqual(await workflow.requestRefresh("article", "abc"), {
    kind: "accepted",
  });
  // ★ 不发 forceUpdate。上游维护者明确表示没打算把这个权限交给公开不鉴权的入口
  // （laikit-dev/luogu-saver#85），而我们要它的唯一理由——补真实发表时间——在
  // 上游 #84 之后已由保存站在跳过路径上自己完成，不再需要强制重写。
  assert.deepEqual(requests, [
    {
      path: "/workflow/create/template/article-save-pipeline",
      body: { targetId: "abc" },
    },
    {
      path: "/workflow/create/template/article-save-pipeline",
      body: { targetId: "abc" },
    },
  ]);

  requests.length = 0;
  replies.push({ code: 202 });
  await workflow.requestRefresh("paste", "def");
  assert.deepEqual(requests[0], {
    path: "/workflow/create/template/paste-save-pipeline",
    body: { targetId: "def" },
  });
});

test("restricted original URL policy discards untrusted input", () => {
  const policy = createRestrictedUrlPolicy();
  assert.equal(
    policy.originalUrl("article", "abc"),
    "https://www.luogu.com/article/abc",
  );
  assert.throws(() => policy.originalUrl("problem", "P1000"), TypeError);
  assert.throws(() => policy.originalUrl("article", "../abc"), TypeError);
  assert.throws(() => policy.originalUrl("paste", ""), TypeError);
});

test("restricted page detection requires all three anchors and canonicalizes output", () => {
  const policy = createRestrictedUrlPolicy();
  const state = {
    path: "/article/abc",
    title: "安全访问中心",
    target: "https://evil.example/?next=/article/abc",
  };
  const detector = createRestrictedPageDetector({
    path: () => state.path,
    title: () => state.title,
    target: () => state.target,
    urlPolicy: policy,
  });
  assert.deepEqual(detector.detect(), {
    type: "article",
    id: "abc",
    path: "/article/abc",
    origUrl: "https://www.luogu.com/article/abc",
  });
  state.title = "文章";
  assert.equal(detector.detect(), null);
  state.title = "安全访问中心";
  state.target = "";
  assert.equal(detector.detect(), null);
  state.target = "/article/abc";
  state.path = "/article/ab";
  assert.equal(detector.detect(), null);
  state.path = "/problem/P1000";
  assert.equal(detector.detect(), null);
});

test("restricted article interaction state keeps nested and outer fields aligned", () => {
  const known = completeRestrictedArticleInteraction({
    article: { lid: "abc", upvote: 5, favorCount: 4 },
    archived: { favored: true, voted: 1, canReply: true },
    viewer: { uid: 123 },
  });
  assert.deepEqual(
    {
      article: {
        voted: known.article.voted,
        canReply: known.article.canReply,
        canEdit: known.article.canEdit,
      },
      favored: known.favored,
      voted: known.voted,
      canReply: known.canReply,
      canEdit: known.canEdit,
    },
    {
      article: { voted: 1, canReply: true, canEdit: false },
      favored: true,
      voted: 1,
      canReply: true,
      canEdit: false,
    },
  );

  const unknown = completeRestrictedArticleInteraction({
    article: { lid: "abc" },
    archived: {},
    viewer: { uid: 123 },
  });
  assert.equal(unknown.favored, null);
  assert.equal(unknown.voted, null);
  assert.equal(unknown.article.voted, null);
  assert.equal(unknown.article.canReply, true);
  assert.equal(
    completeRestrictedArticleInteraction({
      article: { lid: "abc" },
      archived: { canReply: true },
      viewer: null,
    }).article.canReply,
    false,
  );
});

test("official article writes preserve user intent and enforce same-origin auth", async () => {
  const calls = [];
  const adapter = createOfficialArticleWriteAdapter({
    fetch: async (request) => {
      calls.push(request);
      return new Response('{"upvotes":7,"voted":1}', { status: 200 });
    },
    origin: "https://www.luogu.com.cn",
    URL,
    Request,
    Headers,
    lid: "abc",
    csrf: "same-origin-token",
  });

  assert.equal(calls.length, 0);
  const response = await adapter.fetch("/article/abc/vote?vote=1", {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.luogu.com.cn/article/abc/vote?vote=1");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].credentials, "same-origin");
  assert.equal(calls[0].headers.get("x-csrf-token"), "same-origin-token");
  assert.equal(await calls[0].text(), "{}");

  const requestBody = JSON.stringify({ content: "hello" });
  const request = new Request(
    "https://www.luogu.com.cn/article/abc/reply",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
    },
  );
  await adapter.fetch(request);
  assert.equal(await calls[1].text(), requestBody);
  assert.equal(calls[1].headers.get("content-type"), "application/json");
  assert.equal(calls[1].headers.get("x-csrf-token"), "same-origin-token");
});

test("official article write adapter does not hijack unrelated or failed requests", async () => {
  const originalInputs = [];
  const serverFailure = new Response('{"error":"denied"}', { status: 403 });
  const adapter = createOfficialArticleWriteAdapter({
    fetch: async (input, init) => {
      originalInputs.push({ input, init });
      return serverFailure;
    },
    origin: "https://www.luogu.com.cn",
    URL,
    Request,
    Headers,
    lid: "abc",
    csrf: "same-origin-token",
  });

  assert.equal(await adapter.fetch("/article/abc/favor", { method: "GET" }), serverFailure);
  assert.equal(originalInputs[0].input, "/article/abc/favor");
  assert.deepEqual(originalInputs[0].init, { method: "GET" });
  assert.equal(
    await adapter.fetch("/article/other/reply", { method: "POST" }),
    serverFailure,
  );
  assert.equal(originalInputs[1].input, "/article/other/reply");

  const failedWrite = await adapter.fetch("/article/abc/favor", {
    method: "POST",
    headers: { "X-CSRF-TOKEN": "official-token" },
  });
  assert.equal(failedWrite, serverFailure);
  assert.equal(
    originalInputs[2].input.headers.get("x-csrf-token"),
    "official-token",
  );
});

test("reply fetch adapter prefers a valid same-origin Luogu response", async () => {
  const nativeCalls = [];
  const replies = [
    { id: 1, time: 10, content: "old" },
    { id: 2, time: 30, content: "new" },
    { id: 3, time: 20, content: "middle" },
  ];
  const adapter = createRestrictedReplyFetchAdapter({
    fetch: async (input, init) => {
      nativeCalls.push({ input: String(input), method: init && init.method });
      return new Response(
        JSON.stringify({ replySlice: [{ id: 9, content: "live" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
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
  assert.deepEqual((await exact.json()).replySlice, [
    { id: 9, content: "live" },
  ]);

  const crossOrigin = await adapter.fetch(
    "https://evil.example/article/abc/replies",
  );
  assert.equal((await crossOrigin.json()).replySlice[0].id, 9);
  await adapter.fetch("/article/abc/replies", { method: "POST" });
  await adapter.fetch("/other?next=/article/abc/replies");
  assert.equal(nativeCalls.length, 4);

  assert.throws(
    () =>
      createRestrictedReplyFetchAdapter({
        fetch: async () => "fallback",
        origin: "https://www.luogu.com.cn",
        Response,
        URL,
        lid: "../abc",
        replies: [],
      }),
    TypeError,
  );
});

test("reply fetch adapter falls back to Saver only when Luogu replies fail", async () => {
  const nativeResponses = [
    Promise.reject(new TypeError("offline")),
    Promise.resolve(new Response("denied", { status: 503 })),
    Promise.resolve(
      new Response('{"unexpected":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  ];
  const adapter = createRestrictedReplyFetchAdapter({
    fetch: () => nativeResponses.shift(),
    origin: "https://www.luogu.com.cn",
    Response,
    URL,
    lid: "abc",
    replies: [
      { id: 1, time: 10, content: "old" },
      { id: 2, time: 30, content: "new" },
      { id: 3, time: 20, content: "middle" },
    ],
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await adapter.fetch(
      "/article/abc/replies?sort=time-d&after=2",
    );
    assert.equal(response.headers.get("x-luogusp-source"), "saver");
    assert.deepEqual((await response.json()).replySlice.map(({ id }) => id), [
      3,
      1,
    ]);
  }
});

test("reply fetch adapter preserves caller cancellation", async () => {
  const aborted = new DOMException("Aborted", "AbortError");
  const adapter = createRestrictedReplyFetchAdapter({
    fetch: async () => {
      throw aborted;
    },
    origin: "https://www.luogu.com.cn",
    Response,
    URL,
    lid: "abc",
    replies: [{ id: 1, time: 10, content: "stale" }],
  });

  await assert.rejects(adapter.fetch("/article/abc/replies"), aborted);
});

function xhrHarness(response) {
  const instances = [];
  class FakeXhr {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.statusText = "";
      this.responseText = "";
      this.response = "";
      this.responseType = "";
      this.responseURL = "";
      this.timeout = 0;
      this.withCredentials = false;
      this.upload = {};
      this.headers = [];
      instances.push(this);
    }
    open(method, url) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(name, value) {
      this.headers.push([name, value]);
    }
    getAllResponseHeaders() {
      return response.headers || "content-type: application/json\r\n";
    }
    getResponseHeader(name) {
      return /content-type/i.test(name) ? "application/json" : null;
    }
    send(body) {
      this.body = body;
      Object.assign(this, response, { readyState: 4 });
      queueMicrotask(() => this.onloadend?.({ type: "loadend" }));
    }
    abort() {
      this.aborted = true;
      queueMicrotask(() => this.onabort?.({ type: "abort" }));
    }
    addEventListener(type, listener) {
      this[`on${type}`] = listener;
    }
    removeEventListener(type, listener) {
      if (this[`on${type}`] === listener) this[`on${type}`] = null;
    }
  }
  return { FakeXhr, instances };
}

test("reply XHR adapter preserves valid live Luogu replies", async () => {
  const live = JSON.stringify({ replySlice: [{ id: 91, content: "live" }] });
  const { FakeXhr, instances } = xhrHarness({
    status: 200,
    statusText: "OK",
    responseText: live,
    response: live,
  });
  const { XMLHttpRequest: AdaptedXhr } = createRestrictedReplyXhrAdapter({
    XMLHttpRequest: FakeXhr,
    URL,
    origin: "https://www.luogu.com.cn",
    lid: "abc",
    replies: [{ id: 1, time: 1, content: "saved" }],
  });
  const xhr = new AdaptedXhr();
  xhr.open("GET", "/article/abc/replies?sort=");
  const loaded = new Promise((resolve) => {
    xhr.onloadend = resolve;
  });
  xhr.send();
  await loaded;
  assert.equal(xhr.status, 200);
  assert.equal(xhr.responseText, live);
  assert.equal(xhr.getResponseHeader("x-luogusp-source"), null);
  assert.equal(instances.length, 1);
});

test("reply XHR adapter exposes Saver replies after a live request failure", async () => {
  const { FakeXhr } = xhrHarness({ status: 0, responseText: "", response: "" });
  const { XMLHttpRequest: AdaptedXhr } = createRestrictedReplyXhrAdapter({
    XMLHttpRequest: FakeXhr,
    URL,
    origin: "https://www.luogu.com.cn",
    lid: "abc",
    replies: [
      { id: 1, time: 10, content: "old" },
      { id: 2, time: 30, content: "new" },
      { id: 3, time: 20, content: "middle" },
    ],
  });
  const xhr = new AdaptedXhr();
  xhr.responseType = "json";
  xhr.open("GET", "/article/abc/replies?sort=time-d&after=2");
  const loaded = new Promise((resolve) => {
    xhr.onloadend = resolve;
  });
  xhr.send();
  await loaded;
  assert.equal(xhr.status, 200);
  assert.equal(xhr.getResponseHeader("x-luogusp-source"), "saver");
  assert.deepEqual(xhr.response.replySlice.map(({ id }) => id), [3, 1]);
});

test("reply fetch installer replaces its own wrapper and restores safely", async () => {
  const originalFetch = async () => new Response("fallback");
  const { FakeXhr } = xhrHarness({ status: 200, responseText: '{"replySlice":[]}' });
  const host = { fetch: originalFetch, XMLHttpRequest: FakeXhr };
  const installer = createRestrictedReplyFetchInstaller({
    host,
    origin: "https://www.luogu.com.cn",
    Response,
    URL,
  });
  const releaseFirst = installer.install("abc", [
    { id: 1, time: 1, content: "first" },
  ]);
  const firstWrapper = host.fetch;
  const firstXhr = host.XMLHttpRequest;
  installer.install("abc", [{ id: 2, time: 2, content: "second" }]);
  assert.notEqual(host.fetch, firstWrapper);
  assert.notEqual(host.XMLHttpRequest, firstXhr);
  releaseFirst();
  assert.notEqual(host.fetch, originalFetch);
  installer.dispose();
  assert.equal(host.fetch, originalFetch);
  assert.equal(host.XMLHttpRequest, FakeXhr);

  installer.install("abc", []);
  const staleWrapper = host.fetch;
  const laterPagePatch = async () => new Response("page");
  host.fetch = laterPagePatch;
  installer.dispose();
  assert.equal(host.fetch, laterPagePatch);

  // 后置包装器日后拆除时可能恢复旧引用；已 dispose 的 LuoguSP 包装必须保持惰性透传。
  host.fetch = staleWrapper;
  const revived = await host.fetch("/article/abc/replies");
  assert.equal(await revived.text(), "fallback");
});

// ★ WebIDL 的接口常量挂在构造器**和**原型两处。只挂构造器时 `xhr.DONE` 是 undefined，
//   任何写 `xhr.readyState === xhr.DONE` 的第三方代码都会永远判假 ——
//   而我们换掉的是页面的全局 XMLHttpRequest，页面上跑什么不归我们挑。
test("reply XHR adapter exposes the readyState constants on instances too", () => {
  const { FakeXhr } = xhrHarness({ status: 200, responseText: "", response: "" });
  const { XMLHttpRequest: AdaptedXhr } = createRestrictedReplyXhrAdapter({
    XMLHttpRequest: FakeXhr,
    URL,
    origin: "https://www.luogu.com.cn",
    lid: "abc",
    replies: [],
  });
  const expected = {
    UNSENT: 0,
    OPENED: 1,
    HEADERS_RECEIVED: 2,
    LOADING: 3,
    DONE: 4,
  };
  const instance = new AdaptedXhr();
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(AdaptedXhr[name], value, `构造器上缺 ${name}`);
    assert.equal(instance[name], value, `实例上缺 ${name}`);
  }
});

// ★ XHR 实例可以复用（同一个对象再 open 一次）。不复位 completed/fallback 的话，
//   第二次请求的所有事件都会被 handleNative 早退吞掉，readyState 恒为 4，
//   responseText 恒是上一次的回退体 —— 第二次请求彻底哑掉。
test("reply XHR adapter resets its fallback state when the instance is reused", async () => {
  const live = JSON.stringify({ replySlice: [{ id: 91, content: "live" }] });
  let next = { status: 0, statusText: "", responseText: "", response: "" };
  const instances = [];
  class ReusableXhr {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.statusText = "";
      this.responseText = "";
      this.response = "";
      this.responseType = "";
      this.responseURL = "";
      instances.push(this);
    }
    open() {
      this.readyState = 1;
    }
    send() {
      Object.assign(this, next, { readyState: 4 });
      queueMicrotask(() => this.onloadend?.({ type: "loadend" }));
    }
    abort() {}
    setRequestHeader() {}
    getAllResponseHeaders() {
      return "content-type: application/json\r\n";
    }
    getResponseHeader() {
      return null;
    }
    addEventListener(type, listener) {
      this[`on${type}`] = listener;
    }
    removeEventListener() {}
  }
  const { XMLHttpRequest: AdaptedXhr } = createRestrictedReplyXhrAdapter({
    XMLHttpRequest: ReusableXhr,
    URL,
    origin: "https://www.luogu.com.cn",
    lid: "abc",
    replies: [{ id: 1, time: 1, content: "saved" }],
  });

  const xhr = new AdaptedXhr();
  const once = () =>
    new Promise((resolve) => {
      xhr.onloadend = resolve;
    });

  // 第一趟：洛谷挂了 → 用保存站回退。
  let done = once();
  xhr.open("GET", "/article/abc/replies");
  xhr.send();
  await done;
  assert.deepEqual(JSON.parse(xhr.responseText).replySlice.length, 1);
  assert.equal(xhr.getResponseHeader("x-luogusp-source"), "saver");

  // 第二趟复用同一个实例：洛谷这次好了，必须原样透传，不许还端着上一次的回退体。
  next = { status: 200, statusText: "OK", responseText: live, response: live };
  done = once();
  xhr.open("GET", "/article/abc/replies?sort=time-d");
  xhr.send();
  await done;
  assert.equal(xhr.status, 200);
  assert.equal(xhr.responseText, live);
  assert.equal(xhr.getResponseHeader("x-luogusp-source"), null);
  assert.equal(instances.length, 1);
});
