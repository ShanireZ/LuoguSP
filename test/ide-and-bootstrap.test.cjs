"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLuoguSPApp } = require("../LuoguSP.user.js");
const { deferred } = require("./helpers.cjs");

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

test("IDE preparing state prevents double start and is always released", async () => {
  const samples = deferred();
  let reads = 0;
  const hints = [];
  const app = createLuoguSPApp({
    exposeTestInterface: true,
    idePreparationAdapter: {
      mountTabs() {},
      currentPid: () => "P1000",
      loadSamples() {
        reads++;
        return samples.promise;
      },
      isModeActive: () => true,
      hint: (message) => hints.push(message),
    },
  });

  const first = app.test.startIdeBatch();
  const second = app.test.startIdeBatch();
  assert.equal(reads, 1);
  assert.equal(app.test.ideState().preparing, true);

  samples.resolve(null);
  await Promise.all([first, second]);
  assert.equal(app.test.ideState().preparing, false);
  assert.deepEqual(hints, ["本题无样例"]);
});

test("IDE preparation rejects stale route and click failures restore driving", async () => {
  const samples = deferred();
  let pid = "P1000";
  const hints = [];
  const app = createLuoguSPApp({
    exposeTestInterface: true,
    idePreparationAdapter: {
      mountTabs() {},
      currentPid: () => pid,
      loadSamples: () => samples.promise,
      isModeActive: () => true,
      hint: (message) => hints.push(message),
    },
  });

  const run = app.test.startIdeBatch();
  pid = "P2000";
  samples.resolve([{ input: "1", output: "1" }]);
  await run;
  assert.deepEqual(hints, ["页面已切换"]);
  assert.equal(app.test.ideState().preparing, false);

  assert.throws(
    () => app.test.clickIdeRun({ click: () => { throw new Error("boom"); } }),
    /boom/,
  );
  assert.equal(app.test.ideState().driving, false);
});
