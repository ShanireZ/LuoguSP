import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  collectDifficultyBatches,
  readLentilleData,
} from "../src/features/problem-color/lentille-harvest.js";

function documentWithContext(body) {
  const json =
    typeof body === "string" ? body : JSON.stringify(body);
  const dom = new JSDOM(
    `<!doctype html><html><body><script id="lentille-context" type="application/json">${json}</script></body></html>`,
  );
  return dom.window.document;
}

const flatten = (batches) =>
  batches.flatMap((batch) => batch.problems());

test("lentille harvest reads the practice payload Luogu ships with the page", () => {
  const doc = documentWithContext({
    template: "user.show",
    data: {
      passed: [
        { type: "P", name: "A+B Problem", difficulty: 1, pid: "P1001" },
        { type: "P", name: "铺地毯", difficulty: 2, pid: "P1003" },
      ],
      submitted: [
        { type: "P", name: "阶乘之和", difficulty: 2, pid: "P1009" },
      ],
      user: { uid: 52918 },
    },
  });

  const batches = collectDifficultyBatches(readLentilleData(doc));

  assert.equal(batches.length, 2);
  assert.deepEqual(flatten(batches).map((p) => [p.pid, p.difficulty]), [
    ["P1001", 1],
    ["P1003", 2],
    ["P1009", 2],
  ]);
});

test("lentille harvest reads the paginated problem-list payload", () => {
  const doc = documentWithContext({
    template: "problem.list",
    data: {
      problems: {
        perPage: 50,
        count: 12345,
        result: [
          { pid: "P1000", type: "P", name: "超级玛丽游戏", difficulty: 1 },
          { pid: "P1002", type: "P", name: "过河卒", difficulty: 3 },
        ],
      },
      filter: {},
    },
  });

  const batches = collectDifficultyBatches(readLentilleData(doc));

  assert.equal(batches.length, 1);
  assert.deepEqual(flatten(batches).map((p) => [p.pid, p.difficulty]), [
    ["P1000", 1],
    ["P1002", 3],
  ]);
});

test("lentille harvest keeps only unambiguous record difficulties", () => {
  const doc = documentWithContext({
    data: {
      records: {
        result: [
          { problem: { pid: "P1001", difficulty: 1 } },
          { problem: { pid: "P5000", difficulty: 6 } },
          { problem: { pid: "P4000" } },
          {},
        ],
      },
    },
  });

  const batches = collectDifficultyBatches(readLentilleData(doc));

  assert.equal(batches.length, 1);
  assert.deepEqual(flatten(batches), [
    { pid: "P1001", difficulty: 1 },
    { pid: "P5000", difficulty: null },
    { pid: "P4000", difficulty: null },
    { pid: undefined, difficulty: null },
  ]);
});

test("lentille harvest returns a stable source so the pipeline can dedupe it", () => {
  const doc = documentWithContext({
    data: { passed: [{ pid: "P1001", difficulty: 1 }] },
  });

  const first = collectDifficultyBatches(readLentilleData(doc));
  const second = collectDifficultyBatches(readLentilleData(doc));

  // harvest() runs once per coloured anchor; re-parsing would both cost a
  // 100KB+ JSON.parse each time and hand the pipeline a fresh array whose
  // WeakSet dedupe can never hit.
  assert.equal(first[0].source, second[0].source);
  assert.notEqual(first[0].problems(), first[0].source);
});

test("lentille harvest does not read difficulties out of an unrelated payload", () => {
  const doc = documentWithContext({
    data: { articles: [{ lid: "abc", title: "P1001 题解" }], user: { uid: 3 } },
  });

  assert.deepEqual(collectDifficultyBatches(readLentilleData(doc)), []);
});

test("lentille harvest tolerates a missing, empty or malformed context", () => {
  const missing = new JSDOM("<!doctype html><html><body></body></html>");
  assert.equal(readLentilleData(missing.window.document), null);
  assert.deepEqual(collectDifficultyBatches(null), []);

  assert.equal(readLentilleData(documentWithContext("{not json")), null);
  assert.equal(readLentilleData(documentWithContext("null")), null);
  assert.deepEqual(
    collectDifficultyBatches(
      readLentilleData(documentWithContext({ data: { passed: [] } })),
    ),
    [],
  );
});

test("lentille harvest re-parses when the document itself is replaced", () => {
  const first = documentWithContext({
    data: { passed: [{ pid: "P1001", difficulty: 1 }] },
  });
  const second = documentWithContext({
    data: { passed: [{ pid: "P2001", difficulty: 4 }] },
  });

  assert.deepEqual(
    flatten(collectDifficultyBatches(readLentilleData(first))).map(
      (p) => p.pid,
    ),
    ["P1001"],
  );
  assert.deepEqual(
    flatten(collectDifficultyBatches(readLentilleData(second))).map(
      (p) => p.pid,
    ),
    ["P2001"],
  );
});
