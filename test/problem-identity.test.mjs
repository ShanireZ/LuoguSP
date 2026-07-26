import test from "node:test";
import assert from "node:assert/strict";
import {
  createProblemIdentityResolver,
} from "../src/features/problem-color/identity.js";

const resolver = createProblemIdentityResolver({
  getOrigin: () => "https://www.luogu.com.cn",
  voidAnchorSelector: ".void-problem",
  standalonePidSelector: ".pid[title]",
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

function standalonePid(
  pid,
  href = `https://www.luogu.com.cn/problem/${pid}`,
) {
  const problemLink = anchor(href, "题目名称");
  const row = {
    querySelectorAll: (selector) =>
      selector === "a[href]" ? [problemLink] : [],
  };
  const target = {
    title: pid,
    innerText: pid,
    textContent: pid,
    parentElement: row,
    getAttribute: (name) => (name === "title" ? target.title : null),
    matches: (selector) => selector === ".pid[title]",
  };
  return { target, problemLink };
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

test("Problem Identity recognizes a standalone pid with a matching row link", () => {
  assert.deepEqual(resolver.resolve(standalonePid("P1001").target), {
    pid: "P1001",
    kind: "standalone",
    key: "standalone:https://www.luogu.com.cn/problem/P1001",
  });
});

test("Problem Identity rejects unverified standalone pid elements", () => {
  assert.equal(
    resolver.resolve(
      standalonePid(
        "P1001",
        "https://www.luogu.com.cn/problem/P1002",
      ).target,
    ),
    null,
  );
  assert.equal(
    resolver.resolve(
      standalonePid("P1001", "https://evil.example/problem/P1001").target,
    ),
    null,
  );
  const { target } = standalonePid("P1001");
  target.parentElement = null;
  assert.equal(resolver.resolve(target), null);
});

test("Problem Identity changes when a virtual standalone row is reused", () => {
  const { target, problemLink } = standalonePid("P1001");
  const before = resolver.resolve(target);
  target.title = "P1002";
  target.innerText = target.textContent = "P1002";
  problemLink.href = "https://www.luogu.com.cn/problem/P1002";
  const after = resolver.resolve(target);

  assert.equal(before.pid, "P1001");
  assert.equal(after.pid, "P1002");
  assert.notEqual(before.key, after.key);
});
