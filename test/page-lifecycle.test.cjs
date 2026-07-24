"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBrowserRouteAdapter,
  createPageLifecycle,
} = require("../LuoguSP.user.js");

test("Route Adapter wraps history once and restores only owned wrappers", () => {
  const calls = [];
  const events = new Map();
  const rawPush = function (value) {
    calls.push(["push", value]);
  };
  const rawReplace = function (value) {
    calls.push(["replace", value]);
  };
  const history = { pushState: rawPush, replaceState: rawReplace };
  const eventTarget = {
    addEventListener(type, listener) {
      events.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (events.get(type) === listener) events.delete(type);
    },
  };
  const adapter = createBrowserRouteAdapter({
    history,
    eventTarget,
    token: () => "/route",
  });
  let first = 0;
  let second = 0;
  const disposeFirst = adapter.subscribe(() => first++);
  const wrappedPush = history.pushState;
  const disposeSecond = adapter.subscribe(() => second++);
  assert.equal(history.pushState, wrappedPush);
  history.pushState("one");
  events.get("popstate")();
  assert.deepEqual([first, second], [2, 2]);
  disposeFirst();
  assert.equal(history.pushState, wrappedPush);
  disposeSecond();
  assert.equal(history.pushState, rawPush);
  assert.equal(history.replaceState, rawReplace);
  assert.equal(events.size, 0);

  const disposeThird = adapter.subscribe(() => {});
  const staleOwnedWrapper = history.pushState;
  const laterPagePatch = function (...args) {
    return staleOwnedWrapper.apply(this, args);
  };
  history.pushState = laterPagePatch;
  disposeThird();
  assert.equal(history.pushState, laterPagePatch);

  // 后置包装器拆除后可能恢复旧引用；旧代际必须惰性，重新订阅只能通知一次。
  history.pushState = staleOwnedWrapper;
  let fourth = 0;
  const disposeFourth = adapter.subscribe(() => fourth++);
  history.pushState("two");
  assert.equal(fourth, 1);
  disposeFourth();
});

function fixture() {
  let routeListener = null;
  let routeSubscriptions = 0;
  let routeUnsubscriptions = 0;
  let routeToken = "/one";
  let ready = null;
  let readyDisposals = 0;
  const scheduled = [];
  const errors = [];
  const lifecycle = createPageLifecycle({
    routeAdapter: {
      token: () => routeToken,
      subscribe: (listener) => {
        routeSubscriptions++;
        routeListener = listener;
        return () => {
          routeUnsubscriptions++;
          routeListener = null;
        };
      },
    },
    documentAdapter: {
      schedule: (callback) => {
        const job = { callback, cancelled: false };
        scheduled.push(job);
        return () => {
          job.cancelled = true;
        };
      },
      whenReady: (callback) => {
        ready = callback;
        return () => {
          if (ready === callback) ready = null;
          readyDisposals++;
        };
      },
    },
    storage: {},
    logError: (id, error) => errors.push([id, error.message]),
  });
  return {
    lifecycle,
    errors,
    emitRoute(next = routeToken) {
      routeToken = next;
      routeListener();
    },
    flush() {
      const jobs = scheduled.splice(0);
      for (const job of jobs) if (!job.cancelled) job.callback();
    },
    ready() {
      const callback = ready;
      ready = null;
      callback();
    },
    readyState: () => ({ pending: !!ready, disposals: readyDisposals }),
    counts: () => ({ routeSubscriptions, routeUnsubscriptions }),
  };
}

test("Page Lifecycle starts once, respects enabled and isolates feature failures", () => {
  const fx = fixture();
  const calls = [];
  fx.lifecycle
    .register({
      id: "enabled",
      enabled: () => true,
      mount: (context) => {
        calls.push(["enabled", context.generation, context.routeToken]);
        return () => calls.push(["dispose-enabled"]);
      },
    })
    .register({
      id: "disabled",
      enabled: () => false,
      mount: () => calls.push(["disabled"]),
    })
    .register({
      id: "broken",
      mount: () => {
        throw new Error("boom");
      },
    });

  fx.lifecycle.start();
  fx.lifecycle.start();
  assert.deepEqual(calls, [["enabled", 1, "/one"]]);
  assert.deepEqual(fx.errors, [["broken", "boom"]]);
  assert.deepEqual(fx.counts(), {
    routeSubscriptions: 1,
    routeUnsubscriptions: 0,
  });
});

test("Page Lifecycle coalesces routes and disposes each generation", () => {
  const fx = fixture();
  const calls = [];
  let firstContext = null;
  fx.lifecycle.register({
    id: "feature",
    mount: (context) => {
      if (!firstContext) firstContext = context;
      calls.push(`mount:${context.generation}:${context.routeToken}`);
      return () => calls.push(`dispose:${context.generation}`);
    },
  });
  fx.lifecycle.start();
  assert.equal(firstContext.isCurrent(), true);
  fx.emitRoute("/two");
  assert.equal(firstContext.isCurrent(), false);
  fx.emitRoute("/three");
  fx.flush();

  assert.deepEqual(calls, [
    "mount:1:/one",
    "dispose:1",
    "mount:3:/three",
  ]);
  assert.equal(fx.lifecycle.getState().mountedCount, 1);
});

