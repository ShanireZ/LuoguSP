import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createNativeUserInfo } from "../src/browser/luogu-user-info.js";
import { createNativeDifficultySource } from "../src/features/problem-color/native-difficulty-source.js";
import { createProblemData } from "../src/features/problem-color/problem-data.js";

function fixture({
  path = "/problem/P1001",
  page = { data: { problem: { pid: "P1001", difficulty: 1 } } },
  prepareOtherGet,
} = {}) {
  const dom = new JSDOM(
    `<script id="lentille-context" type="application/json">${JSON.stringify(page)}</script>`,
    { url: `https://www.luogu.com.cn${path}` },
  );
  class XHR extends EventTarget {
    reads = 0;
    open(method, url) { this.url = new URL(url, dom.window.document.baseURI).href.split("#")[0]; }
    send() {}
    getResponseHeader(name) { return name === "content-type" ? this.mediaType : null; }
    get response() { this.reads++; return this.data; }
    get responseText() { this.reads++; return typeof this.data === "string" ? this.data : JSON.stringify(this.data); }
    reply(data, {
      status = 200, responseType = "", mediaType = "application/json", responseUrl = this.url,
    } = {}) {
      this.status = status;
      this.responseURL = responseUrl;
      this.responseType = responseType;
      this.mediaType = mediaType;
      this.data = data;
      this.dispatchEvent(new Event("load"));
      this.dispatchEvent(new Event("loadend"));
    }
  }
  let now = 1;
  const origin = "https://www.luogu.com.cn";
  const data = createProblemData({ origin, now: () => now });
  const source = createNativeDifficultySource({ document: dom.window.document,
    XMLHttpRequest: XHR, origin, now: () => now, onPage: data.rememberPage, prepareOtherGet });
  const seen = [];
  const originalOpen = XHR.prototype.open;
  const harvest = () => source.harvest().batches;
  const stop = source.subscribe(({ batch }) => seen.push(batch?.problems.length ? batch : harvest().at(-1)));
  const request = (url, method = "GET") => {
    const xhr = new XHR(); xhr.open(method, url); xhr.send(); return xhr;
  };
  return { source, data, seen, stop, harvest, request, document: dom.window.document,
    XHR, originalOpen, tick: () => now++ };
}

test("native page data is available during load before Luogu consumes loadend", () => {
  const fx = fixture();
  const xhr = fx.request("/problem/list?page=2");
  let valueAtNativeRender;
  xhr.addEventListener("loadend", () => { valueAtNativeRender = fx.seen[0]?.problems; });
  xhr.reply({ data: { problems: { result: [{ pid: "P1050", difficulty: 3, privateField: "ignored" }] } } });
  assert.deepEqual(valueAtNativeRender, [{ pid: "P1050", difficulty: 3 }]);
  assert.equal(fx.harvest()[0].problems[0].pid, "P1001");
  assert.equal(fx.harvest().at(-1), fx.seen[0]);
  fx.stop();
  assert.equal(fx.XHR.prototype.open, fx.originalOpen);
});

test("native observer ignores wrong origins, methods, shapes, tiers, and passed problems", () => {
  const fx = fixture();
  const good = { data: { problem: { pid: "P1001", difficulty: 1 } } };
  fx.request("https://other.example/problem/P1001").reply(good);
  fx.request("/problem/P1001", "POST").reply(good);
  fx.request("/api/user/info/1").reply(good);
  fx.request("/problem/P1001").reply(good, { status: 403 });
  fx.request("/problem/P1001").reply("<html>Login</html>");
  fx.request("/user/1/practice").reply({ data: { passed: [{ pid: "P1001", difficulty: 1 }] } });
  fx.request("/problem/list").reply({ data: { problems: [
    { pid: "P1", difficulty: "1" }, { pid: "P2", difficulty: 9 },
    { pid: "P3", difficulty: -1 }, { pid: "P4", difficulty: 1.5 },
    { pid: "P5/evil", difficulty: 1 },
  ] } });
  assert.equal(fx.seen.length, 0);
  fx.stop();
});

test("native Lentille data is read only from the original normalized URL with JSON media", () => {
  const fx = fixture();
  const data = { data: { problem: { pid: "P1001", difficulty: 2 } } };
  const base = fx.document.createElement("base");
  base.href = "https://www.luogu.com.cn/problem/";
  fx.document.head.append(base);
  const xhr = fx.request("/problem/P1001?page=1#ide");
  xhr.reply(data, { responseUrl: "https://www.luogu.com.cn/problem/P1001?page=2" });
  assert.equal(xhr.reads, 0);
  assert.deepEqual(fx.seen, []);

  xhr.open("GET", "/problem/P1001?page=1#ide");
  xhr.send();
  xhr.reply(data, { mediaType: "text/plain", responseType: "json" });
  assert.equal(xhr.reads, 0);
  assert.deepEqual(fx.seen, []);

  xhr.open("GET", "./P1001?page=1#ide");
  xhr.send();
  base.href = "https://www.luogu.com.cn/";
  xhr.reply(data, { mediaType: "Application/JSON; charset=utf-8", responseType: "json" });
  assert.equal(xhr.reads, 1);
  assert.deepEqual(fx.seen[0].problems, [{ pid: "P1001", difficulty: 2 }]);
  fx.stop();
});

