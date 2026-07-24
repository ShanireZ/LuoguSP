"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPageLifecycle } = require("../LuoguSP.user.js");

function fixture() {
  let routeListener = null;
  let routeSubscriptions = 0;
  let routeUnsubscriptions = 0;
  let routeToken = "/one";
  let ready = null;
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
