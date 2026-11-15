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
  buildRelationRequest,
  createFollowAction,
  planFollowToggle,
} from "../src/features/hover-card/follow-action.js";
import {
  createHoverCardSources,
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

// ---- 難度檔位 ----
// ★ 這張表是從洛谷自己的練習頁實測配對出來的（0–8 共 9 檔，一檔一組）。
// 兩個逐碼位核對過的細節：減號是 U+2212，第 8 檔沒有尾部的 C。
test("难度档位名与颜色对齐官方 9 档", () => {
  assert.equal(difficultyName(0), "暂无评定");
  assert.equal(difficultyName(2), "普及−");
  assert.equal(difficultyName(4), "普及+/提高−");
  assert.equal(difficultyName(8), "NOI/NOI+/CTS");
  assert.equal(difficultyName(2).includes("-"), false, "减号必须是 U+2212，不是 ASCII 连字符");
  assert.equal(difficultyName(8).endsWith("CTSC"), false, "第 8 档没有尾部的 C");
  assert.equal(difficultyColor(4), "#52c41a");
  // 越界與非法一律落到「暫無評定」，不顯示 undefined。
  for (const bad of [-1, 9, null, undefined, "4", 1.5])
    assert.equal(difficultyName(bad), "暂无评定", String(bad));
});

// ---- 懸停意圖 ----
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

// ★ 沒有寬限期，滑鼠從錨點移到卡片上的途中卡片就被收走，卡上的關注按鈕永遠點不到。
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
  intent.enter("P1000"); // 指針落到卡片上
  clock.advance(1000);
  assert.deepEqual(closed, [], "宽限期内回来就不该关");
  intent.leave();
  clock.advance(160);
  assert.deepEqual(closed, ["P1000"]);
});

// ★★ canary.15 真機重現的那條：練習頁的題號是零間距鋪開的（實測 A.bottom=193、
// 下一行 B.top=193），卡片落在 bottom+4，所以**從題號挪到卡片必然橫穿一個別的題號**。
// 事件序列就是下面這串 —— 注意第 3 步沒有 leave()：`onOut` 裡「移到卡片上不算離開」
// 那條快路徑直接 return 了，而 leave() 正是原本負責 cancelOpen 的地方。
// 於是隔壁那道題的待打開活滿 300ms，把當前卡關掉換成隔壁 —— owner 看到的就是「卡片消失」。
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
  intent.leave();              // mouseout A（relatedTarget = 隔壁題號 B）
  clock.advance(20);
  intent.enter("problem:B");   // mouseover B —— 只是路過，60ms
  clock.advance(60);
  intent.enter("problem:A");   // mouseover 卡片本體：onOver 用 shown.key 重新 enter
  clock.advance(2000);
  assert.deepEqual(events, ["open:problem:A"], "隔壁题号的待打开必须被这一步掐掉");
  assert.equal(intent.getState().target, "problem:A");
  assert.equal(clock.pending(), 0, "不能留下任何还会开卡的定时器");
});

// ★★ 塊是被這一次懸停**拉下來的**，等它載入完使用者其實已經停了幾百毫秒；
//    再要求他重新停 300ms，體感就是「第一次懸停不彈」（owner 報過兩輪）。
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
  // 已經開著同一個目標就什麼都不做，別重複請求。
  intent.open("problem:P1000");
  assert.deepEqual(events, ["open:problem:P1000"]);
  // 換目標時仍然保證同時只有一張卡。
  intent.open("user:1");
  assert.deepEqual(events, ["open:problem:P1000", "close:problem:P1000", "open:user:1"]);
  // 待打開的候選也要被掐掉 —— 否則它會在 300ms 後把剛開的卡換走。
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

// ---- 視圖模型 ----
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

