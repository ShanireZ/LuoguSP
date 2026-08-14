import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderProblemCard, renderUserCard } from "../src/features/hover-card/card-view.js";
import { buildProblemCard, buildUserCard } from "../src/features/hover-card/models.js";

// 卡片渲染。★ 这一组全是 owner 2026-08-14 逐条提的口径，每条都配一句**反证**：
// 只断言「新的在」不够，还要断言「旧的不在」—— 否则退回旧写法测试照绿。
//
// 用 jsdom 而不是替身：卡片用 createElementNS 画 SVG、用 [hidden] 折叠标签，
// 这些只有真 DOM 实现才验得出来。

function withDom(run) {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://www.luogu.com.cn/",
  });
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
  };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    return run(dom);
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
}

const mount = (fragment) =>
  withDom(() => {
    const host = document.createElement("div");
    host.appendChild(fragment());
    return host;
  });

const problemCard = (over = {}) =>
  buildProblemCard({
    payload: {
      data: {
        problem: {
          pid: "P2911",
          name: "[USACO08OCT] Bovine Bones G",
          difficulty: 1,
          tags: [],
          totalSubmit: 181000,
          totalAccepted: 90000,
          limits: { time: [1000], memory: [128000] },
          ...over,
        },
      },
    },
    tagDictionary: { resolve: () => ["模拟"] },
  });

const userCard = (over = {}) =>
  buildUserCard({
    data: {
      prizes: over.prizes ?? [],
      gu: over.gu ?? null,
      elo: over.elo ?? [],
      user: {
        uid: 697932,
        name: "Gcend",
        color: "Red",
        slogan: over.slogan ?? "",
        badge: over.badge ?? null,
        ccfLevel: over.ccfLevel ?? null,
        xcpcLevel: over.xcpcLevel ?? null,
        passedProblemCount: over.passed ?? null,
        submittedProblemCount: over.submitted ?? null,
        ranking: over.ranking ?? 560,
        followingCount: over.following ?? null,
        followerCount: over.follower ?? null,
        registerTime: over.registerTime ?? null,
        userRelationship: over.rel,
        reverseUserRelationship: over.rev,
      },
    },
  });

// ---- 题目卡 ----
// ★ owner：难度用**题号的颜色**表达，不再单占一行文字。
test("题号按难度着色，难度不再单独占一行", () => {
  const host = mount(() => renderProblemCard(problemCard(), { origin: "" }));
  const pid = host.querySelector(".luogusp-hc-title span");
  assert.equal(pid.textContent, "P2911");
  assert.equal(pid.style.color, "rgb(254, 76, 97)", "入门是 #fe4c61");
  assert.match(host.querySelector(".luogusp-hc-title").textContent, /^P2911 \[USACO08OCT]/);
  // 反证：难度名一个字都不该出现在卡片里。
  assert.doesNotMatch(host.textContent, /入门/, "难度名不该再单独显示");
});

// ---- 用户卡：徽章 ----
// ★ owner：徽章和气球要画成图标，上一版渲染的是 "CCF 7" / "XCPC 3" 这样的文字。
test("徽章画成 duotone SVG，不再是 CCF / XCPC 文字", () => {
  const host = mount(() => renderUserCard(userCard({ ccfLevel: 7, xcpcLevel: 8 }), { origin: "" }));
  const icons = [...host.querySelectorAll("svg.luogusp-hc-fa")];
  assert.equal(icons.length, 2, "CCF 与 XCPC 各一枚");
  assert.equal(icons[0].getAttribute("viewBox"), "0 0 512 512", "✅ 是 512 见方");
  assert.equal(icons[1].getAttribute("viewBox"), "0 0 384 512", "🎈 是 384x512");
  for (const icon of icons)
    assert.equal(icon.querySelectorAll("path").length, 2, "duotone 是两段 path");
  // ✅：盾面取等级色、钩子恒白；🎈 正好相反。
  const ccf = icons[0].querySelectorAll("path");
  assert.equal(ccf[0].getAttribute("fill"), "#3498db");
  assert.equal(ccf[1].getAttribute("fill"), "#fff");
  const balloon = icons[1].querySelectorAll("path");
  assert.equal(balloon[0].getAttribute("fill"), "#fff");
  assert.equal(balloon[1].getAttribute("fill"), "#ffc116", "8 级是 gold-3");
  // 反证：旧的文字徽章不许再出现。
  assert.doesNotMatch(host.textContent, /CCF\s*\d|XCPC\s*\d/);
});

