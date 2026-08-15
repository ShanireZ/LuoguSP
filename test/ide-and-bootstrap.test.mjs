import test from "node:test";
import assert from "node:assert/strict";
import {
  IDE_BATCH_LABEL,
  createBatchButtonHint,
} from "../src/features/ide-batch/batch-hint.js";
import {
  createIdeBatchRunner,
} from "../src/features/ide-batch/runner.js";
import {
  createLuoguSPApp,
} from "../src/app/create-luogusp-app.js";
import {
  FakeClock,
  deferred,
  flushMicrotasks,
} from "./helpers.js";

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

test("IDE Batch Runner aborts pending preparation on dispose", async () => {
  let preparationSignal = null;
  const runner = createIdeBatchRunner({
    ideDriver: {
      prepare: ({ signal }) => {
        preparationSignal = signal;
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ kind: "hint", message: "cancelled" }),
            { once: true },
          );
        });
      },
      runSample: async () => ({ verdict: "AC" }),
    },
    clock: new FakeClock().adapter(),
  });

  const run = runner.start();
  assert.equal(preparationSignal.aborted, false);
  runner.dispose();
  await run;
  assert.equal(preparationSignal.aborted, true);
  assert.equal(runner.getState().disposed, true);
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

test("IDE Batch Runner never restores stale input after unmount", async () => {
  const pending = deferred();
  let restores = 0;
  const runner = createIdeBatchRunner({
    ideDriver: {
      prepare: async () => ({ kind: "ready", count: 1 }),
      runSample: () => pending.promise,
      restore: () => restores++,
    },
    clock: new FakeClock().adapter(),
  });

  runner.mount();
  const run = runner.start();
  await flushMicrotasks();
  runner.unmount();
  pending.resolve({ verdict: "AC" });
  await run;

  assert.equal(restores, 0);
  assert.equal(runner.getState().state, "idle");
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

test("IDE Batch Runner remounts only when the document generation changes", () => {
  const clock = new FakeClock();
  let generation = {};
  let mounts = 0;
  let unmounts = 0;
  const runner = createIdeBatchRunner({
    ideDriver: {
      mountKey: () => generation,
      mount: () => {
        mounts++;
        return () => unmounts++;
      },
      prepare: async () => ({ kind: "ready", count: 0 }),
      runSample: async () => ({ verdict: "AC" }),
    },
    clock: clock.adapter(),
  });

  runner.mount();
  runner.mount();
  assert.deepEqual({ mounts, unmounts }, { mounts: 1, unmounts: 0 });
  generation = {};
  runner.mount();
  assert.deepEqual({ mounts, unmounts }, { mounts: 2, unmounts: 1 });
  runner.dispose();
  assert.equal(unmounts, 2);
});

// ★ `diffLineNumbers` / `normalizeIdeOut` 是 2.14.1 减肥时从 feature.js 里拎出来的。
//   拎出来之前它内联在 applyIdeResult 里、没有直接覆盖，而它是「哪几行标红」的**唯一**判据。
//   顺手把它钉住 —— 减肥是零行为变化的重构，这几条就是那个「零」的凭据。
test("逐行差异：只标出真正不同的行，长度不齐也算差异", async () => {
  const { diffLineNumbers, normalizeIdeOut } = await import(
    "../src/features/ide-batch/result-view.js"
  );
  assert.deepEqual([...diffLineNumbers(["a", "b"], ["a", "b"])], []);
  assert.deepEqual([...diffLineNumbers(["a", "b"], ["a", "c"])], [1]);
  // 实际比期望短：缺的那几行也要算差异。
  assert.deepEqual([...diffLineNumbers(["a", "b", "c"], ["a"])], [1, 2]);
  // 实际比期望长：多出来的同样算。
  assert.deepEqual([...diffLineNumbers(["a"], ["a", "b"])], [1]);

  // 归一化：CRLF、行尾空白、末尾多余空行都要抹平 —— 否则整屏标红。
  assert.equal(normalizeIdeOut("a\r\nb\r\n"), "a\nb");
  assert.equal(normalizeIdeOut("a  \t\nb"), "a\nb");
  assert.equal(normalizeIdeOut("a\n\n\n"), "a");
  assert.equal(normalizeIdeOut(null), "");
  assert.equal(normalizeIdeOut(undefined), "");
});

// ★ 一次性提示的恢复目标必须是**固定文案**。旧写法拿当时的 `textContent` 当快照，
//   1500ms 内的第二条提示会把第一条提示存成「原文案」，按钮从此再也变不回「一键测试」。
//   「重新测试」按钮从不禁用（提示只禁用「一键测试」那一枚），连点两下就能复现。
test("批测提示连发两条后仍然恢复成「一键测试」", () => {
  const timers = new Map();
  let nextId = 1;
  const clock = {
    setTimeout: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const button = { textContent: IDE_BATCH_LABEL, disabled: false };
  const hint = createBatchButtonHint({ findButton: () => button, clock });

  assert.equal(hint.show("本题无样例"), true);
  assert.equal(button.textContent, "本题无样例");
  assert.equal(button.disabled, true);
  // 第一条还没到点，第二条就来了。
  assert.equal(hint.show("页面已切换"), true);
  assert.equal(button.textContent, "页面已切换");
  // 只剩最后那一个定时器；先前那个必须已被取消，否则它到点会写回错的文案。
  assert.equal(timers.size, 1);

  for (const fire of [...timers.values()]) fire();
  assert.equal(button.textContent, IDE_BATCH_LABEL);
  assert.equal(button.disabled, false);
  assert.equal(hint.isPending(), false);
});

test("批测提示到点时重新定位按钮，并尊重仍在运行的状态", () => {
  const timers = [];
  const clock = {
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
  };
  // Vue 在提示期间把按钮重种了一枚 —— 恢复必须落在新节点上。
  let button = { textContent: IDE_BATCH_LABEL, disabled: false };
  const stale = button;
  const hint = createBatchButtonHint({ findButton: () => button, clock });
  hint.show("提交失败 HTTP 429", true);
  button = { textContent: "一键测试", disabled: false };
  timers.forEach((fire) => fire());

  assert.equal(stale.textContent, "提交失败 HTTP 429");
  assert.equal(button.textContent, IDE_BATCH_LABEL);
  assert.equal(button.disabled, true, "批测仍在跑时不该把按钮放开");
});

test("批测提示找不到按钮时安然返回 false，不排定时器", () => {
  const hint = createBatchButtonHint({ findButton: () => null });
  assert.equal(hint.show("本题无样例"), false);
  assert.equal(hint.isPending(), false);
});