// ★ 反證過的語義：這兩個布爾是真的按訪問者算的（P3372/P1001=false、B3836=true）。
// 缺失時必須是 null（未知），不能偽造成 false（未通過）。
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
  // 沒有 submitTime 的行不算 —— 拿不到時間就沒法說「上次」是哪次。
  assert.equal(pickLastAttempt([{ id: 3, score: 100 }]), null);
});

// 使用者卡現在有兩個載荷：
//   主=`/api/user/info/{uid}`（原生懸停卡自己用的那個，951 B，elo 是真值，未實名也 200）
//   補=`/user/{uid}`（只為拿 gu / prizes / 以及**洛谷個人頁口徑**的 submittedProblemCount）
const userInfoPayload = {
  user: {
    uid: 697932,
    name: "Gcend",
    color: "Red",
    background: "https://cdn.luogu.com.cn/upload/image_hosting/x.png",
    blogAddress: "https://www.luogu.com.cn/blog/yangyafan/",
    ccfLevel: 7,
    xcpcLevel: 0,
    // ★ 主介面這個欄位是**提交次數**（實測 5441），與個人頁的「提交 710」不是一回事。
    passedProblemCount: 612,
    submittedProblemCount: 5441,
    ranking: 560,
    followingCount: 54,
    followerCount: 102,
    registerTime: 1647344053,
    userRelationship: 0,
    reverseUserRelationship: 1,
    // ★ 主介面裡 elo / eloValue 是真值（`/user/{uid}` 裡恆 null）。
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
  assert.equal(card.guRating, 307);
  assert.equal(card.prizes.length, 1);
  assert.equal(card.relation, "unrelated");
  assert.equal(card.reverseRelation, "following", "reverse=1 就是「他关注了我」");
  assert.equal(card.background, "https://cdn.luogu.com.cn/upload/image_hosting/x.png");
  assert.equal(buildUserCard(null, { data: { user: {} } }), null);
  assert.equal(buildUserCard(null, null), null);
});

// ★★★ 兩個介面的 `submittedProblemCount` **含義不同**：主介面是提交次數（697932 實測 5441），
// 個人頁載荷是「提交」題數（710），而洛谷個人頁上寫的是 710。混著用會讓我們的數字大 8 倍。
test("「提交」只认个人页口径，主接口那个同名字段不许顶替", () => {
  const both = buildUserCard(userInfoPayload, userPagePayload);
  assert.equal(both.submittedCount, 710);
  assert.notEqual(both.submittedCount, 5441);
  // 補載荷拿不到（未實名使用者就是 403）→ 整個「通過 / 提交」都是未知，不許退回主介面的數。
  const only = buildUserCard(userInfoPayload, null);
  assert.equal(only.submittedCount, null);
  assert.equal(only.passedCount, null);
  // 但別的欄位照常有 —— 這正是換主介面的意義。
  assert.equal(only.name, "Gcend");
  assert.equal(only.eloRating, 1478);
  assert.equal(only.followerCount, 102);
});

// 未實名使用者：主介面 200、補載荷 403。卡片必須照常畫出來，不能變成一句錯誤。
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

// ★ user.elo / user.eloValue 恆為 null，真資料在頂層 data.elo。抄錯地方就永遠顯示不出 Elo。
// ★ 主介面的 `user.elo` 是真值；`/user/{uid}` 的 `user.elo` 恆 null，真值在頂層 `data.elo`。
// 兩條路都要能走通。
test("Elo：主接口读 user.elo，个人页载荷读顶层 data.elo", () => {
  assert.equal(buildUserCard(userInfoPayload, userPagePayload).eloRating, 1478);
  assert.equal(buildUserCard(userInfoPayload, null).eloRating, 1478);
  const pageOnly = buildUserCard(null, userPagePayload);
  assert.equal(pageOnly.eloRating, 1478, "只有个人页载荷时从顶层 data.elo 取");
  const none = buildUserCard({ user: { uid: 1 } }, null);
  assert.equal(none.eloRating, null);
});