test("native user-info only stores eligible JSON for the original URL and viewer", async () => {
  let account = 42;
  const info = createNativeUserInfo({ origin: "https://www.luogu.com.cn", viewer: () => account });
  const fx = fixture({ path: "/api/user/info/", prepareOtherGet: info.prepare });
  const data = { user: { uid: 123, name: "Native preview", unrelated: "ignored" } };
  const xhr = fx.request("/api/user/info/123?locale=en");
  let joined = info.read(123, account);
  xhr.reply(data, { responseUrl: "https://www.luogu.com.cn/api/user/info/123?locale=zh" });
  assert.equal(await joined, null);
  assert.equal(await info.read(123, account), null);
  assert.equal(xhr.reads, 0);

  xhr.open("GET", "/api/user/info/123");
  xhr.send();
  joined = info.read(123, account);
  xhr.reply(data, { mediaType: null });
  assert.equal(await joined, null);
  assert.equal(await info.read(123, account), null);
  assert.equal(xhr.reads, 0);

  xhr.open("GET", "./123");
  xhr.send();
  joined = info.read(123, account);
  xhr.open("GET", "./123");
  xhr.send();
  xhr.reply(data, { responseType: "json" });
  assert.equal(await joined, null);
  assert.equal(xhr.reads, 1);
  assert.deepEqual(await info.read(123, account), { user: { uid: 123, name: "Native preview" } });
  account++;
  assert.equal(await info.read(123, account), null);
  fx.stop();
});

test("navigation collects detail/training/practice snapshots with their request order", () => {
  const fx = fixture();
  const old = fx.request("/problem/P1001");
  // Same-millisecond requests still have a deterministic order.
  fx.request("/training/100").reply({ data: { training: { problems: [{ pid: "P1001", difficulty: 2 }] } } }, { responseType: "json" });
  old.reply({ data: { problem: { pid: "P1001", difficulty: 1 } } });
  assert.deepEqual(fx.seen.map(({ order }) => order), [2, 1]);
  assert.equal(fx.data.peekDifficulty("P1001").difficulty, 2);
  fx.tick();
  fx.request("/user/1/practice").reply({ data: {
    submitted: [{ pid: "P1001", difficulty: 3 }], passed: [{ pid: "P1002", difficulty: 1 }],
  } });
  assert.deepEqual(fx.seen.at(-1).problems, [{ pid: "P1001", difficulty: 3 }]);
  const pending = fx.request("/problem/P1003");
  fx.stop();
  pending.reply({ data: { problem: { pid: "P1003", difficulty: 2 } } });
  assert.equal(fx.seen.length, 3);
});

test("same-millisecond native details keep newer fields and accept older omissions", () => {
  const user = { uid: 42 };
  const href = "/problem/P1001?contestId=123&lang=en";
  const fx = fixture({ path: href, page: { user, data: { problem: { pid: "P1001", difficulty: 1 } } } });
  fx.harvest();
  const changed = [];
  fx.data.subscribeDifficulty((pid) => changed.push(fx.data.peekDifficulty(pid, href).difficulty));
  const older = fx.request(href);
  fx.request(href).reply({ user, data: { problem: { pid: "P1001", difficulty: 4 } } });
  older.reply({ user, data: { problem: { pid: "P1001", difficulty: 2, samples: [["1", "2"]] } } });
  assert.deepEqual(changed, [4]);
  assert.deepEqual(fx.data.peek("P1001", { href }).data.problem,
    { pid: "P1001", difficulty: 4, samples: [["1", "2"]] });
  fx.stop();
});

test("a late native detail remains available after a list for another PID", () => {
  const fx = fixture();
  fx.harvest();
  const older = fx.request("/problem/P1001");
  fx.request("/problem/list").reply({ data: { problems: [{ pid: "P1002", difficulty: 2 }] } });
  older.reply({ data: { problem: { pid: "P1001", difficulty: 4 } } });
  assert.deepEqual(fx.seen.map(({ problems }) => problems), [
    [{ pid: "P1002", difficulty: 2 }],
    [{ pid: "P1001", difficulty: 4 }],
  ]);
  assert.equal(fx.data.peekDifficulty("P1001").difficulty, 4);
  assert.equal(fx.harvest().at(-1).problems[0].pid, "P1002", "retain the newest batch for later mounts");
  fx.stop();
});

test("native detail and summary use request order to break same-time ties", () => {
  const user = { uid: 42 };
  const href = "/problem/P1001?contestId=123&lang=en";
  const fx = fixture({ path: href, page: { user, data: { problem: { pid: "P1001", difficulty: 1 } } } });
  fx.harvest();
  const older = fx.request("/problem/list?contestId=123&lang=en");
  fx.request(href).reply({ user, data: { problem: { pid: "P1001", difficulty: 4 } } });
  older.reply({ user, data: { problems: [{ pid: "P1001", difficulty: 2, totalAccepted: 12 }] } });
  assert.equal(fx.data.peekDifficulty("P1001", href).difficulty, 4);
  assert.deepEqual(fx.data.peek("P1001", { href }).data.problem, { pid: "P1001", difficulty: 4, totalAccepted: 12 });
  fx.stop();
});

