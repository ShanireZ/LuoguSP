import test from "node:test";
import assert from "node:assert/strict";
import { difficultyColor, difficultyName } from "../src/features/hover-card/difficulty.js";
import { createHoverIntent } from "../src/features/hover-card/hover-intent.js";
import {
  acceptanceRate,
  buildProblemCard,
  buildTagDictionary,
  buildUserCard,
  pickLastAttempt,
  relationOf,
} from "../src/features/hover-card/models.js";
import {
  buildFollowRequest,
  createFollowAction,
  planFollowToggle,
} from "../src/features/hover-card/follow-action.js";
import {
  createHoverCardSources,
  parseLegacyInjection,
} from "../src/features/hover-card/sources.js";

function manualClock(start = 1_800_000_000_000) {
  let ms = start;
  const timers = new Map();
  let seq = 0;
  return {
    now: () => ms,
    setTimeout: (fn, delay) => {
      const id = ++seq;
      timers.set(id, { fn, at: ms + Number(delay || 0) });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id),
    advance: (delta) => {
      ms += delta;
      for (const [id, timer] of [...timers])
        if (timer.at <= ms) {
          timers.delete(id);
          timer.fn();
        }
    },
    pending: () => timers.size,
  };
}

// ---- 难度档位 ----
// ★ 这张表是从洛谷自己的练习页实测配对出来的（0–8 共 9 档，一档一组）。
// 两个逐码位核对过的细节：减号是 U+2212，第 8 档没有尾部的 C。
test("难度档位名与颜色对齐官方 9 档", () => {
  assert.equal(difficultyName(0), "暂无评定");
  assert.equal(difficultyName(2), "普及−");
  assert.equal(difficultyName(4), "普及+/提高−");
  assert.equal(difficultyName(8), "NOI/NOI+/CTS");
  assert.equal(difficultyName(2).includes("-"), false, "减号必须是 U+2212，不是 ASCII 连字符");
  assert.equal(difficultyName(8).endsWith("CTSC"), false, "第 8 档没有尾部的 C");
  assert.equal(difficultyColor(4), "#52c41a");
  // 越界与非法一律落到「暂无评定」，不显示 undefined。
  for (const bad of [-1, 9, null, undefined, "4", 1.5])
    assert.equal(difficultyName(bad), "暂无评定", String(bad));
});

// ---- 悬停意图 ----
test("停留够久才打开，鼠标只是路过不打开", () => {
  const clock = manualClock();
  const opened = [];
  const intent = createHoverIntent({
    clock,
    openDelayMs: 300,
    onOpen: (t) => opened.push(t),
  });
  intent.enter("P1000");
  clock.advance(200);
  intent.leave();
  clock.advance(500);
  assert.deepEqual(opened, [], "300ms 没停满就不该发请求");
  intent.enter("P1001");
  clock.advance(300);
  assert.deepEqual(opened, ["P1001"]);
});

// ★ 没有宽限期，鼠标从锚点移到卡片上的途中卡片就被收走，卡上的关注按钮永远点不到。
test("离开后有宽限期，指针移到卡片上不会被收走", () => {
  const clock = manualClock();
  const closed = [];
  const intent = createHoverIntent({
    clock,
    openDelayMs: 300,
    closeGraceMs: 160,
    onClose: (t) => closed.push(t),
  });
  intent.enter("P1000");
  clock.advance(300);
  intent.leave();
  clock.advance(100);
  intent.enter("P1000"); // 指针落到卡片上
  clock.advance(1000);
  assert.deepEqual(closed, [], "宽限期内回来就不该关");
  intent.leave();
  clock.advance(160);
  assert.deepEqual(closed, ["P1000"]);
});

test("切换目标时同时只有一张卡", () => {
  const clock = manualClock();
  const events = [];
  const intent = createHoverIntent({
    clock,
    openDelayMs: 100,
    onOpen: (t) => events.push(`open:${t}`),
    onClose: (t) => events.push(`close:${t}`),
  });
  intent.enter("P1000");
  clock.advance(100);
  intent.enter("P1001");
  clock.advance(100);
  assert.deepEqual(events, ["open:P1000", "close:P1000", "open:P1001"]);
});

