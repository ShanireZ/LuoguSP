"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createIdeBatchRunner,
  createLuoguSPApp,
} = require("../LuoguSP.user.js");
const {
  FakeClock,
  deferred,
  flushMicrotasks,
} = require("./helpers.cjs");

test("bootstrap is explicit and idempotent", () => {
  const calls = [];
  const app = createLuoguSPApp({
    bootstrapAdapter: {
      initialize: () => calls.push("initialize"),
      start: () => calls.push("start"),
    },
  });

  assert.deepEqual(calls, []);
  app.bootstrapBrowser();
  app.bootstrapBrowser();
  assert.deepEqual(calls, ["initialize", "start"]);
});

test("IDE Batch Runner prevents double start throughout preparing", async () => {
  const prepared = deferred();
  let prepares = 0;
  const runner = createIdeBatchRunner({
    ideDriver: {
      prepare() {
        prepares++;
        return prepared.promise;
      },
      runSample: async () => ({ verdict: "AC" }),
    },
    clock: new FakeClock().adapter(),
  });

  const first = runner.start();
  const second = runner.start();
  assert.equal(prepares, 1);
  assert.equal(runner.getState().state, "preparing");

  prepared.resolve({ kind: "hint", message: "本题无样例" });
  await Promise.all([first, second]);
  assert.equal(runner.getState().state, "idle");
});

test("IDE Batch Runner rejects route drift after preparation", async () => {
  const prepared = deferred();
  let current = true;
  const hints = [];
  const runner = createIdeBatchRunner({
    ideDriver: {
      prepare: () => prepared.promise,
      isCurrent: () => current,
      hint: (message) => hints.push(message),
      runSample: async () => ({ verdict: "AC" }),
    },
    clock: new FakeClock().adapter(),
  });

  const run = runner.start();
  current = false;
  prepared.resolve({ kind: "ready", count: 1 });
  await run;
  assert.deepEqual(hints, ["页面已切换"]);
  assert.equal(runner.getState().state, "idle");
});

test("IDE Batch Runner contains click failures and always restores input", async () => {
  const calls = [];
  const runner = createIdeBatchRunner({
    ideDriver: {
      prepare: async () => ({ kind: "ready", count: 1 }),
      runSample: async (_context, _index, task) =>
        task.drive(() => {
          calls.push("click");
          assert.equal(runner.getState().driving, true);
          throw new Error("boom");
        }),
      applyResult: (_context, _index, result) =>
        calls.push(`result:${result.verdict}`),
      restore: () => calls.push("restore"),
      finish: () => calls.push("finish"),
    },
    clock: new FakeClock().adapter(),
  });

  await runner.start();
  assert.deepEqual(calls, ["click", "result:UKE", "restore", "finish"]);
  assert.deepEqual(
    { state: runner.getState().state, driving: runner.getState().driving },
    { state: "idle", driving: false },
  );
});

test("IDE Batch Runner stops after current group and expands CE to remaining groups", async () => {
  const current = deferred();
  const applied = [];
  let restored = 0;
  let finished = null;
  const runner = createIdeBatchRunner({
    ideDriver: {
      prepare: async () => ({ kind: "ready", count: 3 }),
      runSample: (_context, index) =>
        index === 0 ? current.promise : Promise.resolve({ verdict: "AC" }),
      applyResult: (_context, index, result) =>
        applied.push([index, result.verdict]),
      restore: () => restored++,
      finish: (_context, results) => {
        finished = results;
      },
    },
    clock: new FakeClock().adapter(),
  });

  const run = runner.start();
  await flushMicrotasks();
  runner.stop();
  assert.equal(runner.getState().state, "stopping");
  current.resolve({ verdict: "WA" });
  await run;
  assert.deepEqual(applied, [[0, "WA"]]);
  assert.equal(restored, 1);
  assert.equal(finished[1], null);

  const ceApplied = [];
  const ceRunner = createIdeBatchRunner({
    ideDriver: {
      prepare: async () => ({ kind: "ready", count: 3 }),
      runSample: async () => ({ verdict: "CE", output: "compile log" }),
      applyResult: (_context, index, result) =>
        ceApplied.push([index, result.verdict, result.output]),
    },
    clock: new FakeClock().adapter(),
  });
  await ceRunner.start();
  assert.deepEqual(ceApplied, [
    [0, "CE", "compile log"],
    [1, "CE", "compile log"],
    [2, "CE", "compile log"],
  ]);
});

test("IDE Batch Runner dispose cancels delay, waiter and mounted listeners", async () => {
  const clock = new FakeClock();
  let cancelled = 0;
  let unmounted = 0;
  const runner = createIdeBatchRunner({
    ideDriver: {
      mount: () => () => unmounted++,
      prepare: async () => ({ kind: "ready", count: 2 }),
      runSample: async () => ({ verdict: "AC" }),
      cancel: () => cancelled++,
    },
    clock: clock.adapter(),
  });

  runner.mount();
  const run = runner.start();
  await flushMicrotasks();
  assert.equal(clock.timers.size, 1);
  runner.dispose();
  await run;
  assert.equal(clock.timers.size, 0);
  assert.equal(cancelled, 1);
  assert.equal(unmounted, 1);
  assert.equal(runner.getState().disposed, true);
});
