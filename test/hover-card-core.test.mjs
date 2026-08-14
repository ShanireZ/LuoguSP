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
  pickPrizes,
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

// ★★ canary.15 真机复现的那条：练习页的题号是零间距铺开的（实测 A.bottom=193、
// 下一行 B.top=193），卡片落在 bottom+4，所以**从题号挪到卡片必然横穿一个别的题号**。
// 事件序列就是下面这串 —— 注意第 3 步没有 leave()：`onOut` 里「移到卡片上不算离开」
// 那条快路径直接 return 了，而 leave() 正是原本负责 cancelOpen 的地方。
// 于是隔壁那道题的待打开活满 300ms，把当前卡关掉换成隔壁 —— owner 看到的就是「卡片消失」。
test("从题号横穿隔壁题号移到卡片上，卡片不许被换掉", () => {
  const clock = manualClock();
  const events = [];
  const intent = createHoverIntent({
    clock,
    openDelayMs: 300,
    closeGraceMs: 160,
    onOpen: (t) => events.push(`open:${t}`),
    onClose: (t) => events.push(`close:${t}`),
  });
  intent.enter("problem:A");
  clock.advance(300);
  assert.deepEqual(events, ["open:problem:A"]);
  intent.leave();              // mouseout A（relatedTarget = 隔壁题号 B）
  clock.advance(20);
  intent.enter("problem:B");   // mouseover B —— 只是路过，60ms
  clock.advance(60);
  intent.enter("problem:A");   // mouseover 卡片本体：onOver 用 shown.key 重新 enter
  clock.advance(2000);
  assert.deepEqual(events, ["open:problem:A"], "隔壁题号的待打开必须被这一步掐掉");
  assert.equal(intent.getState().target, "problem:A");
  assert.equal(clock.pending(), 0, "不能留下任何还会开卡的定时器");
});

