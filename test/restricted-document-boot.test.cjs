"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRestrictedDocumentBoot,
  createRestrictedDocumentCommitter,
  serializeJsonForScript,
} = require("../LuoguSP.user.js");
const { deferred, flushMicrotasks } = require("./helpers.cjs");

const HTML =
  '<!DOCTYPE html><html><head><script src="https://fecdn.luogu.com.cn/app.js"></script></head><body><div id="app"></div></body></html>';

test("Document Committer validates resources and commits a prepared document once", () => {
  const calls = [];
  const committer = createRestrictedDocumentCommitter({
    documentAdapter: {
      open: () => calls.push("open"),
      write: (html) => calls.push(["write", html]),
      close: () => calls.push("close"),
    },
    resourcePolicy: {
      isAllowed: (url) => new URL(url).origin === "https://fecdn.luogu.com.cn",
    },
  });
  const prepared = {
    html: HTML,
    install: () => calls.push("install"),
  };

  committer.commit(prepared);
  assert.deepEqual(calls, [
    "install",
    "open",
    ["write", HTML],
    "close",
  ]);
  assert.throws(() => committer.commit(prepared), { kind: "invariant" });
});

test("Document Committer rejects untrusted resources before irreversible work", () => {
  let opens = 0;
  const committer = createRestrictedDocumentCommitter({
    documentAdapter: {
      open: () => opens++,
      write() {},
      close() {},
    },
    resourcePolicy: {
      isAllowed: (url) => new URL(url).origin === "https://fecdn.luogu.com.cn",
    },
  });
  assert.throws(
    () =>
      committer.commit({
        html: HTML.replace(
          "https://fecdn.luogu.com.cn/app.js",
          "https://evil.example/app.js",
        ),
      }),
    { kind: "invariant" },
  );
  assert.equal(opens, 0);
  assert.throws(
    () =>
      committer.commit({
        html: HTML.replace(
          'src="https://fecdn.luogu.com.cn/app.js"',
          "src='https://evil.example/app.js'",
        ),
      }),
    { kind: "invariant" },
  );
  assert.throws(
    () =>
      committer.commit({
        html: HTML.replace(
          'src="https://fecdn.luogu.com.cn/app.js"',
          "src=https://evil.example/app.js",
        ),
      }),
    { kind: "invariant" },
  );
  assert.equal(opens, 0);
});

test("JSON script serialization cannot terminate its containing script", () => {
  const serialized = serializeJsonForScript({
    content: "</script><img src=x onerror=alert(1)>",
  });
  assert.equal(serialized.includes("</script>"), false);
  assert.equal(serialized.includes("<img"), false);
  assert.deepEqual(JSON.parse(serialized), {
    content: "</script><img src=x onerror=alert(1)>",
  });
});

function bootFixture(overrides = {}) {
  const calls = [];
  let path = "/article/abc";
  const info = {
    type: "article",
    id: "abc",
    path,
    origUrl: "https://www.luogu.com/article/abc",
  };
  const pageAdapter = {
    detect: () => info,
    showLoader: (message) => calls.push(["loader", message || "default"]),
    showUnavailable: (message) => calls.push(["unavailable", message]),
    showFailure: (_info, message) => calls.push(["failure", message]),
    currentPath: () => path,
    isRestrictedRoute: (value) => /^\/(article|paste)\//.test(value),
    reload: () => calls.push(["reload"]),
  };
  const lifecycle = {
    replaceDocument: (commit) => {
      calls.push(["replace"]);
      const afterReady = commit();
      if (afterReady) afterReady();
      return true;
    },
  };
  const prepared = {
    html: HTML,
    afterReady: () => calls.push(["afterReady"]),
  };
  const builder = {
    prepare: async () => prepared,
    dispose: () => calls.push(["builderDispose"]),
  };
  const committer = {
    commit: (value) => calls.push(["commit", value]),
  };
  const saver = {
    ensureArchived: async () => ({
      kind: "archived",
      data: { id: "abc" },
    }),
  };
  const boot = createRestrictedDocumentBoot({
    pageAdapter: overrides.pageAdapter || pageAdapter,
    saverWorkflow: overrides.saver || saver,
    documentBuilder: overrides.builder || builder,
    documentCommitter: overrides.committer || committer,
    pageLifecycle: overrides.lifecycle || lifecycle,
  });
  return {
    boot,
    calls,
    info,
    prepared,
    setPath: (value) => {
      path = value;
    },
  };
}

test("Restricted Document Boot prepares everything before a single lifecycle commit", async () => {
  const fx = bootFixture();
  const dispose = fx.boot.mount({ isCurrent: () => true });
  await flushMicrotasks();
  assert.deepEqual(fx.calls.slice(0, 4), [
    ["loader", "default"],
    ["replace"],
    ["commit", fx.prepared],
    ["afterReady"],
  ]);

  fx.setPath("/article/next");
  fx.boot.onRoute();
  assert.deepEqual(fx.calls[4], ["reload"]);
  dispose();
});

test("Restricted Document Boot does nothing without the interstitial triple match", async () => {
  let saverCalls = 0;
  const fx = bootFixture({
    pageAdapter: {
      detect: () => null,
      currentPath: () => "/article/abc",
      isRestrictedRoute: () => true,
      reload() {},
    },
    saver: {
      ensureArchived: async () => {
        saverCalls++;
        return { kind: "archived", data: {} };
      },
    },
  });
  const dispose = fx.boot.mount({ isCurrent: () => true });
  await flushMicrotasks();
  assert.equal(saverCalls, 0);
  dispose();
});

test("Restricted Document Boot maps lookup failure and cancels stale preparation", async () => {
  const unavailable = bootFixture({
    saver: {
      ensureArchived: async () => ({
        kind: "unavailable",
        stage: "lookup",
        reason: "offline",
      }),
    },
  });
  unavailable.boot.mount({ isCurrent: () => true });
  await flushMicrotasks();
  assert.deepEqual(unavailable.calls, [
    ["loader", "default"],
    ["unavailable", "LuoguSP：offline，未自动发起收录。"],
  ]);
  assert.equal(unavailable.boot.getState().running, false);

  const unknown = bootFixture({
    saver: {
      ensureArchived: async () => ({
        kind: "unknown",
        stage: "create",
      }),
    },
  });
  unknown.boot.mount({ isCurrent: () => true });
  await flushMicrotasks();
  assert.deepEqual(unknown.calls, [
    ["loader", "default"],
    [
      "failure",
      "收录请求已发送，但保存站未在超时前确认结果，请稍后刷新页面查看。",
    ],
  ]);

  const pending = deferred();
  let prepares = 0;
  const cancelled = bootFixture({
    saver: { ensureArchived: () => pending.promise },
    builder: {
      prepare: async () => {
        prepares++;
        return { html: HTML };
      },
      dispose() {},
    },
  });
  const dispose = cancelled.boot.mount({ isCurrent: () => true });
  dispose();
  pending.resolve({ kind: "archived", data: {} });
  await flushMicrotasks();
  assert.equal(prepares, 0);
  assert.equal(
    cancelled.calls.some(([kind]) => kind === "commit"),
    false,
  );
});
