import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createNativeDifficultySource } from "../src/features/problem-color/native-difficulty-source.js";

function fixture() {
  const dom = new JSDOM('<script id="lentille-context" type="application/json">{"data":{"problem":{"pid":"P1001","difficulty":1}}}</script>');
  class XHR extends EventTarget {
    open(method, url) { this.url = url; }
    send() {}
    reply(data, { status = 200, responseType = "" } = {}) {
      this.status = status;
      this.responseURL = new URL(this.url, "https://www.luogu.com.cn").href;
      this.responseType = responseType;
      this.response = data;
      this.responseText = typeof data === "string" ? data : JSON.stringify(data);
      this.dispatchEvent(new Event("load"));
      this.dispatchEvent(new Event("loadend"));
    }
  }
  let now = 1;
  const source = createNativeDifficultySource({ document: dom.window.document,
    XMLHttpRequest: XHR, origin: "https://www.luogu.com.cn", now: () => now });
  const seen = [];
  const originalOpen = XHR.prototype.open;
  const stop = source.subscribe(() => seen.push(source.harvest().at(-1)));
  const request = (url, method = "GET") => {
    const xhr = new XHR(); xhr.open(method, url); xhr.send(); return xhr;
  };
  return { source, seen, stop, request, XHR, originalOpen, tick: () => now++ };
}

test("native page data is available during load before Luogu consumes loadend", () => {
  const fx = fixture();
  const xhr = fx.request("/problem/list?page=2");
  let valueAtNativeRender;
  xhr.addEventListener("loadend", () => { valueAtNativeRender = fx.seen[0]?.problems; });
  xhr.reply({ data: { problems: { result: [{ pid: "P1050", difficulty: 3, privateField: "ignored" }] } } });
  assert.deepEqual(valueAtNativeRender, [{ pid: "P1050", difficulty: 3 }]);
  assert.equal(fx.source.harvest()[0].problems[0].pid, "P1001");
  assert.equal(fx.source.harvest().at(-1), fx.seen[0]);
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

test("navigation collects detail/training/practice snapshots and rejects older replies", () => {
  const fx = fixture();
  const old = fx.request("/problem/P1001");
  // Same-millisecond requests still have a deterministic order.
  fx.request("/training/100").reply({ data: { training: { problems: [{ pid: "P1001", difficulty: 2 }] } } }, { responseType: "json" });
  old.reply({ data: { problem: { pid: "P1001", difficulty: 1 } } });
  assert.equal(fx.seen.length, 1);
  fx.tick();
  fx.request("/user/1/practice").reply({ data: {
    submitted: [{ pid: "P1001", difficulty: 3 }], passed: [{ pid: "P1002", difficulty: 1 }],
  } });
  assert.deepEqual(fx.seen.at(-1).problems, [{ pid: "P1001", difficulty: 3 }]);
  const pending = fx.request("/problem/P1003");
  fx.stop();
  pending.reply({ data: { problem: { pid: "P1003", difficulty: 2 } } });
  assert.equal(fx.seen.length, 2);
});