test("dismiss 立即关闭并清掉待打开的定时器", () => {
  const clock = manualClock();
  const events = [];
  const intent = createHoverIntent({
    clock,
    openDelayMs: 100,
    onOpen: (t) => events.push(`open:${t}`),
    onClose: (t) => events.push(`close:${t}`),
  });
  intent.enter("P1000");
  clock.advance(100);
  intent.enter("P1001");
  intent.dismiss();
  clock.advance(1000);
  assert.deepEqual(events, ["open:P1000", "close:P1000"]);
  assert.equal(clock.pending(), 0);
  assert.equal(intent.getState().open, false);
});

// ---- 视图模型 ----
test("通过率：分母为 0 是「还没人交过」，不是 0%", () => {
  assert.equal(acceptanceRate(259644, 636915), 40.8);
  assert.equal(acceptanceRate(0, 0), null);
  assert.equal(acceptanceRate(5, 0), null);
  assert.equal(acceptanceRate(null, 100), null);
});

test("标签字典把数字 id 翻成名字，认不出的丢掉", () => {
  const dict = buildTagDictionary({
    version: 1786584279,
    tags: [
      { id: 42, name: "线段树", type: 2 },
      { id: 523, name: "树状数组", type: 2 },
      { id: 7, name: "", type: 2 },
    ],
  });
  assert.deepEqual(dict.resolve([42, 523]), ["线段树", "树状数组"]);
  assert.deepEqual(dict.resolve([42, 999999, 7]), ["线段树"], "认不出的 id 不该显示成「标签 999999」");
  assert.equal(dict.version, 1786584279);
  assert.equal(buildTagDictionary(null), null);
  assert.equal(buildTagDictionary({ tags: [] }), null);
});

const problemPayload = {
  data: {
    bookmarked: false,
    problem: {
      pid: "P3372",
      name: "【模板】线段树 1",
      difficulty: 4,
      tags: [42, 523],
      totalSubmit: 636915,
      totalAccepted: 259644,
      submitted: true,
      accepted: true,
      score: 100,
      bestRecord: { id: 179363526, score: 100, status: 12 },
      limits: { time: [1000, 1000], memory: [131072] },
    },
  },
};

test("题目卡视图模型", () => {
  const dict = buildTagDictionary({ tags: [{ id: 42, name: "线段树" }, { id: 523, name: "树状数组" }] });
  const card = buildProblemCard({ payload: problemPayload, tagDictionary: dict });
  assert.equal(card.kind, "problem");
  assert.equal(card.pid, "P3372");
  assert.equal(card.difficultyName, "普及+/提高−");
  assert.equal(card.acceptanceRate, 40.8);
  assert.deepEqual(card.tags, ["线段树", "树状数组"]);
  assert.equal(card.timeLimitMs, 1000);
  assert.equal(card.mine.accepted, true);
  assert.equal(card.mine.bestRecordId, 179363526);
  assert.equal(card.mine.bookmarked, false);
  assert.equal(buildProblemCard({ payload: { data: {} } }), null);
  assert.equal(buildProblemCard(null), null);
});

// ★ 反证过的语义：这两个布尔是真的按访问者算的（P3372/P1001=false、B3836=true）。
// 缺失时必须是 null（未知），不能伪造成 false（未通过）。
test("我的状态缺失时是未知，不是「没通过」", () => {
  const card = buildProblemCard({
    payload: { data: { problem: { pid: "P1", difficulty: 1 } } },
  });
  assert.equal(card.mine.accepted, null);
  assert.equal(card.mine.submitted, null);
  assert.equal(card.mine.bookmarked, null);
  assert.deepEqual(card.tags, []);
});

test("上次尝试取最近一次提交", () => {
  const hit = pickLastAttempt({
    result: [
      { id: 1, submitTime: 1700000000, score: 40, status: 6, time: 12, memory: 300 },
      { id: 2, submitTime: 1727831949, score: 100, status: 12, time: 73, memory: 680 },
    ],
  });
  assert.equal(hit.id, 2);
  assert.equal(hit.at, 1727831949);
  assert.equal(hit.score, 100);
  assert.equal(hit.durationMs, 73);
  assert.equal(hit.memoryKb, 680);
  assert.equal(pickLastAttempt({ result: [] }), null);
  assert.equal(pickLastAttempt(null), null);
  // 没有 submitTime 的行不算 —— 拿不到时间就没法说「上次」是哪次。
  assert.equal(pickLastAttempt([{ id: 3, score: 100 }]), null);
});

