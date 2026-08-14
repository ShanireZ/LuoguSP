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

// 用户卡的两个载荷：主=/api/user/info/{uid}，补=/user/{uid}。
const userCard = (over = {}) =>
  buildUserCard(
    {
      user: {
        uid: 697932,
        name: "Gcend",
        color: "Red",
        avatar: "https://cdn.luogu.com.cn/upload/usericon/697932.png",
        background: over.background ?? null,
        blogAddress: over.blogAddress ?? null,
        slogan: over.slogan ?? "",
        badge: over.badge ?? null,
        ccfLevel: over.ccfLevel ?? null,
        xcpcLevel: over.xcpcLevel ?? null,
        ranking: over.ranking ?? 560,
        followingCount: over.following ?? null,
        followerCount: over.follower ?? null,
        registerTime: over.registerTime ?? null,
        userRelationship: over.rel,
        reverseUserRelationship: over.rev,
        elo: over.elo ?? null,
        eloValue: over.elo ? over.elo.rating : null,
      },
    },
    over.noPage
      ? null
      : {
          data: {
            prizes: over.prizes ?? [],
            gu: over.gu ?? null,
            elo: [],
            user: {
              uid: 697932,
              passedProblemCount: over.passed ?? null,
              submittedProblemCount: over.submitted ?? null,
            },
          },
        },
  );

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

// ---- 用户卡：统计排 ----
// ★ owner 三轮下来的口径：去掉排名与「尝试」；通过题数叫「通过 / 提交」；
//   并且咕值与「通过 / 提交」从下面的扩展行**挪进统计排**，依次尾随在等级分后面。
test("统计排依次是 关注·粉丝·等级分·咕值·通过/提交", () => {
  const host = mount(() =>
    renderUserCard(
      userCard({
        following: 54,
        follower: 102,
        elo: { rating: 1478, time: 1770888600, latest: true },
        gu: { rating: 307 },
        passed: 612,
        submitted: 710,
        ranking: 560,
      }),
      { origin: "" },
    ),
  );
  const tiles = [...host.querySelectorAll(".luogusp-hc-stat")].map((n) => [
    n.querySelector(".luogusp-hc-stat-k").textContent,
    n.querySelector(".luogusp-hc-stat-v").textContent,
  ]);
  assert.deepEqual(tiles, [
    ["关注", "54"],
    ["粉丝", "102"],
    ["等级分", "1478"],
    ["咕值", "307"],
    ["通过 / 提交", "612 / 710"],
  ]);
  // 反证：这两样不许再以 key-value 行的形式留在下面。
  const keys = [...host.querySelectorAll(".luogusp-hc-key")].map((n) => n.textContent);
  assert.equal(keys.includes("通过 / 提交"), false);
  assert.equal(keys.includes("咕值"), false);
  assert.equal(keys.includes("排名"), false, "排名要移除");
  assert.doesNotMatch(host.textContent, /尝试/, "「尝试」两个字要移除");
});

// ★ owner：隐藏了个人信息的账号拿不到这些字段，没数据的行不画。
test("拿不到的数据不画那一行，绝不用 0 顶替", () => {
  const bare = mount(() => renderUserCard(userCard({}), { origin: "" }));
  const keys = () => [...bare.querySelectorAll(".luogusp-hc-key")].map((n) => n.textContent);
  for (const gone of ["通过 / 提交", "咕值", "比赛 Elo", "获奖", "关注 / 粉丝", "关系", "注册于"])
    // 这些键一个都不该出现：有的是移除了，有的是没数据。
    assert.equal(keys().includes(gone), false, gone);
  // 反证：不能因为「没数据」就写成 0 或「未关注」。
  assert.doesNotMatch(bare.textContent, /0/);
  assert.doesNotMatch(bare.textContent, /未关注/);

  // 只有一半数据时该行仍要画，缺的那半写 `?`。
  const half = mount(() => renderUserCard(userCard({ submitted: 1234 }), { origin: "" }));
  assert.match(half.textContent, /\? \/ 1\.2k/);
});