test("Page Lifecycle ignores no-op history events for the current route", () => {
  const fx = fixture();
  let mounts = 0;
  let disposes = 0;
  fx.lifecycle.register({
    id: "feature",
    mount: () => {
      mounts++;
      return () => disposes++;
    },
  });
  fx.lifecycle.start();

  fx.emitRoute("/one");
  fx.flush();

  assert.deepEqual({ mounts, disposes }, { mounts: 1, disposes: 0 });
  assert.equal(fx.lifecycle.getState().mountedCount, 1);
});

test("Page Lifecycle replaces a document once and mounts only after ready", () => {
  const fx = fixture();
  const calls = [];
  fx.lifecycle.register({
    id: "feature",
    mount: (context) => {
      calls.push(`mount:${context.generation}`);
      return () => calls.push(`dispose:${context.generation}`);
    },
  });
  fx.lifecycle.start();

  let commits = 0;
  assert.equal(
    fx.lifecycle.replaceDocument(() => {
      commits++;
      calls.push("commit");
      return (context) => calls.push(`ready:${context.generation}`);
    }),
    true,
  );
  assert.equal(fx.lifecycle.replaceDocument(() => commits++), false);
  assert.deepEqual(calls, ["mount:1", "dispose:1", "commit"]);
  fx.ready();
  assert.deepEqual(calls, [
    "mount:1",
    "dispose:1",
    "commit",
    "mount:2",
    "ready:2",
  ]);
  assert.equal(commits, 1);
  assert.deepEqual(fx.readyState(), { pending: false, disposals: 1 });
});

test("Page Lifecycle does not remount into a failing document commit loop", () => {
  const fx = fixture();
  let mounts = 0;
  fx.lifecycle.register({
    id: "feature",
    mount: () => {
      mounts++;
      return () => {};
    },
  });
  fx.lifecycle.start();
  assert.equal(
    fx.lifecycle.replaceDocument(() => {
      throw new Error("commit failed");
    }),
    false,
  );
  assert.equal(mounts, 1);
  assert.deepEqual(fx.errors, [["replaceDocument", "commit failed"]]);
  assert.equal(fx.lifecycle.getState().mountedCount, 0);
  assert.equal(fx.lifecycle.getState().replacing, false);
});

test("Page Lifecycle dispose cancels scheduled work and owned resources", () => {
  const fx = fixture();
  let mounts = 0;
  let disposes = 0;
  fx.lifecycle.register({
    id: "feature",
    mount: () => {
      mounts++;
      return () => disposes++;
    },
  });
  fx.lifecycle.start();
  fx.emitRoute("/two");
  fx.lifecycle.dispose();
  fx.flush();

  assert.deepEqual({ mounts, disposes }, { mounts: 1, disposes: 1 });
  assert.deepEqual(fx.counts(), {
    routeSubscriptions: 1,
    routeUnsubscriptions: 1,
  });
  assert.equal(fx.lifecycle.getState().disposed, true);
});

test("Page Lifecycle dispose removes a pending document-ready listener", () => {
  const fx = fixture();
  fx.lifecycle.register({ id: "feature", mount: () => () => {} });
  fx.lifecycle.start();
  assert.equal(fx.lifecycle.replaceDocument(() => {}), true);
  assert.deepEqual(fx.readyState(), { pending: true, disposals: 0 });
  fx.lifecycle.dispose();
  assert.deepEqual(fx.readyState(), { pending: false, disposals: 1 });
});

test("Page Lifecycle closes a disposer returned by an immediate ready callback", () => {
  let readyDisposals = 0;
  const lifecycle = createPageLifecycle({
    routeAdapter: { subscribe: () => () => {}, token: () => "/" },
    documentAdapter: {
      schedule: (callback) => {
        callback();
        return null;
      },
      whenReady: (callback) => {
        callback();
        return () => readyDisposals++;
      },
    },
  });
  lifecycle.register({ id: "feature", mount: () => () => {} });
  lifecycle.start();
  assert.equal(lifecycle.replaceDocument(() => {}), true);
  assert.equal(readyDisposals, 1);
  lifecycle.dispose();
  assert.equal(readyDisposals, 1);
});

test("Page Lifecycle contains ready registration and disposer failures", () => {
  const errors = [];
  let throwOnReady = true;
  const lifecycle = createPageLifecycle({
    routeAdapter: { subscribe: () => () => {}, token: () => "/" },
    documentAdapter: {
      schedule: () => null,
      whenReady: (callback) => {
        if (throwOnReady) throw new Error("ready registration failed");
        callback();
        return () => {
          throw new Error("ready disposer failed");
        };
      },
    },
    logError: (id, error) => errors.push([id, error.message]),
  });
  lifecycle.register({ id: "feature", mount: () => () => {} });
  lifecycle.start();

  assert.equal(lifecycle.replaceDocument(() => {}), false);
  assert.equal(lifecycle.getState().replacing, false);
  assert.deepEqual(errors.shift(), [
    "documentReady",
    "ready registration failed",
  ]);

  throwOnReady = false;
  assert.equal(lifecycle.replaceDocument(() => {}), true);
  assert.equal(lifecycle.getState().replacing, false);
  assert.deepEqual(errors.shift(), [
    "documentReadyDispose",
    "ready disposer failed",
  ]);
});
