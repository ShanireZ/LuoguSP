"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createProblemIdentityResolver,
} = require("../LuoguSP.user.js");

const resolver = createProblemIdentityResolver({
  getOrigin: () => "https://www.luogu.com.cn",
  voidAnchorSelector: ".void-problem",
});

function anchor(href, text, { isVoid = false, first = null } = {}) {
  return {
    href,
    innerText: text,
    textContent: text,
    firstElementChild: first,
    matches: (selector) => selector === ".void-problem" && isVoid,
  };
}

test("Problem Identity recognizes normal, AT, forum and void links", () => {
  assert.deepEqual(
    resolver.resolve(
      anchor("https://www.luogu.com.cn/problem/P1000", "P1000 A+B"),
    ),
    {
      pid: "P1000",
      kind: "problem",
      key: "problem:https://www.luogu.com.cn/problem/P1000",
    },
  );
  assert.equal(
    resolver.resolve(
      anchor("https://www.luogu.com.cn/problem/AT_abc100_a", "AT_abc100_a"),
    ).pid,
    "AT_abc100_a",
  );
  assert.equal(
    resolver.resolve(
      anchor(
        "https://www.luogu.com.cn/discuss?forum=P1000",
        "P1000 讨论",
      ),
    ).kind,
    "forum",
  );
  assert.deepEqual(
    resolver.resolve(anchor("javascript:void 0", "P2000 标题", { isVoid: true })),
    { pid: "P2000", kind: "void", key: "void:P2000" },
  );
});

test("Problem Identity rejects prefix collisions, nested paths and external origins", () => {
  assert.equal(
    resolver.resolve(
      anchor("https://www.luogu.com.cn/problem/P10", "P100 title"),
    ),
    null,
  );
  assert.equal(
    resolver.resolve(
      anchor(
        "https://www.luogu.com.cn/problem/P10/solution",
        "P10 title",
      ),
    ),
    null,
  );
  assert.equal(
    resolver.resolve(anchor("https://evil.example/problem/P10", "P10 title")),
    null,
  );
});

test("Problem Identity changes when a virtual anchor is reused", () => {
  const reused = anchor(
    "https://www.luogu.com.cn/problem/P10",
    "P10 title",
  );
  const before = resolver.resolve(reused);
  reused.href = "https://www.luogu.com.cn/problem/P100";
  reused.innerText = reused.textContent = "P100 title";
  const after = resolver.resolve(reused);

  assert.equal(before.pid, "P10");
  assert.equal(after.pid, "P100");
  assert.notEqual(before.key, after.key);
});

test("Problem Identity accepts an exact first span.pid", () => {
  const first = {
    innerText: "P3000",
    textContent: "P3000",
    matches: (selector) => selector === "span.pid",
  };
  assert.equal(
    resolver.resolve(
      anchor("https://www.luogu.com.cn/problem/P3000", "other text", {
        first,
      }),
    ).pid,
    "P3000",
  );
});