// ★ owner 2026-08-14 第三轮：「关系」整行移除 —— 关注按钮已经把关系说清楚了
//   （关注 / 已关注 / 互相关注 / 已拉黑），再写一行是重复。「注册于」同样移除。
test("关系与注册于都不再单列一行", () => {
  for (const over of [{ rel: 1, rev: 1 }, { rel: 0, rev: 0 }, {}]) {
    const host = mount(() =>
      renderUserCard(userCard({ ...over, registerTime: 1647344053 }), {
        origin: "",
        onFollow: () => {},
        onBlock: () => {},
        viewerUid: 1,
      }),
    );
    const keys = [...host.querySelectorAll(".luogusp-hc-key")].map((n) => n.textContent);
    assert.equal(keys.includes("关系"), false, JSON.stringify(over));
    assert.equal(keys.includes("注册于"), false, JSON.stringify(over));
  }
  // 关系仍然由按钮表达 —— 互相关注时按钮就该这么写。
  const mutual = mount(() =>
    renderUserCard(userCard({ rel: 1, rev: 1 }), {
      origin: "",
      onFollow: () => {},
      onBlock: () => {},
      viewerUid: 1,
    }),
  );
  assert.equal(mutual.querySelector("button.luogusp-hc-btn").textContent, "互相关注");
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

// ---- 用户卡：原生骨架的复刻（owner 2026-08-14「复刻 + 扩展」）----
// ★ 背景图抄自 UserFloatCard 组件原文：`user.background || <那张固定图>`。
test("页头有背景图，用户没设就用洛谷自己的兜底图", () => {
  const mine = mount(() =>
    renderUserCard(userCard({ background: "https://cdn.luogu.com.cn/upload/image_hosting/x.png" }), {
      origin: "",
    }),
  );
  const head = mine.querySelector(".luogusp-hc-userhead");
  assert.ok(head, "页头必须存在 —— owner 报的「缺背景」就是它");
  assert.match(head.style.backgroundImage, /image_hosting\/x\.png/);
  const bare = mount(() => renderUserCard(userCard({}), { origin: "" }));
  assert.match(
    bare.querySelector(".luogusp-hc-userhead").style.backgroundImage,
    /DSCF0530-shrink\.jpg/,
    "兜底图要和洛谷用的是同一张",
  );
  // 头像压在页头里（原生就是 user-header-top > img.avatar），不再是原来那种并排小图。
  assert.ok(
    bare.querySelector(".luogusp-hc-userhead .luogusp-hc-avatar"),
    "头像必须在页头内，否则背景图会被它挤开",
  );
});

// ★ owner：举报、屏蔽要**直接摆在按钮行右侧**，不折叠进「更多」。
test("举报是链接、屏蔽是按钮，都摊在操作行里", () => {
  const host = mount(() =>
    renderUserCard(userCard({ rel: 0, rev: 0 }), {
      origin: "https://www.luogu.com.cn",
      onFollow: () => {},
      onBlock: () => {},
      viewerUid: 1,
    }),
  );
  const actions = host.querySelector(".luogusp-hc-actions");
  // ★ owner 第三轮：举报与屏蔽不再靠右，紧跟私信 —— 中间那个撑开的空隙要没有。
  assert.equal(actions.querySelector(".luogusp-hc-spacer"), null);
  const labels = [...actions.children].map((n) => n.textContent).filter(Boolean);
  assert.deepEqual(labels, ["关注", "私信", "举报", "屏蔽"]);
  const report = [...actions.querySelectorAll("a")].find((a) => a.textContent === "举报");
  // 原生就是一个到工单页的链接（路由 ticket.create → /ticket/new），不发任何请求。
  assert.equal(
    report.getAttribute("href"),
    "https://www.luogu.com.cn/ticket/new?type=report.user&related=697932",
  );
  const chat = [...actions.querySelectorAll("a")].find((a) => a.textContent === "私信");
  assert.equal(chat.getAttribute("href"), "https://www.luogu.com.cn/chat?uid=697932");
});

// ★ 原生的两条硬规则：看自己时整个操作区不画；正在关注的人不能拉黑。
test("看自己不画操作区，关注中的人不给屏蔽按钮", () => {
  const self = mount(() =>
    renderUserCard(userCard({ rel: 0 }), {
      origin: "",
      onFollow: () => {},
      onBlock: () => {},
      viewerUid: 697932,
    }),
  );
  assert.equal(self.querySelector(".luogusp-hc-actions"), null);

  const following = mount(() =>
    renderUserCard(userCard({ rel: 1 }), {
      origin: "",
      onFollow: () => {},
      onBlock: () => {},
      viewerUid: 1,
    }),
  );
  const labels = [...following.querySelector(".luogusp-hc-actions").children]
    .map((n) => n.textContent)
    .filter(Boolean);
  assert.equal(labels.includes("屏蔽"), false, "洛谷自己就拒绝拉黑正在关注的人");
});

// 已拉黑：关注按钮写「已拉黑」且禁用（原生就是这么画的）。
test("已拉黑时关注按钮禁用并写「已拉黑」", () => {
  const host = mount(() =>
    renderUserCard(userCard({ rel: 2, rev: 0 }), {
      origin: "",
      onFollow: () => {},
      onBlock: () => {},
      viewerUid: 1,
    }),
  );
  const follow = host.querySelector("button.luogusp-hc-btn");
  assert.equal(follow.textContent, "已拉黑");
  assert.equal(follow.disabled, true);
  const labels = [...host.querySelector(".luogusp-hc-actions").children].map((n) => n.textContent);
  assert.ok(labels.includes("取消屏蔽"));
});

// ★★ owner 2026-08-14：XCPC 类奖项的名字过长。根因是我上一轮把 `event` 也拼了上去 ——
//    `contest` 本身已经是简称（"ICPC Regional" / "CCPC 分站赛"），洛谷个人页也只显示它。
test("获奖只用简称，不拼那段又臭又长的 event", () => {
  const host = mount(() =>
    renderUserCard(
      userCard({
        prizes: [
          {
            prize: {
              year: 2025,
              contest: "ICPC Regional",
              event: "被认为是第 50 届 ICPC 国际大学生程序设计竞赛亚洲区域赛上海站",
              prize: "铜牌",
            },
          },
          { prize: { year: 2024, contest: "NOIP", event: null, prize: "一等奖" } },
          { prize: { year: 2023, contest: "CSP-S", event: null, prize: "一等奖" } },
          { prize: { year: 2021, contest: "CSP-S", event: null, prize: "二等奖" } },
        ],
      }),
      { origin: "" },
    ),
  );
  const lines = [...host.querySelectorAll(".luogusp-hc-stack span")].map((n) => n.textContent);
  // 最近 3 条，年份降序，一条都不带 event。
  assert.deepEqual(lines, ["2025 ICPC Regional 铜牌", "2024 NOIP 一等奖", "2023 CSP-S 一等奖"]);
  assert.doesNotMatch(host.textContent, /国际大学生程序设计竞赛/);
});

// ★ owner 第三轮：用户名那一行**最右侧**显示 uid。挂在用户名行而不是签名行 ——
//   签名会被截成两行，右边缘不稳定。
test("用户名行最右侧显示 uid", () => {
  const host = mount(() => renderUserCard(userCard({ ccfLevel: 7 }), { origin: "" }));
  const title = host.querySelector(".luogusp-hc-utitle");
  assert.ok(title, "用户名行要用两端对齐的容器");
  const uid = title.querySelector(".luogusp-hc-uid");
  assert.equal(uid.textContent, "uid : 697932");
  // uid 必须是这一行的**最后**一个子元素，名字与徽章都在它前面。
  assert.equal(title.lastElementChild, uid);
  assert.ok(title.querySelector(".luogusp-hc-identity .luogusp-hc-name"));
  assert.ok(title.querySelector(".luogusp-hc-identity svg.luogusp-hc-fa"));
});
