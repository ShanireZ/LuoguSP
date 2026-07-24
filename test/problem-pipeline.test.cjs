"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProblemPipeline } = require("../LuoguSP.user.js");
const { deferred, flushMicrotasks } = require("./helpers.cjs");

function fixture({ anchors = [], text, harvest = () => [] } = {}) {
  const writes = [];
  let observed = null;
  let route = "/problem/list";
  const pipeline = createProblemPipeline({
    identity: {
      resolve: (anchor) =>
        anchor.pid
          ? { pid: anchor.pid, key: `${anchor.href}:${anchor.pid}` }
          : null,
    },
    documentAdapter: {
      root: { anchors },
      anchors: (root) => root.anchors || [],
      observeAnchors: (accept) => {
        observed = accept;
        return () => {
          observed = null;
        };
      },
      appliedPid: (anchor) => anchor.appliedPid,
      isConnected: (anchor) => anchor.connected !== false,
      applyColor: (anchor, pid, color) => {
        anchor.appliedPid = pid;
        writes.push({ anchor, pid, color });
      },
    },
    routeAdapter: { token: () => route },
    difficultySource: { text, harvest },
    colorForDifficulty: (difficulty) => `color-${difficulty}`,
  });
  return {
    pipeline,
    writes,
    emit: (next) => observed && observed(next),
    setRoute: (next) => {
      route = next;
    },
  };
}

test("Problem Pipeline keeps temporary _contentOnly HTML from causing permanent downgrade", async () => {
  const first = { pid: "P1", href: "/problem/P1" };
  const second = { pid: "P2", href: "/problem/P2" };
  const paths = [];
  const replies = [
    "<html>challenge</html>",
    '<script>{"difficulty":2}</script>',
    '{"currentData":{"problem":{"difficulty":4}}}',
  ];
  const fx = fixture({
    anchors: [first],
    text: async (path) => {
      paths.push(path);
      return replies.shift();
    },
  });

  fx.pipeline.mount();
  await flushMicrotasks();
  fx.emit([second]);
  await flushMicrotasks();

  assert.deepEqual(paths, [
    "/problem/P1?_contentOnly=1",
    "/problem/P1",
    "/problem/P2?_contentOnly=1",
  ]);
  assert.deepEqual(
    fx.writes.map(({ pid, color }) => ({ pid, color })),
    [
      { pid: "P1", color: "color-2" },
      { pid: "P2", color: "color-4" },
    ],
  );
  fx.pipeline.dispose();
});

test("Problem Pipeline harvests injected lists once without mutating page data", async () => {
  const source = Object.freeze([
    Object.freeze({ pid: "P1", difficulty: 1 }),
    Object.freeze({ pid: "P2", difficulty: 5 }),
  ]);
  let harvests = 0;
  const fx = fixture({
    anchors: [
      { pid: "P1", href: "/problem/P1" },
      { pid: "P2", href: "/problem/P2" },
    ],
    text: async () => {
      throw new Error("harvested difficulty should avoid fetch");
    },
    harvest: () => {
      harvests++;
      return [{ source, problems: source }];
    },
  });

  fx.pipeline.mount();
  await flushMicrotasks();

  assert.equal(harvests, 2, "the adapter may be read per task");
  assert.deepEqual(Object.keys(source), ["0", "1"]);
  assert.deepEqual(
    fx.writes.map(({ pid, color }) => ({ pid, color })),
    [
      { pid: "P1", color: "color-1" },
      { pid: "P2", color: "color-5" },
    ],
  );
  fx.pipeline.dispose();
});

test("Problem Pipeline discards stale anchors, route generations and disposed work", async () => {
  const request = deferred();
  const anchor = { pid: "P10", href: "/problem/P10" };
  const fx = fixture({
    anchors: [anchor],
    text: () => request.promise,
  });
  fx.pipeline.mount();
  anchor.pid = "P100";
  anchor.href = "/problem/P100";
  fx.setRoute("/problem/P100");
  request.resolve('{"currentData":{"problem":{"difficulty":3}}}');
  await flushMicrotasks();
  assert.deepEqual(fx.writes, []);

  const disconnected = deferred();
  const anchor2 = { pid: "P20", href: "/problem/P20" };
  const fx2 = fixture({
    anchors: [anchor2],
    text: () => disconnected.promise,
  });
  fx2.pipeline.mount();
  anchor2.connected = false;
  disconnected.resolve('{"currentData":{"problem":{"difficulty":3}}}');
  await flushMicrotasks();
  assert.deepEqual(fx2.writes, []);

  const disposed = deferred();
  const fx3 = fixture({
    anchors: [{ pid: "P30", href: "/problem/P30" }],
    text: () => disposed.promise,
  });
  fx3.pipeline.mount();
  fx3.pipeline.dispose();
  disposed.resolve('{"currentData":{"problem":{"difficulty":3}}}');
  await flushMicrotasks();
  assert.deepEqual(fx3.writes, []);
});