// ★★ 块是被这一次悬停**拉下来的**，等它加载完用户其实已经停了几百毫秒；
//    再要求他重新停 300ms，体感就是「第一次悬停不弹」（owner 报过两轮）。
test("open 立刻打开，不走停留计时", () => {
  const clock = manualClock();
  const events = [];
  const intent = createHoverIntent({
    clock,
    openDelayMs: 300,
    onOpen: (t) => events.push(`open:${t}`),
    onClose: (t) => events.push(`close:${t}`),
  });
  intent.open("problem:P1000");
  assert.deepEqual(events, ["open:problem:P1000"], "一个 tick 都不许等");
  assert.equal(intent.getState().open, true);
  assert.equal(clock.pending(), 0, "不该留下待打开的定时器");
  // 已经开着同一个目标就什么都不做，别重复请求。
  intent.open("problem:P1000");
  assert.deepEqual(events, ["open:problem:P1000"]);
  // 换目标时仍然保证同时只有一张卡。
  intent.open("user:1");
  assert.deepEqual(events, ["open:problem:P1000", "close:problem:P1000", "open:user:1"]);
  // 待打开的候选也要被掐掉 —— 否则它会在 300ms 后把刚开的卡换走。
  intent.enter("problem:P2000");
  intent.open("user:2");
  clock.advance(2000);
  assert.equal(intent.getState().target, "user:2");
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

// 用户卡现在有两个载荷：
//   主=`/api/user/info/{uid}`（原生悬停卡自己用的那个，951 B，elo 是真值，未实名也 200）
//   补=`/user/{uid}`（只为拿 gu / prizes / 以及**洛谷个人页口径**的 submittedProblemCount）
const userInfoPayload = {
  user: {
    uid: 697932,
    name: "Gcend",
    color: "Red",
    background: "https://cdn.luogu.com.cn/upload/image_hosting/x.png",
    blogAddress: "https://www.luogu.com.cn/blog/yangyafan/",
    ccfLevel: 7,
    xcpcLevel: 0,
    // ★ 主接口这个字段是**提交次数**（实测 5441），与个人页的「提交 710」不是一回事。
    passedProblemCount: 612,
    submittedProblemCount: 5441,
    ranking: 560,
    followingCount: 54,
    followerCount: 102,
    registerTime: 1647344053,
    userRelationship: 0,
    reverseUserRelationship: 1,
    // ★ 主接口里 elo / eloValue 是真值（`/user/{uid}` 里恒 null）。
    elo: { rating: 1478, time: 1770888600, latest: true },
    eloValue: 1478,
  },
};

const userPagePayload = {
  data: {
    prizes: [{ prize: { year: 2024, contest: "CSP-J", event: null, prize: "一等奖" } }],
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
      passedProblemCount: 612,
      submittedProblemCount: 710,
      ranking: 560,
      followingCount: 54,
      followerCount: 102,
      registerTime: 1647344053,
      userRelationship: 0,
      reverseUserRelationship: 1,
      elo: null,
      eloValue: null,
    },
  },
};

test("用户卡视图模型", () => {
  const card = buildUserCard(userInfoPayload, userPagePayload);
  assert.equal(card.uid, 697932);
  assert.equal(card.passedCount, 612);
  assert.equal(card.ranking, 560);
  assert.equal(card.guRating, 307);
  assert.equal(card.prizes.length, 1);
  assert.equal(card.relation, "unrelated");
  assert.equal(card.reverseRelation, "following", "reverse=1 就是「他关注了我」");
  assert.equal(card.background, "https://cdn.luogu.com.cn/upload/image_hosting/x.png");
  assert.equal(card.blogAddress, "https://www.luogu.com.cn/blog/yangyafan/");
  assert.equal(buildUserCard(null, { data: { user: {} } }), null);
  assert.equal(buildUserCard(null, null), null);
});

// ★★★ 两个接口的 `submittedProblemCount` **含义不同**：主接口是提交次数（697932 实测 5441），
// 个人页载荷是「提交」题数（710），而洛谷个人页上写的是 710。混着用会让我们的数字大 8 倍。
test("「提交」只认个人页口径，主接口那个同名字段不许顶替", () => {
  const both = buildUserCard(userInfoPayload, userPagePayload);
  assert.equal(both.submittedCount, 710);
  assert.notEqual(both.submittedCount, 5441);
  // 补载荷拿不到（未实名用户就是 403）→ 整个「通过 / 提交」都是未知，不许退回主接口的数。
  const only = buildUserCard(userInfoPayload, null);
  assert.equal(only.submittedCount, null);
  assert.equal(only.passedCount, null);
  // 但别的字段照常有 —— 这正是换主接口的意义。
  assert.equal(only.name, "Gcend");
  assert.equal(only.eloRating, 1478);
  assert.equal(only.followerCount, 102);
});

// 未实名用户：主接口 200、补载荷 403。卡片必须照常画出来，不能变成一句错误。
test("未通过实名认证的用户照样出卡", () => {
  const card = buildUserCard(
    { user: { uid: 2100000, name: "czycyr", passedProblemCount: 2, followerCount: 0 } },
    {
      status: 403,
      data: { errorCode: 403, errorMessage: "该用户未通过实名认证" },
      user: null,
    },
  );
  assert.equal(card.uid, 2100000);
  assert.equal(card.name, "czycyr");
  assert.deepEqual(card.prizes, []);
  assert.equal(card.guRating, null);
  assert.equal(card.passedCount, null, "个人页口径拿不到就是未知");
});

// ★ user.elo / user.eloValue 恒为 null，真数据在顶层 data.elo。抄错地方就永远显示不出 Elo。
// ★ 主接口的 `user.elo` 是真值；`/user/{uid}` 的 `user.elo` 恒 null，真值在顶层 `data.elo`。
// 两条路都要能走通。
test("Elo：主接口读 user.elo，个人页载荷读顶层 data.elo", () => {
  assert.equal(buildUserCard(userInfoPayload, userPagePayload).eloRating, 1478);
  assert.equal(buildUserCard(userInfoPayload, null).eloRating, 1478);
  const pageOnly = buildUserCard(null, userPagePayload);
  assert.equal(pageOnly.eloRating, 1478, "只有个人页载荷时从顶层 data.elo 取");
  assert.equal(pageOnly.eloTime, 1770888600);
  const none = buildUserCard({ user: { uid: 1 } }, null);
  assert.equal(none.eloRating, null);
});

// ★ ✅ 由 ccfLevel>0 驱动、气球由 xcpcLevel>0 驱动（41 用户双向零反例）；
// user.verified 只在看自己时返回，且与 ✅ 无关，所以模型里根本不该出现它。
test("徽章驱动字段只认 ccfLevel 与 xcpcLevel", () => {
  const card = buildUserCard(userInfoPayload, userPagePayload);
  assert.equal(card.ccfLevel, 7);
  assert.equal(card.xcpcLevel, 0);
  assert.equal("verified" in card, false, "verified 与 ✅ 无关，不该进模型");
});

// ★★ owner 追问过两次。实测 `data.prizes` 形状是**套一层**的、且**按年份升序**
// （697932：2024 CSP-J 在前，2025 CSP-S 在后，洛谷个人页也照这个顺序列）。
// 旧代码 `slice(0,4)` + 视图取 `[0]` = **永远只显示最早那个奖**。
test("获奖按年份降序，最近的排在最前", () => {
  const picked = pickPrizes([
    { prize: { year: 2024, contest: "CSP-J", prize: "一等奖" } },
    { prize: { year: 2025, contest: "CSP-S", prize: "一等奖" } },
    { prize: { year: 2023, contest: "NOIP", prize: "二等奖" } },
  ]);
  assert.deepEqual(picked.map((p) => p.prize.year), [2025, 2024, 2023]);
  // 上游给的就是升序 —— 不排序的话第一条会是 2023，反证一下别退回去。
  assert.notEqual(picked[0].prize.year, 2023);
  // owner 2026-08-14 收到 3 条：最多 3 条，且取的是**最近**的 3 条。
  const many = pickPrizes([2019, 2020, 2021, 2022, 2023].map((year) => ({ prize: { year } })));
  assert.deepEqual(many.map((p) => p.prize.year), [2023, 2022, 2021]);
  // 没有年份的排最后，也不该把整条丢掉。
  const mixed = pickPrizes([{ prize: { prize: "特等奖" } }, { prize: { year: 2020 } }]);
  assert.deepEqual(mixed.map((p) => p.prize.year ?? null), [2020, null]);
  assert.deepEqual(pickPrizes(null), []);
  assert.deepEqual(pickPrizes([null, {}, { prize: null }]), []);
});

// ★★ 枚举权威来源是 `GET /_lfe/config` 的 `UserRelationship`：0/1/2 三个值。
// 上一轮「洛谷没有枚举字典端点」的结论作废 —— 只是名字不叫 relationships/dicts/enums。
test("关系枚举：0/1/2 之外一律未知", () => {
  assert.equal(relationOf(0), "unrelated");
  assert.equal(relationOf(1), "following");
  assert.equal(relationOf(2), "blacklisted");
  for (const bad of [3, -1, null, undefined, "Following", {}])
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

// ★★★ owner 2026-08-14 第五轮：AT 题（`AT_abc397_a`）卡片只有一句「拿不到这条数据」。
//    根因是 sources.js 自己写了一份**漏掉下划线**的 pid 字符集，AT_/CF_ 这类题
//    在数据层被当成非法 pid 直接退出 —— 而接口本身是好的（实测 200、11541 B）。
//    现在两处共用 anchors.js 的那一份。
test("带下划线的 pid（AT_/CF_）照样发请求", async () => {
  const payload = { data: { problem: { pid: "AT_abc397_a", name: "[ABC397A] Thermometer", difficulty: 1, tags: [], limits: { time: [2000], memory: [1048576] } } } };
  const { sources, calls } = sourceHarness({ "/problem/AT_abc397_a": payload, "/_lfe/tags": { tags: [{ id: 1, name: "x" }] } });
  const card = await sources.problem("AT_abc397_a", 0);
  assert.equal(card && card.pid, "AT_abc397_a");
  assert.equal(calls.some((c) => c.path === "/problem/AT_abc397_a"), true);
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
  const { sources } = sourceHarness({ "/api/user/info/697932": userInfoPayload, "/user/697932": userPagePayload });
  const first = await sources.user(697932);
  assert.equal(first.relation, "unrelated");
  sources.patchUser(697932, { relation: "following", followerCount: 177 });
  const again = await sources.user(697932);
  assert.equal(again.relation, "following");
  assert.equal(again.followerCount, 177);
});

test("缓存过期后重新取", async () => {
  const { sources, calls, clock } = sourceHarness({ "/api/user/info/1": { user: { uid: 1, name: "a" } } });
  await sources.user(1);
  const before = calls.length;
  assert.equal(before, 2, "一次用户卡打两个接口：主接口 + 个人页补充载荷");
  clock.advance(5 * 60 * 1000 + 1);
  await sources.user(1);
  assert.equal(calls.length, before + 2);
});

// ---- 洛谷原生表现（全部实测取值）----
import {
  FA_BADGE_CHECK,
  FA_BALLOON,
  abbreviateCount,
  badgeStyle,
  badgeTierColor,
  ccfBadge,
  levelColor,
  statusPresentation,
  xcpcBadge,
} from "../src/features/hover-card/luogu-native.js";

// owner 2026-08-14 最终拍板（★ 同日改过两次口径，只认这一版）：
//   <1000 无单位无小数；1000~999999 用 k 保留两位小数；>=1000000 用 m 保留两位小数。
//   四个调用点共用这一套（用户卡通过/提交、关注、粉丝、题目卡通过/提交）。
test("计数缩写按 owner 的口径：k / m 一律两位小数", () => {
  assert.equal(abbreviateCount(0), "0");
  assert.equal(abbreviateCount(999), "999");
  assert.equal(abbreviateCount(1000), "1.00k");
  assert.equal(abbreviateCount(1234), "1.23k");
  assert.equal(abbreviateCount(259644), "259.64k");
  assert.equal(abbreviateCount(1000000), "1.00m");
  assert.equal(abbreviateCount(1234567), "1.23m");
  assert.equal(abbreviateCount(12345678), "12.34m");
  // ★ 两位小数一位都不省 —— 旧口径会把这个写成 `2k`。
  assert.equal(abbreviateCount(2000), "2.00k");
  // ★ Number(null) === 0 且 isFinite(0) 为真：只判 isFinite 会把「没有计数」变成 0。
  for (const bad of [null, undefined, "", "x", NaN])
    assert.equal(abbreviateCount(bad), null, String(bad));
});

// ★★★ owner 亲自给的那个判据。它同时钉死了「截断而不是四舍五入」：
//   四舍五入会得到 `1000.00k` —— 多一位，还翻过了 k/m 的分界线。
test("999999 是 999.99k —— 取整方式是向下截断，不是四舍五入", () => {
  assert.equal(abbreviateCount(999999), "999.99k");
  assert.notEqual(abbreviateCount(999999), "1000.00k");
  // 这条对所有值生效，不只是边界：四舍五入会把它写成 1.24k。
  assert.equal(abbreviateCount(1237), "1.23k");
  assert.equal(abbreviateCount(1239), "1.23k");
});

// ★★ 浮点反证。实测 1130 是最小的发散值：`1130/1000*100` 是 112.99999999999999，
//    「先除再乘」的写法会 floor 成 1.12k。整数运算才拿得到 1.13k。
test("先乘后除，不许被浮点少算一分", () => {
  for (const [input, expected] of [
    [1130, "1.13k"],
    [1140, "1.14k"],
    [1150, "1.15k"],
    [1160, "1.16k"],
    [2010, "2.01k"],
    [2030, "2.03k"],
  ])
    assert.equal(abbreviateCount(input), expected, String(input));
});

test("负数保留符号", () => {
  assert.equal(abbreviateCount(-1), "-1");
  assert.equal(abbreviateCount(-1234), "-1.23k");
  assert.equal(abbreviateCount(-1234567), "-1.23m");
});

// 等级色是在 /discuss 上把每个用户的 color 字段与用户名的 computed color 配对得到的。
test("等级色对齐实测值，未知落到 Gray", () => {
  assert.equal(levelColor("Purple"), "#9d3dcf");
  assert.equal(levelColor("Red"), "#fe4c61");
  assert.equal(levelColor("Orange"), "#f39c11");
  assert.equal(levelColor("Green"), "#52c41a");
  assert.equal(levelColor("Blue"), "#3498db");
  assert.equal(levelColor("Gray"), "#bfbfbf");
  // ★ Cheater 上一轮因为「页面上没遇到」而留白；2026-08-14 从 UserName 组件原文
  //   拿到了映射（yellow-4 = #ad8b00），可以照实写了。
  assert.equal(levelColor("Cheater"), "#ad8b00");
  // ★ Red 映射到 pink-3，不是 red-3（#e74c3c）—— 按名字猜会写错。
  assert.notEqual(levelColor("Red"), "#e74c3c");
  for (const bad of ["", null, undefined, 1, "Rainbow"])
    assert.equal(levelColor(bad), "#bfbfbf", String(bad));
});

// ★★ 分档与配色抄自 OiLevel / XcpcLevel 组件原文：[[8,gold],[6,blue],[3,green]]，
// **level < 3 一个图标都不画**。旧口径「> 0 就显示」是抽样偏差（抽到的人都在 6~7 档）。
test("徽章分档：低于 3 级不画图标，配色按档走", () => {
  assert.equal(badgeTierColor(8), "#ffc116");
  assert.equal(badgeTierColor(9), "#ffc116");
  assert.equal(badgeTierColor(7), "#3498db");
  assert.equal(badgeTierColor(6), "#3498db");
  assert.equal(badgeTierColor(5), "#52c41a");
  assert.equal(badgeTierColor(3), "#52c41a");
  for (const low of [2, 1, 0]) assert.equal(badgeTierColor(low), null, String(low));
  for (const bad of [null, undefined, "", "x", NaN])
    assert.equal(badgeTierColor(bad), null, String(bad));
  assert.equal(ccfBadge(2), null);
  assert.equal(xcpcBadge(0), null);
});

// ★ 两个图标的着色**是反的**（组件原文），写反了气球会变成白底上的白气球。
test("✅ 与 🎈 的着色互为镜像，path 逐字节抄自洛谷的 FA 块", () => {
  const ccf = ccfBadge(7);
  assert.equal(ccf.primary, "#fff", "✅ 的那一钩恒为白");
  assert.equal(ccf.secondary, "#3498db", "✅ 的盾面取等级色");
  const xcpc = xcpcBadge(7);
  assert.equal(xcpc.primary, "#3498db", "🎈 的球体取等级色");
  assert.equal(xcpc.secondary, "#fff", "🎈 的高光恒为白");
  // 长度是 2026-08-13 与 08-14 两次独立测得的同一组数，抄错/截断会当场露馅。
  assert.equal(FA_BADGE_CHECK.viewBox, "0 0 512 512");
  assert.equal(FA_BADGE_CHECK.secondary.length, 589);
  assert.equal(FA_BADGE_CHECK.primary.length, 211);
  assert.equal(FA_BALLOON.viewBox, "0 0 384 512");
  assert.equal(FA_BALLOON.secondary.length, 125);
  assert.equal(FA_BALLOON.primary.length, 320);
  for (const d of [FA_BADGE_CHECK.secondary, FA_BADGE_CHECK.primary, FA_BALLOON.secondary, FA_BALLOON.primary])
    assert.match(d, /^M[-\d]/, "path 必须以 moveto 开头");
});

// 称号原生样式：白字 + 等级色底 + 圆角 2px（底色跟随用户等级色，实测紫名用户是紫底）。
test("称号样式跟随等级色", () => {
  const style = badgeStyle("Purple");
  assert.match(style, /background:#9d3dcf/);
  assert.match(style, /color:#fff/);
  assert.match(style, /border-radius:2px/);
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