const userPayload = {
  data: {
    prizes: [{ prize: { year: 2024, contest: "CSP-J", prize: "一等奖" } }],
    gu: { rating: 307, scores: { social: 19, basic: 100 } },
    elo: [
      { rating: 1400, time: 1, latest: false },
      { rating: 1478, time: 1770888600, latest: true },
    ],
    user: {
      uid: 697932,
      name: "Gcend",
      color: "Red",
      ccfLevel: 7,
      xcpcLevel: 0,
      passedProblemCount: 611,
      submittedProblemCount: 700,
      ranking: 560,
      followingCount: 86,
      followerCount: 176,
      registerTime: 1710633701,
      userRelationship: 0,
      reverseUserRelationship: 1,
      elo: null,
      eloValue: null,
    },
  },
};

test("用户卡视图模型", () => {
  const card = buildUserCard(userPayload);
  assert.equal(card.uid, 697932);
  assert.equal(card.passedCount, 611);
  assert.equal(card.ranking, 560);
  assert.equal(card.guRating, 307);
  assert.equal(card.prizes.length, 1);
  assert.equal(card.relation, "unrelated");
  assert.equal(card.reverseRelation, "following", "reverse=1 就是「他关注了我」");
  assert.equal(buildUserCard({ data: { user: {} } }), null);
});

// ★ user.elo / user.eloValue 恒为 null，真数据在顶层 data.elo。抄错地方就永远显示不出 Elo。
test("Elo 取顶层 data.elo 的最新一场，不是 user.elo", () => {
  const card = buildUserCard(userPayload);
  assert.equal(card.eloRating, 1478);
  assert.equal(card.eloTime, 1770888600);
  const none = buildUserCard({ data: { user: { uid: 1, elo: { rating: 999 } } } });
  assert.equal(none.eloRating, null, "user.elo 不是数据源");
});

// ★ ✅ 由 ccfLevel>0 驱动、气球由 xcpcLevel>0 驱动（41 用户双向零反例）；
// user.verified 只在看自己时返回，且与 ✅ 无关，所以模型里根本不该出现它。
test("徽章驱动字段只认 ccfLevel 与 xcpcLevel", () => {
  const card = buildUserCard(userPayload);
  assert.equal(card.ccfLevel, 7);
  assert.equal(card.xcpcLevel, 0);
  assert.equal("verified" in card, false, "verified 与 ✅ 无关，不该进模型");
});

test("关系枚举：0/1 之外一律未知", () => {
  assert.equal(relationOf(0), "unrelated");
  assert.equal(relationOf(1), "following");
  for (const bad of [2, 3, -1, null, undefined, "Following", {}])
    assert.equal(relationOf(bad), "unknown", String(bad));
  // 数字强转是**故意保留**的容忍：洛谷现在发的是数字（实测 userRelationship: 0），
  // 万一改成 "1" 仍能得到正确答案；改成 "Following" 这类则 NaN → unknown，
  // 视图层据此不显示可点的关注按钮 —— 安全降级。
  assert.equal(relationOf("1"), "following");
});

// ---- 关注写入 ----
test("关注请求形状严格贴合实测契约", () => {
  const request = buildFollowRequest({ uid: 116524, follow: true, csrfToken: "tok" });
  assert.equal(request.url, "/api/user/updateRelationShip");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["x-csrf-token"], "tok");
  assert.equal(request.headers["x-requested-with"], "XMLHttpRequest");
  assert.deepEqual(JSON.parse(request.body), { uid: 116524, relationship: 1 });
  assert.deepEqual(
    JSON.parse(buildFollowRequest({ uid: 1, follow: false, csrfToken: "t" }).body),
    { uid: 1, relationship: 0 },
  );
  // 拿不到 CSRF 就不许发：发出去只会被拒，还白改一次界面。
  assert.equal(buildFollowRequest({ uid: 1, follow: true, csrfToken: "" }), null);
  assert.equal(buildFollowRequest({ uid: 0, follow: true, csrfToken: "t" }), null);
});

test("未知关系不允许操作", () => {
  assert.equal(planFollowToggle({ relation: "unknown", followerCount: 5 }), null);
  assert.equal(planFollowToggle(null), null);
  const plan = planFollowToggle({ relation: "unrelated", followerCount: 176 });
  assert.equal(plan.follow, true);
  assert.equal(plan.optimistic.followerCount, 177);
  assert.equal(plan.rollback.followerCount, 176);
});

test("粉丝数不会被减成负数", () => {
  const plan = planFollowToggle({ relation: "following", followerCount: 0 });
  assert.equal(plan.optimistic.followerCount, 0);
});

