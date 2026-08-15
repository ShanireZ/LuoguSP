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

// ★★ 2026-08-15 实测复现的一类真缺陷：pid 的两个来源（void 锚点的**可见文本**、
//    `?forum=` 的**取值**）都是页面内容，讨论区更是用户生成内容；而 pipeline.js 会把
//    解析出来的 pid 拼进 `/problem/${pid}`。旧的 `isProblemId` 只要求「含字母且含数字」，
//    于是这两串都能过关：
//      `P1000#zzz`               → 井号截断，实际请求 `/problem/P1000`（query 一并被吃），
//                                  **把别的题的难度染到这个锚点上**；
//      `a1/../../api/user/search` → 实际请求 `https://www.luogu.com.cn/api/user/search`。
//    守卫钉住字符集这一条，别再放松成「含字母且含数字」。
test("Problem Identity rejects page-controlled ids outside the pid charset", () => {
  const voidAnchor = (text) => ({
    href: "",
    innerText: text,
    textContent: text,
    firstElementChild: null,
    matches: (selector) => selector === ".void-problem",
  });
  for (const hostile of [
    "P1000#zzz",
    "a1/../../api/user/search",
    "P1000?x=1",
    "P1000%2e%2e",
  ])
    assert.equal(
      resolver.resolve(voidAnchor(`${hostile} 某题`)),
      null,
      `void 锚点不该接受 ${hostile}`,
    );

  const forumAnchor = (forum, text) => ({
    href: `https://www.luogu.com.cn/discuss/lists?forum=${encodeURIComponent(forum)}`,
    innerText: text,
    textContent: text,
    firstElementChild: null,
    matches: () => false,
  });
  const hostileForum = "a1/../../api/user/search";
  assert.equal(
    resolver.resolve(forumAnchor(hostileForum, `${hostileForum} 版块`)),
    null,
  );

  // 合法 pid 一个都不许被这道守卫误伤 —— 下划线那条正是 owner 第五轮报过的回归。
  const legit = resolver.resolve(voidAnchor("AT_abc397_a 某题"));
  assert.equal(legit.pid, "AT_abc397_a");
  assert.equal(resolver.resolve(voidAnchor("P1000 某题")).pid, "P1000");
});

test("PID_PATTERN has exactly one definition, re-exported to the hover card", async () => {
  const identity = await import("../src/features/problem-color/identity.js");
  const anchors = await import("../src/features/hover-card/anchors.js");
  assert.equal(anchors.PID_PATTERN, identity.PID_PATTERN);
});