// ★ ✅ 由 ccfLevel>0 驅動、氣球由 xcpcLevel>0 驅動（41 使用者雙向零反例）；
// user.verified 只在看自己時回傳，且與 ✅ 無關，所以模型裡根本不該出現它。
test("徽章驱动字段只认 ccfLevel 与 xcpcLevel", () => {
  const card = buildUserCard(userInfoPayload, userPagePayload);
  assert.equal(card.ccfLevel, 7);
  assert.equal(card.xcpcLevel, 0);
  assert.equal("verified" in card, false, "verified 与 ✅ 无关，不该进模型");
});

// ★★ owner 追問過兩次。實測 `data.prizes` 形狀是**套一層**的、且**按年份升序**
// （697932：2024 CSP-J 在前，2025 CSP-S 在後，洛谷個人頁也照這個順序列）。
// 舊程式碼 `slice(0,4)` + 視圖取 `[0]` = **永遠只顯示最早那個獎**。
test("获奖按年份降序，最近的排在最前", () => {
  const picked = pickPrizes([
    { prize: { year: 2024, contest: "CSP-J", prize: "一等奖" } },
    { prize: { year: 2025, contest: "CSP-S", prize: "一等奖" } },
    { prize: { year: 2023, contest: "NOIP", prize: "二等奖" } },
  ]);
  assert.deepEqual(picked.map((p) => p.prize.year), [2025, 2024, 2023]);
  // 上游給的就是升序 —— 不排序的話第一條會是 2023，反證一下別退回去。
  assert.notEqual(picked[0].prize.year, 2023);
  // owner 2026-08-14 收到 3 條：最多 3 條，且取的是**最近**的 3 條。
  const many = pickPrizes([2019, 2020, 2021, 2022, 2023].map((year) => ({ prize: { year } })));
  assert.deepEqual(many.map((p) => p.prize.year), [2023, 2022, 2021]);
  // 沒有年份的排最後，也不該把整條丟掉。
  const mixed = pickPrizes([{ prize: { prize: "特等奖" } }, { prize: { year: 2020 } }]);
  assert.deepEqual(mixed.map((p) => p.prize.year ?? null), [2020, null]);
  assert.deepEqual(pickPrizes(null), []);
  assert.deepEqual(pickPrizes([null, {}, { prize: null }]), []);
});

// ★★ 枚舉權威來源是 `GET /_lfe/config` 的 `UserRelationship`：0/1/2 三個值。
// 上一輪「洛谷沒有枚舉字典端點」的結論作廢 —— 只是名字不叫 relationships/dicts/enums。
test("关系枚举：0/1/2 之外一律未知", () => {
  assert.equal(relationOf(0), "unrelated");
  assert.equal(relationOf(1), "following");
  assert.equal(relationOf(2), "blacklisted");
  for (const bad of [3, -1, null, undefined, "Following", {}])
    assert.equal(relationOf(bad), "unknown", String(bad));
  // 數字強轉是**故意保留**的容忍：洛谷現在發的是數字（實測 userRelationship: 0），
  // 萬一改成 "1" 仍能得到正確答案；改成 "Following" 這類則 NaN → unknown，
  // 視圖層據此不顯示可點的關注按鈕 —— 安全降級。
  assert.equal(relationOf("1"), "following");
});