// ★★ 响应体是 {"_empty":true}，不回传状态 —— 与 article.favor 同款。
// 所以必须乐观更新 + 失败回滚，否则界面会留一个服务器并不认的「已关注」。
test("写失败必须回滚，不留假的已关注", async () => {
  const states = [];
  const action = createFollowAction({
    csrfToken: "tok",
    request: async () => ({ ok: false, status: 403 }),
    onState: (uid, next, phase) => states.push(`${phase}:${next.relation}:${next.followerCount}`),
  });
  const result = await action.toggle({ uid: 116524, relation: "unrelated", followerCount: 176 });
  assert.equal(result, null);
  assert.deepEqual(states, ["pending:following:177", "failed:unrelated:176"]);
});

test("写成功保留乐观状态", async () => {
  const states = [];
  const action = createFollowAction({
    csrfToken: () => "tok",
    request: async () => ({ ok: true, status: 200 }),
    onState: (uid, next, phase) => states.push(`${phase}:${next.relation}`),
  });
  const result = await action.toggle({ uid: 1, relation: "unrelated", followerCount: 0 });
  assert.deepEqual(result, { relation: "following", followerCount: 1 });
  assert.deepEqual(states, ["pending:following", "confirmed:following"]);
});

// 连点两次不能让两个写请求竞速 —— 最后落地的状态会随机。
test("同一用户的写请求串行化", async () => {
  let calls = 0;
  let release = null;
  const action = createFollowAction({
    csrfToken: "tok",
    request: () =>
      new Promise((done) => {
        calls += 1;
        release = () => done({ ok: true, status: 200 });
      }),
  });
  const first = action.toggle({ uid: 1, relation: "unrelated", followerCount: 0 });
  const second = await action.toggle({ uid: 1, relation: "unrelated", followerCount: 0 });
  assert.equal(second, null, "在途时第二次点击应当被忽略");
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(action.isBusy(1), false);
});

// ---- 数据源 ----
test("旧版页面的 _feInjection 能解出来", () => {
  const payload = { currentData: { records: { result: [{ id: 1, submitTime: 2 }] } } };
  const html = `<script>window._feInjection = JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(payload))}"))</script>`;
  assert.deepEqual(parseLegacyInjection(html).currentData.records.result[0].id, 1);
  assert.equal(parseLegacyInjection("<html></html>"), null);
  assert.equal(parseLegacyInjection(null), null);
});

function sourceHarness(routes) {
  const calls = [];
  const clock = manualClock();
  const sources = createHoverCardSources({
    clock,
    fetchPage: (path, signal, init) => {
      calls.push({ path, header: init && init.headers && init.headers["x-lentille-request"] });
      const route = routes[path];
      if (route === undefined) return Promise.resolve({ ok: false });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(route),
        text: () => Promise.resolve(typeof route === "string" ? route : ""),
      });
    },
  });
  return { sources, calls, clock };
}

test("题目卡请求路径与 header 符合契约，并按 key 缓存", async () => {
  const { sources, calls } = sourceHarness({
    "/problem/P3372": problemPayload,
    "/_lfe/tags": { tags: [{ id: 42, name: "线段树" }, { id: 523, name: "树状数组" }] },
  });
  const card = await sources.problem("P3372", 0);
  assert.equal(card.pid, "P3372");
  assert.deepEqual(card.tags, ["线段树", "树状数组"]);
  const problemCall = calls.find((c) => c.path === "/problem/P3372");
  assert.equal(problemCall.header, "content-only");
  // 标签字典不带 lentille header（它不是 lentille 页面）。
  assert.ok(!calls.find((c) => c.path === "/_lfe/tags").header);
  const before = calls.length;
  await sources.problem("P3372", 0);
  assert.equal(calls.length, before, "第二次应当命中缓存，不再打网络");
});

test("匿名访客不请求提交记录", async () => {
  const { sources, calls } = sourceHarness({
    "/problem/P3372": problemPayload,
    "/_lfe/tags": { tags: [{ id: 42, name: "x" }] },
  });
  await sources.problem("P3372", 0);
  assert.equal(calls.some((c) => c.path.startsWith("/record/list")), false);
});

test("非法 pid / uid 不发请求", async () => {
  const { sources, calls } = sourceHarness({});
  assert.equal(await sources.problem("P1/../x", 0), null);
  assert.equal(await sources.user(0), null);
  assert.equal(await sources.user("x"), null);
  assert.equal(calls.length, 0);
});

