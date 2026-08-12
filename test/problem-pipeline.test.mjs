import test from "node:test";
import assert from "node:assert/strict";
import {
  recordDifficultyForHarvest,
} from "../src/features/problem-color/identity.js";
import {
  createProblemPipeline,
} from "../src/features/problem-color/pipeline.js";
import { deferred, flushMicrotasks } from "./helpers.js";

function fixture({
  anchors = [],
  text,
  harvest = () => [],
  logError = () => {},
} = {}) {
  const writes = [];
  const clears = [];
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
      clearColor: (anchor, pid) => {
        clears.push({ anchor, pid });
        delete anchor.appliedPid;
        delete anchor.color;
      },
      applyColor: (anchor, pid, color) => {
        anchor.appliedPid = pid;
        anchor.color = color;
        writes.push({ anchor, pid, color });
      },
    },
    routeAdapter: { token: () => route },
    difficultySource: { text, harvest },
    colorForDifficulty: (difficulty) => `color-${difficulty}`,
    logError,
  });
  return {
    pipeline,
    writes,
    clears,
    emit: (next) => observed && observed(next),
    setRoute: (next) => {
      route = next;
    },
  };
}

test("record harvesting trusts only difficulty ids stable across both scales", () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, difficulty) =>
      recordDifficultyForHarvest(difficulty),
    ),
    [0, 1, 2, 3, 4, null, null, null, null],
  );
  assert.equal(recordDifficultyForHarvest(-1), null);
  assert.equal(recordDifficultyForHarvest(null), null);
});

test("Problem Pipeline fetches all four ambiguous record tiers by pid", async () => {
  const records = Object.freeze([
    Object.freeze({ pid: "P5", difficulty: 5 }),
    Object.freeze({ pid: "P6", difficulty: 6 }),
    Object.freeze({ pid: "P7", difficulty: 6 }),
    Object.freeze({ pid: "P8", difficulty: 7 }),
  ]);
  const currentDifficulties = { P5: 5, P6: 6, P7: 7, P8: 8 };
  const paths = [];
  const fx = fixture({
    anchors: records.map(({ pid }) => ({ pid, href: `/problem/${pid}` })),
    text: async (path) => {
      paths.push(path);
      const pid = path.match(/^\/problem\/([^?]+)/)[1];
      return JSON.stringify({
        currentData: { problem: { difficulty: currentDifficulties[pid] } },
      });
    },
    harvest: () => [
      {
        source: records,
        problems: () =>
          records.map(({ pid, difficulty }) => ({
            pid,
            difficulty: recordDifficultyForHarvest(difficulty),
          })),
      },
    ],
  });

  fx.pipeline.mount();
  await flushMicrotasks();

  assert.deepEqual(paths, [
    "/problem/P5?_contentOnly=1",
    "/problem/P6?_contentOnly=1",
    "/problem/P7?_contentOnly=1",
    "/problem/P8?_contentOnly=1",
  ]);
  assert.deepEqual(
    fx.writes.map(({ pid, color }) => ({ pid, color })),
    [
      { pid: "P5", color: "color-5" },
      { pid: "P6", color: "color-6" },
      { pid: "P7", color: "color-7" },
      { pid: "P8", color: "color-8" },
    ],
  );
  fx.pipeline.dispose();
});

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

test("Problem Pipeline keeps a whole harvested page even when it exceeds the fetch cache", async () => {
  // A practice page ships every solved problem at once — 1300+ for an active
  // user. Harvested entries used to share the bounded fetch LRU, so a batch
  // larger than the limit evicted its own earliest entries: exactly the pids
  // rendered at the top of the page, which then fell back to one request each.
  const source = Array.from({ length: 1400 }, (_, index) => ({
    pid: `P${index}`,
    difficulty: 1,
  }));
  const fetched = [];
  const fx = fixture({
    anchors: [
      { pid: "P0", href: "/problem/P0" },
      { pid: "P699", href: "/problem/P699" },
      { pid: "P1399", href: "/problem/P1399" },
    ],
    text: async (path) => {
      fetched.push(path);
      throw new Error("a harvested pid must never be fetched");
    },
    harvest: () => [{ source, problems: source }],
  });

  fx.pipeline.mount();
  await flushMicrotasks();

  assert.deepEqual(fetched, []);
  assert.deepEqual(
    fx.writes.map(({ pid, color }) => ({ pid, color })),
    [
      { pid: "P0", color: "color-1" },
      { pid: "P699", color: "color-1" },
      { pid: "P1399", color: "color-1" },
    ],
  );
  fx.pipeline.dispose();
});

test("Problem Pipeline prefers a freshly fetched difficulty over the harvested one", async () => {
  const source = [{ pid: "P9", difficulty: 1 }];
  const anchor = { pid: "P9", href: "/problem/P9" };
  let exposeHarvest = false;
  let fetches = 0;
  const fx = fixture({
    anchors: [anchor],
    text: async () => {
      fetches++;
      return '{"currentData":{"problem":{"difficulty":7}}';
    },
    harvest: () =>
      exposeHarvest ? [{ source, problems: source }] : [],
  });

  fx.pipeline.mount();
  await flushMicrotasks();
  fx.pipeline.dispose();

  // A later route exposes an older bulk value for the same pid. Force the
  // recycled anchor through the pipeline again; the fetched value must win.
  exposeHarvest = true;
  delete anchor.appliedPid;
  delete anchor.color;
  fx.pipeline.mount();
  await flushMicrotasks();
  fx.pipeline.dispose();

  assert.equal(fetches, 1);
  assert.deepEqual(
    fx.writes.map(({ pid, color }) => ({ pid, color })),
    [
      { pid: "P9", color: "color-7" },
      { pid: "P9", color: "color-7" },
    ],
  );
});

test("Problem Pipeline clears a recycled anchor when the new problem has no difficulty", async () => {
  const anchor = { pid: "P4", href: "/problem/P4" };
  const paths = [];
  const errors = [];
  const fx = fixture({
    anchors: [anchor],
    text: async (path) => {
      paths.push(path);
      if (path === "/problem/P4?_contentOnly=1")
        return '{"currentData":{"problem":{"difficulty":4}}}';
      const error = new Error(`HTTP 403 ${path}`);
      error.status = 403;
      throw error;
    },
    logError: (pid, error) => errors.push([pid, error.message]),
  });

  fx.pipeline.mount();
  await flushMicrotasks();
  assert.equal(anchor.color, "color-4");

  anchor.pid = "TDELETED";
  anchor.href = "/problem/TDELETED";
  fx.emit([anchor]);
  await flushMicrotasks();

  assert.deepEqual(paths, [
    "/problem/P4?_contentOnly=1",
    "/problem/TDELETED?_contentOnly=1",
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    fx.clears.map(({ pid }) => pid),
    ["P4"],
  );
  assert.equal(anchor.appliedPid, undefined);
  assert.equal(anchor.color, undefined);
  assert.deepEqual(
    fx.writes.map(({ pid, color }) => ({ pid, color })),
    [{ pid: "P4", color: "color-4" }],
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
  let disposedSignal = null;
  const fx3 = fixture({
    anchors: [{ pid: "P30", href: "/problem/P30" }],
    text: (_path, options) => {
      disposedSignal = options.signal;
      return disposed.promise;
    },
  });
  fx3.pipeline.mount();
  fx3.pipeline.dispose();
  assert.equal(disposedSignal.aborted, true);
  disposed.resolve('{"currentData":{"problem":{"difficulty":3}}}');
  await flushMicrotasks();
  assert.deepEqual(fx3.writes, []);
});