test("native navigation reuses problem recommendations with valid difficulty fields", () => {
  const fx = fixture();
  fx.request("/problem/P1001").reply({ data: {
    recommendations: [
      { pid: "P1421", difficulty: 1 },
      { pid: "P1425", difficulty: 2 },
      { pid: "P1000", difficulty: null },
    ],
  } });
  assert.deepEqual(fx.seen[0].problems, [
    { pid: "P1421", difficulty: 1 },
    { pid: "P1425", difficulty: 2 },
  ]);
  fx.stop();
});

test("an observed viewer change retires embedded and native batches even without a replacement", () => {
  const user = { uid: 42 };
  const page = (user, pid) => ({ user, data: { problems: pid ? [{ pid, difficulty: 2 }] : [] } });
  const fx = fixture({ path: "/problem/list", page: page(user, "P1001") });
  assert.equal(fx.harvest()[0].problems[0].pid, "P1001");
  fx.tick();
  fx.request("/problem/list").reply(page(user, "P1002"));
  assert.deepEqual(fx.harvest().map((batch) => batch.problems[0].pid), ["P1001", "P1002"]);
  fx.tick();
  const late = fx.request("/problem/list");
  const unlabeled = fx.request("/problem/list");
  fx.request("/problem/list").reply(page({ uid: 43 }));
  assert.equal(fx.seen.length, 2, "a viewer change alone requests a rescan");
  assert.deepEqual(fx.harvest(), []);
  late.reply(page(user, "P1003"));
  unlabeled.reply(page(undefined, "P1004"));
  assert.deepEqual(fx.harvest(), [], "a stale reply cannot revive the previous viewer's batch");
  fx.stop();
});

test("record difficulty uses the visible page's native tiers only in academic mode", () => {
  const userList = "/record/list?user=116524";
  const problemList = "/record/list?pid=P17832";
  const detail = "/record/307939068";
  const user = { learnMode: true };
  const record = { id: 307939068, problem: { pid: "P17832", difficulty: 8 } };
  const list = {
    template: "record.list", user,
    data: { records: { result: [
      record,
      { id: 307939067, problem: { pid: "P17832", difficulty: 7 } },
      { id: 307939066, problem: { pid: "P9999", difficulty: null } },
    ] } },
  };
  const show = { template: "record.show", user, data: { record } };
  const fx = fixture({ path: userList, page: list });
  fx.source.harvest();

  assert.equal(fx.source.recordDifficulty(userList, record.id, "P17832"), 8);
  assert.equal(fx.source.recordDifficulty(userList, "307939067", "P17832"), 7);
  assert.equal(fx.source.recordDifficulty(userList, "307939066", "P9999"), undefined);
  assert.equal(fx.source.recordDifficulty(problemList, record.id, "P17832"), undefined);
  assert.equal(fx.source.recordDifficulty(detail, record.id, "P17832"), undefined);
  const older = fx.request(userList);
  fx.request(detail).reply(show, { responseType: "json" });
  assert.equal(fx.source.recordDifficulty(detail, record.id, "P17832"), 8);
  older.reply(list);
  assert.equal(fx.source.recordDifficulty(detail, record.id, "P17832"), 8);

  fx.request(problemList).reply(list);
  assert.equal(fx.source.recordDifficulty(problemList, record.id, "P17832"), 8);
  assert.equal(fx.source.recordDifficulty(detail, record.id, "P17832"), 8);
  fx.request(problemList).reply({ ...list, user: { learnMode: false } });
  assert.equal(fx.source.recordDifficulty(problemList, record.id, "P17832"), undefined);
  fx.request(userList).reply({ ...list, user: null });
  assert.equal(fx.source.recordDifficulty(userList, record.id, "P17832"), undefined);
  fx.request(detail).reply({ ...show, data: { record: { ...show.data.record, id: 123 } } });
  assert.equal(fx.source.recordDifficulty(detail, record.id, "P17832"), undefined);
  fx.stop();
});

test("record snapshots order responses per route and preserve other record pages", () => {
  const userList = "/record/list?user=1";
  const problemList = "/record/list?pid=P1001";
  const page = (difficulty) => ({
    template: "record.list", user: { learnMode: true },
    data: { records: { result: [{ id: 1, problem: { pid: "P1001", difficulty } }] } },
  });
  const fx = fixture();
  const first = fx.request(userList);
  const superseded = fx.request(problemList);
  fx.request(problemList).reply(page(7));
  first.reply(page(5));
  superseded.reply(page(6));

  assert.equal(fx.source.recordDifficulty(userList, "1", "P1001"), 5);
  assert.equal(fx.source.recordDifficulty(problemList, "1", "P1001"), 7);
  fx.stop();
});