// 关注成功后缓存里的关系必须跟着改，否则重新 hover 会把旧状态摆回来，
// 看起来就像「关注没生效」。
test("patchUser 让缓存跟上乐观更新", async () => {
  const { sources } = sourceHarness({ "/user/697932": userPayload });
  const first = await sources.user(697932);
  assert.equal(first.relation, "unrelated");
  sources.patchUser(697932, { relation: "following", followerCount: 177 });
  const again = await sources.user(697932);
  assert.equal(again.relation, "following");
  assert.equal(again.followerCount, 177);
});

test("缓存过期后重新取", async () => {
  const { sources, calls, clock } = sourceHarness({ "/user/1": { data: { user: { uid: 1, name: "a" } } } });
  await sources.user(1);
  const before = calls.length;
  clock.advance(5 * 60 * 1000 + 1);
  await sources.user(1);
  assert.equal(calls.length, before + 1);
});

// ---- 洛谷原生表现（全部实测取值）----
import {
  NATIVE_BADGE_COLOR,
  abbreviateCount,
  badgeStyle,
  levelColor,
  statusPresentation,
} from "../src/features/hover-card/luogu-native.js";

// owner 拍板：小于 1000 全显示，小于 1000000 用 k，否则用 m。
test("计数缩写按 owner 的口径", () => {
  assert.equal(abbreviateCount(0), "0");
  assert.equal(abbreviateCount(999), "999");
  assert.equal(abbreviateCount(1000), "1k");
  assert.equal(abbreviateCount(1234), "1.2k");
  assert.equal(abbreviateCount(259644), "260k");
  assert.equal(abbreviateCount(999999), "1000k");
  assert.equal(abbreviateCount(1000000), "1m");
  assert.equal(abbreviateCount(1234567), "1.2m");
  assert.equal(abbreviateCount(12345678), "12.3m");
  // 不留 `1.0k` 这种尾巴
  assert.equal(abbreviateCount(2000), "2k");
  // ★ Number(null) === 0 且 isFinite(0) 为真：只判 isFinite 会把「没有计数」变成 0。
  for (const bad of [null, undefined, "", "x", NaN])
    assert.equal(abbreviateCount(bad), null, String(bad));
});

// 等级色是在 /discuss 上把每个用户的 color 字段与用户名的 computed color 配对得到的。
test("等级色对齐实测值，未知落到 Gray", () => {
  assert.equal(levelColor("Purple"), "#9d3dcf");
  assert.equal(levelColor("Red"), "#fe4c61");
  assert.equal(levelColor("Orange"), "#f39c11");
  assert.equal(levelColor("Green"), "#52c41a");
  assert.equal(levelColor("Blue"), "#3498db");
  assert.equal(levelColor("Gray"), "#bfbfbf");
  // Cheater 本轮没在页面上遇到，不编值 —— 未知一律 Gray。
  for (const bad of ["Cheater", "", null, undefined, 1])
    assert.equal(levelColor(bad), "#bfbfbf", String(bad));
});

// 称号原生样式：白字 + 等级色底 + 圆角 2px（底色跟随用户等级色，实测紫名用户是紫底）。
test("称号样式跟随等级色", () => {
  const style = badgeStyle("Purple");
  assert.match(style, /background:#9d3dcf/);
  assert.match(style, /color:#fff/);
  assert.match(style, /border-radius:2px/);
  assert.equal(NATIVE_BADGE_COLOR, "#3498db");
});

// ★ 实测洛谷记录列表只渲染两种：12 → Accepted（#52c41a），其它（实测到 14）→
// Unaccepted（#e74c3c）。细分状态的数字码表没取到证据，所以这里不编细分名。
test("评测状态用洛谷原生的两种表示与配色", () => {
  const ac = statusPresentation(12);
  assert.equal(ac.label, "Accepted");
  assert.equal(ac.color, "#52c41a");
  assert.equal(ac.accepted, true);
  const no = statusPresentation(14);
  assert.equal(no.label, "Unaccepted");
  assert.equal(no.color, "#e74c3c");
  assert.equal(no.accepted, false);
  // ★ 同一个陷阱：没有状态时绝不能渲染成 Unaccepted ——
  // 那等于在不知情的情况下断言用户没通过。
  for (const bad of [null, undefined, "", "x", NaN])
    assert.equal(statusPresentation(bad), null, String(bad));
});
