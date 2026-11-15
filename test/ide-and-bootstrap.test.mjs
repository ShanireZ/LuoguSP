import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { observeIdeOutput } from "../src/features/ide-batch/output-observer.js";
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

test("IDE output captures a replacement result before the submission response and detaches", async () => {
  const dom = new JSDOM('<main><span>旧结果</span><textarea></textarea></main>');
  const root = dom.window.document.querySelector("main");
  const clock = new FakeClock();
  const controller = new AbortController();
  const readParts = () => ({
    pill: root.querySelector("span"),
    textarea: root.querySelector("textarea"),
  });
  const output = observeIdeOutput({
    root, readParts, previousPill: readParts().pill, signal: controller.signal,
    isCurrent: () => true, clock: clock.adapter(), MutationObserverImpl: dom.window.MutationObserver,
  });
  const resultPill = dom.window.document.createElement("span");
  resultPill.textContent = "AC";
  readParts().pill.replaceWith(resultPill);
  readParts().textarea.value = "15";
  await flushMicrotasks();
  assert.deepEqual(await output.wait(), {
    kind: "result", verdict: "AC", pillStyle: "", detail: "", output: "15",
  });
  assert.equal(clock.timers.size, 0);
});

test("IDE output waits without polling and cancels its timeout on navigation", async () => {
  const dom = new JSDOM("<main></main>");
  const root = dom.window.document.querySelector("main");
  const clock = new FakeClock();
  const controller = new AbortController();
  let reads = 0;
  const output = observeIdeOutput({
    root, readParts: () => { reads++; return { pill: null }; }, signal: controller.signal,
    isCurrent: () => true, clock: clock.adapter(), MutationObserverImpl: dom.window.MutationObserver,
  });
  const result = output.wait();
  await clock.advance(15000);
  assert.equal(reads, 1);
  controller.abort();
  assert.deepEqual(await result, { kind: "cancelled" });
  assert.equal(clock.timers.size, 0);
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

test("IDE Batch Runner expands CE to remaining groups only while continuing", async () => {
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
  current.resolve({ verdict: "CE", output: "compile log" });
  await run;
  assert.deepEqual(applied, [[0, "CE"]]);
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

test("IDE diff aligns inserted and deleted lines and keeps separate highlights", async () => {
  const { diffIdeLines, normalizeIdeOut } = await import(
    "../src/features/ide-batch/result-view.js"
  );
  const check = (left, right, expected, actual) => {
    assert.deepEqual(diffIdeLines(left, right), { expected: new Set(expected), actual: new Set(actual) });
  };
  check(["a", "b"], ["a", "b"], [], []);
  check(["a", "b"], ["a", "c"], [1], [1]);
  check(["a", "b", "c"], ["a", "c"], [1], []);
  check(["a", "b", "c", "d"], ["a", "extra", "b", "c", "e"], [3], [1, 4]);
  check([], ["a", ""], [], [0, 1]);
  const long = Array.from({ length: 600 }, (_, i) => `line ${i}`);
  check(long, ["extra", ...long.slice(0, -1), "changed"], [599], [0, 600]);

  // 歸一化：CRLF、行尾空白、末尾多餘空行都要抹平 —— 否則整屏標紅。
  assert.equal(normalizeIdeOut("a\r\nb\r\n"), "a\nb");
  assert.equal(normalizeIdeOut("a  \t\nb"), "a\nb");
  assert.equal(normalizeIdeOut("a\n\n\n"), "a");
  assert.equal(normalizeIdeOut(null), "");
  assert.equal(normalizeIdeOut(undefined), "");
});

// ★ 一次性提示的恢復目標必須是**固定文案**。舊寫法拿當時的 `textContent` 當快照，
//   1500ms 內的第二條提示會把第一條提示存成「原文案」，按鈕從此再也變不回「一鍵測試」。
//   「重新測試」按鈕從不禁用（提示只禁用「一鍵測試」那一枚），連點兩下就能重現。
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
  // 第一條還沒到點，第二條就來了。
  assert.equal(hint.show("页面已切换"), true);
  assert.equal(button.textContent, "页面已切换");
  // 只剩最後那一個定時器；先前那個必須已被取消，否則它到點會寫回錯的文案。
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
  // Vue 在提示期間把按鈕重種了一枚 —— 恢復必須落在新節點上。
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