// ★ 组件原文：level < 3 一个图标都不画。旧口径是「> 0 就画」。
test("等级低于 3 不画徽章", () => {
  const host = mount(() => renderUserCard(userCard({ ccfLevel: 2, xcpcLevel: 1 }), { origin: "" }));
  assert.equal(host.querySelectorAll("svg.luogusp-hc-fa").length, 0);
});

// ---- 用户卡：行的取舍 ----
// ★ owner 的三条：去掉排名、去掉「尝试」、通过题数改叫「通过 / 提交」。
test("通过 / 提交合成一行，排名与「尝试」都不再出现", () => {
  const host = mount(() =>
    renderUserCard(userCard({ passed: 612, submitted: 710, ranking: 560 }), { origin: "" }),
  );
  const keys = [...host.querySelectorAll(".luogusp-hc-key")].map((n) => n.textContent);
  assert.ok(keys.includes("通过 / 提交"));
  assert.equal(keys.includes("排名"), false, "排名要移除");
  assert.doesNotMatch(host.textContent, /尝试/, "「尝试」两个字要移除");
  assert.match(host.textContent, /612 \/ 710/);
});

// ★ owner：隐藏了个人信息的账号拿不到这些字段，没数据的行不画。
test("拿不到的数据不画那一行，绝不用 0 顶替", () => {
  const bare = mount(() => renderUserCard(userCard({}), { origin: "" }));
  const keys = () => [...bare.querySelectorAll(".luogusp-hc-key")].map((n) => n.textContent);
  for (const gone of ["通过 / 提交", "咕值", "比赛 Elo", "获奖", "关注 / 粉丝", "关系", "注册于"])
    assert.equal(keys().includes(gone), false, gone);
  // 反证：不能因为「没数据」就写成 0 或「未关注」。
  assert.doesNotMatch(bare.textContent, /0/);
  assert.doesNotMatch(bare.textContent, /未关注/);

  // 只有一半数据时该行仍要画，缺的那半写 `?`。
  const half = mount(() => renderUserCard(userCard({ submitted: 1234 }), { origin: "" }));
  assert.match(half.textContent, /\? \/ 1\.2k/);
});

// ★★ 关系那一行以前恒画、两边未知时写「未关注」—— 匿名访客拿到的就是这种，
//    等于在不知情的情况下断言「他没关注」。
test("关系两边都未知就不画，不伪造成「未关注」", () => {
  const anonymous = mount(() => renderUserCard(userCard({ follower: 10 }), { origin: "" }));
  assert.doesNotMatch(anonymous.textContent, /关系/);
  const known = mount(() => renderUserCard(userCard({ rel: 1, rev: 1 }), { origin: "" }));
  assert.match(known.textContent, /互相关注/);
  // 一边知道一边不知道，只说确定的那一半。
  const partial = mount(() => renderUserCard(userCard({ rel: 0 }), { origin: "" }));
  assert.match(partial.textContent, /我未关注/);
});

// ★ owner 追问两次的那条：以前只画 prizes[0]，而洛谷发的是**年份升序**，
//   于是永远只显示最早那个奖。
test("获奖把拿到的都画出来，最近的排在最前", () => {
  const host = mount(() =>
    renderUserCard(
      userCard({
        prizes: [
          { prize: { year: 2024, contest: "CSP-J", prize: "一等奖" } },
          { prize: { year: 2025, contest: "CSP-S", prize: "一等奖" } },
        ],
      }),
      { origin: "" },
    ),
  );
  const lines = [...host.querySelectorAll(".luogusp-hc-stack span")].map((n) => n.textContent);
  assert.deepEqual(lines, ["2025 CSP-S 一等奖", "2024 CSP-J 一等奖"]);
});

// ★ owner：签名可能很长。截断交给 CSS，不在 JS 里切字符串（会劈开 emoji）。
test("长签名交给 CSS 截断，文本本身一个字不少", () => {
  const slogan = "很长的签名".repeat(40);
  const host = mount(() => renderUserCard(userCard({ slogan }), { origin: "" }));
  const node = host.querySelector(".luogusp-hc-clamp");
  assert.ok(node, "长签名要挂上截断类");
  assert.equal(node.textContent, slogan, "不许在 JS 里截字符串");
});