// ---- 關注寫入 ----
test("关注请求形状严格贴合实测契约", () => {
  const request = buildRelationRequest({ uid: 116524, relationship: 1, csrfToken: "tok" });
  assert.equal(request.url, "/api/user/updateRelationShip");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["x-csrf-token"], "tok");
  assert.equal(request.headers["x-requested-with"], "XMLHttpRequest");
  assert.deepEqual(JSON.parse(request.body), { uid: 116524, relationship: 1 });
  assert.deepEqual(
    JSON.parse(buildRelationRequest({ uid: 1, relationship: 0, csrfToken: "t" }).body),
    { uid: 1, relationship: 0 },
  );
  // 拿不到 CSRF 就不許發：發出去只會被拒，還白改一次介面。
  assert.equal(buildRelationRequest({ uid: 1, relationship: 1, csrfToken: "" }), null);
  assert.equal(buildRelationRequest({ uid: 0, relationship: 1, csrfToken: "t" }), null);
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

// ★★ 回應體是 {"_empty":true}，不回傳狀態 —— 與 article.favor 同款。
// 所以必須樂觀更新 + 失敗回復，否則介面會留一個伺服器並不認的「已關注」。
const relationOrigin = "https://www.luogu.com.cn";
const confirmedRelation = () => ({
  ok: true, status: 200, redirected: false, url: `${relationOrigin}/api/user/updateRelationShip`,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => ({ _empty: true }),
});

test("写失败必须回滚，不留假的已关注", async () => {
  const states = [];
  const action = createFollowAction({
    origin: relationOrigin,
    csrfToken: "tok",
    request: async () => ({ ok: false, status: 403 }),
    onState: (viewer, uid, next, phase) => states.push(`${phase}:${next.relation}:${next.followerCount}`),
  });
  const result = await action.toggle(42, { uid: 116524, relation: "unrelated", followerCount: 176 });
  assert.equal(result, null);
  assert.deepEqual(states, ["pending:following:177", "failed:unrelated:176"]);
});

test("写成功保留乐观状态", async () => {
  const states = [];
  const action = createFollowAction({
    origin: relationOrigin,
    csrfToken: () => "tok",
    request: async () => confirmedRelation(),
    onState: (viewer, uid, next, phase) => states.push(`${phase}:${next.relation}`),
  });
  const result = await action.toggle(42, { uid: 1, relation: "unrelated", followerCount: 0 });
  assert.deepEqual(result, { relation: "following", followerCount: 1 });
  assert.deepEqual(states, ["pending:following", "confirmed:following"]);
});

// 連點兩次不能讓兩個寫請求競速 —— 最後完成實作的狀態會隨機。
test("同一用户的写请求串行化", async () => {
  let calls = 0;
  let release = null;
  const action = createFollowAction({
    origin: relationOrigin,
    csrfToken: "tok",
    request: () =>
      new Promise((done) => {
        calls += 1;
        release = () => done(confirmedRelation());
      }),
  });
  const state = { uid: 1, relation: "unrelated", followerCount: 0 };
  const first = action.toggle(42, state);
  assert.equal(await action.toggle(42, state), null, "在途时第二次点击应当被忽略");
  assert.equal(await action.block(42, state), null);
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(action.isBusy(42, 1), false);
});

test("relation writes keep pending state and settlement scoped to each viewer and target", async () => {
  const writes = [];
  const states = [];
  const action = createFollowAction({
    origin: relationOrigin,
    csrfToken: "tok",
    request: (payload) => {
      const write = Promise.withResolvers();
      writes.push({ ...JSON.parse(payload.body), ...write });
      return write.promise;
    },
    onState: (viewer, uid, patch, phase) => states.push({ viewer, uid, patch, phase }),
  });
  const state = { uid: 123, relation: "unrelated", followerCount: 5 };
  const first = action.toggle(42, state);
  assert.equal(action.isBusy(42, 123), true);
  assert.equal(action.isBusy(43, 123), false);
  assert.equal(action.isBusy(42, 124), false);
  const second = action.block(43, state);
  const otherTarget = action.block(42, { ...state, uid: 124 });
  assert.deepEqual(writes.map(({ uid, relationship }) => [uid, relationship]), [[123, 1], [123, 2], [124, 2]]);
  writes[0].resolve({ ok: false, status: 503 });
  assert.equal(await first, null);
  assert.equal(action.isBusy(42, 123), false);
  assert.equal(action.isBusy(43, 123), true);
  assert.equal(action.isBusy(42, 124), true);
  assert.deepEqual(states.at(-1), { viewer: 42, uid: 123,
    patch: { relation: "unrelated", followerCount: 5 }, phase: "failed" });
  writes[1].resolve(confirmedRelation());
  assert.deepEqual(await second, { relation: "blacklisted" });
  assert.deepEqual(states.at(-1), { viewer: 43, uid: 123,
    patch: { relation: "blacklisted" }, phase: "confirmed" });
  writes[2].resolve(confirmedRelation());
  await otherTarget;
  assert.equal(action.isBusy(43, 123), false);
  assert.equal(action.isBusy(42, 124), false);
});

// ---- 資料源 ----
const sourceOrigin = "https://www.luogu.com.cn";
function sourceHarness(routes) {
  const calls = [];
  const clock = manualClock();
  const sources = createHoverCardSources({
    clock,
    origin: sourceOrigin,
    fetchPage: (path, signal, init) => {
      calls.push({ path, header: init && init.headers && init.headers["x-lentille-request"] });
      const route = routes[path];
      if (route === undefined) return Promise.resolve({ ok: false });
      return Promise.resolve({
        ok: true,
        status: 200,
        redirected: false,
        url: new URL(path, sourceOrigin).href,
        headers: new Headers({ "content-type": "application/json" }),
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
  // 標籤字典不帶 lentille header（它不是 lentille 頁面）。
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

// ★★★ owner 2026-08-14 第五輪：AT 題（`AT_abc397_a`）卡片只有一句「拿不到這條資料」。
//    根因是 sources.js 自己寫了一份**漏掉下劃線**的 pid 字元集，AT_/CF_ 這類題
//    在資料層被當成非法 pid 直接退出 —— 而介面本身是好的（實測 200、11541 B）。
//    現在兩處共用 anchors.js 的那一份。
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

// 關注成功後快取裡的關係必須跟著改，否則重新 hover 會把舊狀態擺回來，
// 看起來就像「關注沒生效」。
test("patchUser updates the initiating viewer's cache and invalidates only that viewer's native lookup", async () => {
  let viewer = 42;
  const invalidations = [];
  const sources = createHoverCardSources({
    viewer: () => viewer,
    nativeUserInfo: {
      read: (uid, account) => ({ user: { uid, name: "Target", userRelationship: 0,
        followerCount: account === 42 ? 5 : 77 } }),
      invalidate: (uid, account) => invalidations.push([uid, account]),
    },
    fetchPage: async () => null,
  });
  const first = await sources.user(123);
  assert.equal(first.followerCount, 5);
  sources.patchUser(42, 123, { relation: "following", followerCount: 6 });
  assert.equal((await sources.user(123)).relation, "following");
  viewer = 43;
  const second = await sources.user(123);
  assert.equal(second.followerCount, 77);
  sources.patchUser(42, 123, { relation: "unrelated", followerCount: 5 });
  assert.equal(await sources.user(123), second);
  viewer = 42;
  assert.deepEqual(await sources.user(123), first);
  assert.deepEqual(invalidations, [[123, 42], [123, 42]]);
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

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const profileResponse = (path, payload) => ({
  ok: true, status: 200, redirected: false, url: new URL(path, sourceOrigin).href,
  headers: new Headers({ "content-type": "application/json" }), json: async () => payload,
});

for (const [fault, metadata] of [
  ["external URL", { url: "https://outside.example/user/123" }],
  ["another endpoint", { url: `${sourceOrigin}/user/124` }],
  ["redirected response", { redirected: true }],
  ["HTML media", { headers: new Headers({ "content-type": "text/html" }) }],
  ["missing URL", { url: undefined }],
  ["partial response", { status: 206 }],
]) {
  test(`user reads reject ${fault} before decoding and retry the affected branch`, async () => {
    for (const branch of ["info", "profile"]) {
      const badPath = branch === "info" ? "/api/user/info/123" : "/user/123";
      let attempts = 0;
      let untrustedDecodes = 0;
      const sources = createHoverCardSources({ origin: sourceOrigin, fetchPage: async (path, signal, init) => {
        assert.equal(init.mode, "same-origin");
        assert.equal(init.credentials, "same-origin");
        assert.equal(init.redirect, "error");
        assert.equal(init.headers?.["x-lentille-request"], path === "/user/123" ? "content-only" : undefined);
        const response = profileResponse(path, path.includes("/api/")
          ? { user: { uid: 123, name: "Trusted basic" } }
          : { data: { user: { uid: 123, name: "Trusted profile" }, gu: { rating: 42 } } });
        if (path !== badPath || ++attempts !== 1) return response;
        return { ...response, ...metadata, json: async () => {
          untrustedDecodes++;
          throw new Error("Untrusted response was decoded");
        } };
      } });
      const partial = await sources.user(123);
      assert.equal(partial.name, branch === "info" ? "Trusted profile" : "Trusted basic");
      const complete = await sources.user(123);
      assert.equal(complete.name, "Trusted basic");
      assert.equal(complete.guRating, 42);
      assert.equal(attempts, 2);
      assert.equal(untrustedDecodes, 0);
    }
  });
}

test("user preview retries a failed branch on reopen, retains partial fields, and backs off on repeated failures", async () => {
  const clock = manualClock();
  const requests = [];
  let available = false;
  const sources = createHoverCardSources({ clock, origin: sourceOrigin, fetchPage: async (path) => {
    requests.push(path);
    if (path === "/api/user/info/123") return profileResponse(path, { user: { uid: 123, name: "Target" } });
    if (!available) return { ok: false, status: 503 };
    return profileResponse(path, { data: { user: { uid: 123 }, gu: { rating: 980 } } });
  } });
  const basic = await sources.user(123);
  assert.equal(basic.name, "Target");
  assert.equal(basic.guRating, null);
  assert.equal(await sources.user(123), basic);
  available = true;
  assert.equal(await sources.user(123), basic);
  assert.equal(requests.length, 3);
  clock.advance(2000);
  const updates = [];
  const full = await sources.user(123, undefined, model => updates.push(model));
  assert.equal(full.name, "Target");
  assert.equal(full.guRating, 980);
  assert.deepEqual(updates, [basic, full]);
  assert.deepEqual(requests.filter(path => path.includes("/api/")), ["/api/user/info/123"]);
  assert.equal(await sources.user(123), full);
  assert.equal(requests.length, 4);
  assert.equal(clock.pending(), 0);
});

test("user preview shares in-flight reads, detaches a closed consumer, and settles staged data at its deadline", async () => {
  const clock = manualClock();
  const requests = [];
  const lateProfile = Promise.withResolvers();
  const sources = createHoverCardSources({ clock, origin: sourceOrigin, fetchPage: (path, signal) => {
    requests.push({ path, signal });
    return path === "/user/123"
      ? lateProfile.promise : profileResponse(path, { user: { uid: 123, name: "Target" } });
  } });
  const first = new AbortController();
  const firstUpdates = [];
  const secondUpdates = [];
  const closed = sources.user(123, first.signal, value => firstUpdates.push(value));
  const retained = sources.user(123, undefined, value => secondUpdates.push(value));
  first.abort();
  assert.equal(await closed, null);
  await nextTurn();
  assert.equal(requests.length, 2);
  assert.equal(firstUpdates.length, 0);
  assert.equal(secondUpdates.length, 1);
  assert.equal(requests[0].signal.aborted, false);
  clock.advance(3500);
  assert.equal((await retained).name, "Target");
  assert.equal(requests.every(({ signal }) => signal.aborted), true);
  lateProfile.resolve(profileResponse("/user/123", { data: { user: { uid: 123 }, gu: { rating: 980 } } }));
  await nextTurn();
  assert.equal(secondUpdates.length, 1);
  assert.equal(clock.pending(), 0);
  assert.equal((await sources.user(123)).guRating, 980);
  assert.equal(requests.length, 3);
});

test("closing the last user preview aborts reads and an old viewer response cannot update a new viewer", async () => {
  const clock = manualClock();
  const reads = [];
  let viewer = 42;
  const sources = createHoverCardSources({ clock, origin: sourceOrigin, viewer: () => viewer, fetchPage: (path, signal) => {
    const request = Promise.withResolvers();
    reads.push({ account: viewer, path, signal, ...request });
    return request.promise;
  } });
  const controller = new AbortController();
  const dismissed = sources.user(123, controller.signal, () => assert.fail("closed consumer updated"));
  await nextTurn();
  controller.abort();
  assert.equal(await dismissed, null);
  assert.ok(reads.every(({ signal }) => signal.aborted));
  assert.equal(clock.pending(), 0);
  const old = sources.user(123, undefined, () => assert.fail("old viewer updated"));
  await nextTurn();
  viewer = 43;
  const current = sources.user(123);
  await nextTurn();
  assert.equal(reads.length, 6);
  for (const read of reads) read.resolve(profileResponse(read.path, read.path.includes("/api/") ?
    { user: { uid: 123, followerCount: read.account } } : { data: { user: { uid: 123 } } }));
  assert.equal(await old, null);
  assert.equal((await current).followerCount, 43);
  assert.equal((await sources.user(123)).followerCount, 43);
});

// ---- 洛谷原生表現（全部實測取值）----
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

// owner 2026-08-14 最終拍板（★ 同日改過兩次口徑，只認這一版）：
//   <1000 無單位無小數；1000~999999 用 k 保留兩位小數；>=1000000 用 m 保留兩位小數。
//   四個呼叫點共用這一套（使用者卡通過/提交、關注、粉絲、題目卡通過/提交）。
test("计数缩写按 owner 的口径：k / m 一律两位小数", () => {
  assert.equal(abbreviateCount(0), "0");
  assert.equal(abbreviateCount(999), "999");
  assert.equal(abbreviateCount(1000), "1.00k");
  assert.equal(abbreviateCount(1234), "1.23k");
  assert.equal(abbreviateCount(259644), "259.64k");
  assert.equal(abbreviateCount(1000000), "1.00m");
  assert.equal(abbreviateCount(1234567), "1.23m");
  assert.equal(abbreviateCount(12345678), "12.34m");
  // ★ 兩位小數一位都不省 —— 舊口徑會把這個寫成 `2k`。
  assert.equal(abbreviateCount(2000), "2.00k");
  // ★ Number(null) === 0 且 isFinite(0) 為真：只判 isFinite 會把「沒有計數」變成 0。
  for (const bad of [null, undefined, "", "x", NaN])
    assert.equal(abbreviateCount(bad), null, String(bad));
});

// ★★★ owner 親自給的那個判據。它同時釘死了「截斷而不是四捨五入」：
//   四捨五入會得到 `1000.00k` —— 多一位，還翻過了 k/m 的分界線。
test("999999 是 999.99k —— 取整方式是向下截断，不是四舍五入", () => {
  assert.equal(abbreviateCount(999999), "999.99k");
  assert.notEqual(abbreviateCount(999999), "1000.00k");
  // 這條對所有值生效，不只是邊界：四捨五入會把它寫成 1.24k。
  assert.equal(abbreviateCount(1237), "1.23k");
  assert.equal(abbreviateCount(1239), "1.23k");
});

// ★★ 浮點反證。實測 1130 是最小的發散值：`1130/1000*100` 是 112.99999999999999，
//    「先除再乘」的寫法會 floor 成 1.12k。整數運算才拿得到 1.13k。
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

// 等級色是在 /discuss 上把每個使用者的 color 欄位與使用者名的 computed color 配對得到的。
test("等级色对齐实测值，未知落到 Gray", () => {
  assert.equal(levelColor("Purple"), "#9d3dcf");
  assert.equal(levelColor("Red"), "#fe4c61");
  assert.equal(levelColor("Orange"), "#f39c11");
  assert.equal(levelColor("Green"), "#52c41a");
  assert.equal(levelColor("Blue"), "#3498db");
  assert.equal(levelColor("Gray"), "#bfbfbf");
  // ★ Cheater 上一輪因為「頁面上沒遇到」而留白；2026-08-14 從 UserName 元件原文
  //   拿到了映射（yellow-4 = #ad8b00），可以照實寫了。
  assert.equal(levelColor("Cheater"), "#ad8b00");
  // ★ Red 映射到 pink-3，不是 red-3（#e74c3c）—— 按名字猜會寫錯。
  assert.notEqual(levelColor("Red"), "#e74c3c");
  for (const bad of ["", null, undefined, 1, "Rainbow"])
    assert.equal(levelColor(bad), "#bfbfbf", String(bad));
});

// ★★ 分檔與配色抄自 OiLevel / XcpcLevel 元件原文：[[8,gold],[6,blue],[3,green]]，
// **level < 3 一個圖示都不畫**。舊口徑「> 0 就顯示」是抽樣偏差（抽到的人都在 6~7 檔）。
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

// ★ 兩個圖標的著色**是反的**（元件原文），寫反了氣球會變成白底上的白氣球。
test("✅ 与 🎈 的着色互为镜像，path 逐字节抄自洛谷的 FA 块", () => {
  const ccf = ccfBadge(7);
  assert.equal(ccf.primary, "#fff", "✅ 的那一钩恒为白");
  assert.equal(ccf.secondary, "#3498db", "✅ 的盾面取等级色");
  const xcpc = xcpcBadge(7);
  assert.equal(xcpc.primary, "#3498db", "🎈 的球体取等级色");
  assert.equal(xcpc.secondary, "#fff", "🎈 的高光恒为白");
  // 長度是 2026-08-13 與 08-14 兩次獨立測得的同一組數，抄錯/截斷會當場露餡。
  assert.equal(FA_BADGE_CHECK.viewBox, "0 0 512 512");
  assert.equal(FA_BADGE_CHECK.secondary.length, 589);
  assert.equal(FA_BADGE_CHECK.primary.length, 211);
  assert.equal(FA_BALLOON.viewBox, "0 0 384 512");
  assert.equal(FA_BALLOON.secondary.length, 125);
  assert.equal(FA_BALLOON.primary.length, 320);
  for (const d of [FA_BADGE_CHECK.secondary, FA_BADGE_CHECK.primary, FA_BALLOON.secondary, FA_BALLOON.primary])
    assert.match(d, /^M[-\d]/, "path 必须以 moveto 开头");
});

// 稱號原生樣式：白字 + 等級色底 + 圓角 2px（底色跟隨使用者等級色，實測紫名使用者是紫底）。
test("称号样式跟随等级色", () => {
  const style = badgeStyle("Purple");
  assert.match(style, /background:#9d3dcf/);
  assert.match(style, /color:#fff/);
  assert.match(style, /border-radius:2px/);
});

// ★ 實測洛谷記錄列表只繪製兩種：12 → Accepted（#52c41a），其它（實測到 14）→
// Unaccepted（#e74c3c）。細分狀態的數字碼表沒取到證據，所以這裡不編細分名。
test("评测状态用洛谷原生的两种表示与配色", () => {
  const ac = statusPresentation(12);
  assert.equal(ac.label, "Accepted");
  assert.equal(ac.color, "#52c41a");
  assert.equal(ac.accepted, true);
  const no = statusPresentation(14);
  assert.equal(no.label, "Unaccepted");
  assert.equal(no.color, "#e74c3c");
  assert.equal(no.accepted, false);
  // ★ 同一個陷阱：沒有狀態時絕不能繪製成 Unaccepted ——
  // 那等於在不知情的情況下斷言使用者沒通過。
  for (const bad of [null, undefined, "", "x", NaN])
    assert.equal(statusPresentation(bad), null, String(bad));
});
