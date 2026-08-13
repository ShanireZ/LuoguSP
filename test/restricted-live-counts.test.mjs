import test from "node:test";
import assert from "node:assert/strict";
import {
  parseArticleListPayload,
  pickLiveCounts,
  resolveLiveArticleCounts,
} from "../src/features/restricted-content/article-live-counts.js";
import {
  completeRestrictedArticleInteraction,
} from "../src/features/restricted-content/article-interaction-state.js";

// 契约来源（2026-08-13 在真实登录态下实测，见 handoff/26-8-13.md）：
//   GET /user/{authorUid}/article?page=N   Header: x-lentille-request: content-only
//   → { data: { articles: { perPage: 10, count: 26, result: [ … ] } } }
//   result[i] = { lid, title, category, time, author, upvote, replyCount,
//                 favorCount, status, solutionFor, promoteStatus, collection, content }
// 受限文章 2l4x53kj 实测 upvote=24 / favorCount=22 / replyCount=50，
// 与真机点赞实测的真值 24 一致（保存站快照当时是 19 / 17）。

const LID = "2l4x53kj";
const AUTHOR = 697932;

function row(lid, extra = {}) {
  return { lid, title: `文章 ${lid}`, upvote: 1, favorCount: 2, replyCount: 3, time: 1759309175, ...extra };
}

function listPayload(rows, { perPage = 10, count = rows.length } = {}) {
  return { data: { articles: { perPage, count, result: rows } } };
}

// fetchPage 桩：按页号返回预置载荷，并记录每次调用的 (path, init)。
function stubFetch(pages, options = {}) {
  const calls = [];
  const fetchPage = (path, signal, init) => {
    calls.push({ path, init });
    if (options.throwOn === path) return Promise.reject(new Error("boom"));
    if (options.never) return new Promise(() => {});
    const page = Number((path.match(/page=(\d+)/) || [])[1]);
    const entry = pages[page];
    if (entry === undefined) return Promise.resolve({ ok: false });
    if (entry === "waf")
      // 拦截页是 HTTP 200 + text/html，`json()` 会抛。
      return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token <")) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(entry) });
  };
  return { fetchPage, calls };
}

function manualClock() {
  const timers = new Map();
  let seq = 0;
  return {
    setTimeout: (fn) => {
      const id = ++seq;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => void timers.delete(id),
    fireAll: () => {
      const fns = [...timers.values()];
      timers.clear();
      for (const fn of fns) fn();
    },
    pending: () => timers.size,
  };
}

const resolve = (fetchPage, extra = {}) =>
  resolveLiveArticleCounts({
    fetchPage,
    authorUid: AUTHOR,
    lid: LID,
    clock: manualClock(),
    ...extra,
  });

test("载荷解析只接受 data.articles.result 是数组的形状", () => {
  assert.deepEqual(parseArticleListPayload(listPayload([row(LID)])).result.length, 1);
  assert.equal(parseArticleListPayload(null), null);
  assert.equal(parseArticleListPayload({ data: {} }), null);
  assert.equal(parseArticleListPayload({ data: { articles: [] } }), null);
  assert.equal(parseArticleListPayload({ data: { articles: { result: {} } } }), null);
  // perPage / count 缺失或非法时降级为 null，而不是编一个数字出来。
  const loose = parseArticleListPayload({ data: { articles: { result: [], perPage: "x", count: -1 } } });
  assert.equal(loose.perPage, null);
  assert.equal(loose.count, null);
});

test("命中项取三个计数；0 是合法计数，不是缺失", () => {
  assert.deepEqual(pickLiveCounts([row(LID, { upvote: 24, favorCount: 22, replyCount: 50 })], LID), {
    upvote: 24,
    favorCount: 22,
    replyCount: 50,
    time: 1759309175,
    status: null,
    solutionFor: null,
  });
  assert.deepEqual(pickLiveCounts([row(LID, { upvote: 0, favorCount: 0, replyCount: 0 })], LID), {
    upvote: 0,
    favorCount: 0,
    replyCount: 0,
    time: 1759309175,
    status: null,
    solutionFor: null,
  });
});

// ★ canary.7 踩过的坑：Number(null) === 0 且 Number.isFinite(0) 为真。
// 只判 isFinite 会把「字段缺失」伪造成 0，再反过来盖掉保存站的真实值。
test("upvote 或 favorCount 缺失时整体作废，绝不伪造 0", () => {
  for (const bad of [null, undefined, "", "abc", NaN]) {
    assert.equal(pickLiveCounts([row(LID, { upvote: bad })], LID), null, `upvote=${String(bad)}`);
    assert.equal(pickLiveCounts([row(LID, { favorCount: bad })], LID), null, `favorCount=${String(bad)}`);
  }
  // replyCount 允许缺失：调用方回落到已加载的评论条数。
  assert.deepEqual(pickLiveCounts([row(LID, { replyCount: null })], LID), {
    upvote: 1,
    favorCount: 2,
    replyCount: null,
    time: 1759309175,
    status: null,
    solutionFor: null,
  });
});

test("lid 不在列表里就是没有，不返回别人的计数", () => {
  assert.equal(pickLiveCounts([row("other")], LID), null);
  assert.equal(pickLiveCounts([], LID), null);
  assert.equal(pickLiveCounts(null, LID), null);
});

test("第一页命中时只发一次请求，且路径与 header 符合契约", async () => {
  const { fetchPage, calls } = stubFetch({
    1: listPayload([row("a"), row(LID, { upvote: 24, favorCount: 22, replyCount: 50 })]),
  });
  assert.deepEqual(await resolve(fetchPage), { upvote: 24, favorCount: 22, replyCount: 50, time: 1759309175, status: null, solutionFor: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/user/${AUTHOR}/article?page=1`);
  assert.equal(calls[0].init.headers["x-lentille-request"], "content-only");
});

test("首页未命中时按 count 并行扫剩余页", async () => {
  const { fetchPage, calls } = stubFetch({
    1: listPayload(Array.from({ length: 10 }, (u, i) => row(`p1-${i}`)), { count: 26 }),
    2: listPayload(Array.from({ length: 10 }, (u, i) => row(`p2-${i}`)), { count: 26 }),
    3: listPayload([row(LID, { upvote: 24, favorCount: 22, replyCount: 50 })], { count: 26 }),
  });
  assert.deepEqual(await resolve(fetchPage), { upvote: 24, favorCount: 22, replyCount: 50, time: 1759309175, status: null, solutionFor: null });
  assert.deepEqual(
    calls.map((c) => c.path),
    [1, 2, 3].map((p) => `/user/${AUTHOR}/article?page=${p}`),
  );
});

test("列表页数超出上限时只扫前 N 页，并把截断报出来", async () => {
  const truncations = [];
  const { fetchPage, calls } = stubFetch({
    1: listPayload([row("x")], { perPage: 10, count: 500 }),
    2: listPayload([row("y")], { perPage: 10, count: 500 }),
    3: listPayload([row("z")], { perPage: 10, count: 500 }),
  });
  const result = await resolve(fetchPage, {
    maxPages: 3,
    onTruncated: (info) => truncations.push(info),
  });
  assert.equal(result, null);
  assert.equal(calls.length, 3);
  // 默默少扫几页会让「没找到」看起来像「洛谷没有这条数据」。
  assert.deepEqual(truncations, [
    { lid: LID, totalPages: 50, scannedPages: 3, category: null },
  ]);
});

test("拦截页 / 网络错误 / 形状漂移都降级为 null，不抛", async () => {
  for (const pages of [{ 1: "waf" }, {}, { 1: { data: {} } }]) {
    const { fetchPage } = stubFetch(pages);
    assert.equal(await resolve(fetchPage), null);
  }
  const { fetchPage } = stubFetch({}, { throwOn: `/user/${AUTHOR}/article?page=1` });
  assert.equal(await resolve(fetchPage), null);
});

test("超过时间预算就放弃，不拖住受限页渲染", async () => {
  const clock = manualClock();
  const { fetchPage } = stubFetch({}, { never: true });
  const pending = resolveLiveArticleCounts({
    fetchPage,
    authorUid: AUTHOR,
    lid: LID,
    clock,
    deadlineMs: 4000,
  });
  assert.equal(clock.pending(), 1);
  clock.fireAll();
  assert.equal(await pending, null);
});

test("作者 uid 或 lid 非法时一次请求都不发", async () => {
  for (const bad of [{ authorUid: 0 }, { authorUid: -1 }, { authorUid: "x" }, { authorUid: 1.5 }, { lid: "" }, { lid: "a/b" }, { lid: 12 }]) {
    const { fetchPage, calls } = stubFetch({ 1: listPayload([row(LID)]) });
    assert.equal(await resolve(fetchPage, bad), null, JSON.stringify(bad));
    assert.equal(calls.length, 0, JSON.stringify(bad));
  }
  assert.equal(await resolveLiveArticleCounts({ authorUid: AUTHOR, lid: LID }), null);
  assert.equal(await resolveLiveArticleCounts(), null);
});

// ---- 与合并层的接线 ----

const archivedArticle = { lid: LID, upvote: 19, favorCount: 17, replyCount: 45 };

test("实时计数无条件压过已确认记录的计数（后者只是更早的一次写响应）", () => {
  const merged = completeRestrictedArticleInteraction({
    article: { ...archivedArticle },
    archived: { upvote: 19, favorCount: 17 },
    archivedAt: 1_700_000_000_000,
    viewer: { uid: 1313427 },
    confirmed: { voted: 1, favored: true, upvote: 20, favorCount: 18, at: 1_800_000_000_000 },
    live: { upvote: 24, favorCount: 22, replyCount: 50 },
  });
  assert.equal(merged.article.upvote, 24);
  assert.equal(merged.article.favorCount, 22);
  assert.equal(merged.article.replyCount, 50);
  // 个人状态仍然只认已确认记录。
  assert.equal(merged.voted, 1);
  assert.equal(merged.favored, true);
});

// ★ 列表 API 不含个人状态。就算哪天洛谷给它加上了，也不许从这条路进来 ——
// 这正是「不用 false 伪造未收藏」那条规则的延伸。
test("live 里即使带了个人状态也不得泄漏进结果", () => {
  const merged = completeRestrictedArticleInteraction({
    article: { ...archivedArticle },
    archived: {},
    archivedAt: null,
    viewer: { uid: 1313427 },
    confirmed: null,
    live: { upvote: 24, favorCount: 22, replyCount: 50, voted: 1, favored: true },
  });
  assert.equal(merged.voted, null);
  assert.equal(merged.favored, null);
  assert.equal(merged.article.voted, null);
  assert.equal(merged.article.upvote, 24);
});

test("拿不到实时计数时行为与改动前完全一致", () => {
  const base = {
    article: { ...archivedArticle },
    archived: { upvote: 19, favorCount: 17 },
    archivedAt: 1_700_000_000_000,
    viewer: { uid: 1313427 },
    confirmed: { voted: 1, favored: true, upvote: 20, favorCount: 18, at: 1_800_000_000_000 },
  };
  const withoutLive = completeRestrictedArticleInteraction(base);
  const withNullLive = completeRestrictedArticleInteraction({ ...base, live: null });
  assert.deepEqual(withNullLive, withoutLive);
  // 确认记录比存档新 → 沿用确认计数；replyCount 保持调用方传入的评论条数。
  assert.equal(withoutLive.article.upvote, 20);
  assert.equal(withoutLive.article.favorCount, 18);
  assert.equal(withoutLive.article.replyCount, 45);
});

test("实时计数为 0 时也要覆盖存档的非零值", () => {
  const merged = completeRestrictedArticleInteraction({
    article: { ...archivedArticle },
    archived: { upvote: 19, favorCount: 17 },
    archivedAt: null,
    viewer: null,
    confirmed: null,
    live: { upvote: 0, favorCount: 0, replyCount: 0 },
  });
  assert.equal(merged.article.upvote, 0);
  assert.equal(merged.article.favorCount, 0);
  assert.equal(merged.article.replyCount, 0);
});

test("live 缺 replyCount 时保留调用方传入的评论条数", () => {
  const merged = completeRestrictedArticleInteraction({
    article: { ...archivedArticle },
    archived: {},
    archivedAt: null,
    viewer: null,
    confirmed: null,
    live: { upvote: 24, favorCount: 22, replyCount: null },
  });
  assert.equal(merged.article.replyCount, 45);
  assert.equal(merged.article.upvote, 24);
});

// ★ `?category=N` 实测生效（作者 697932：26 篇 → category=3 只剩 4 篇），
// 而保存站存档里就带 category，所以扫页前就能把搜索空间缩小若干倍。
test("给了分类就带 category 过滤扫，命中后不再全量扫", async () => {
  const { fetchPage, calls } = stubFetch({
    1: listPayload([row(LID, { upvote: 24, favorCount: 22, replyCount: 50 })], { count: 4 }),
  });
  assert.deepEqual(await resolve(fetchPage, { category: 3 }), {
    upvote: 24,
    favorCount: 22,
    replyCount: 50,
    time: 1759309175,
    status: null,
    solutionFor: null,
  });
  assert.deepEqual(calls.map((c) => c.path), [
    `/user/${AUTHOR}/article?page=1&category=3`,
  ]);
});

// 存档里的 category 可能已经过期（文章被改分类），过滤扫不到必须退回全量扫。
test("分类过滤扫不到时退回全量扫", async () => {
  const calls = [];
  const fetchPage = (path, signal, init) => {
    calls.push(path);
    const filtered = path.includes("category=");
    const payload = filtered
      ? listPayload([row("别的文章")], { count: 1 })
      : listPayload([row(LID, { upvote: 24, favorCount: 22 })], { count: 1 });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  };
  const hit = await resolve(fetchPage, { category: 3 });
  assert.equal(hit.upvote, 24);
  assert.deepEqual(calls, [
    `/user/${AUTHOR}/article?page=1&category=3`,
    `/user/${AUTHOR}/article?page=1`,
  ]);
});

test("非法分类不进 URL", async () => {
  for (const bad of [0, -1, "x", null, 1.5]) {
    const { fetchPage, calls } = stubFetch({ 1: listPayload([row(LID)]) });
    await resolve(fetchPage, { category: bad });
    assert.equal(calls[0].path, `/user/${AUTHOR}/article?page=1`, String(bad));
  }
});

// 40 页一次性并发发出去对洛谷不礼貌，也容易踩限流。
test("剩余页按并发上限分批，不是一次性全撒出去", async () => {
  const inFlight = { now: 0, peak: 0 };
  const pages = {};
  for (let p = 1; p <= 9; p++) pages[p] = listPayload([row(`p${p}`)], { perPage: 1, count: 9 });
  pages[9] = listPayload([row(LID, { upvote: 24, favorCount: 22 })], { perPage: 1, count: 9 });
  const fetchPage = (path) => {
    inFlight.now += 1;
    inFlight.peak = Math.max(inFlight.peak, inFlight.now);
    const page = Number((path.match(/page=(\d+)/) || [])[1]);
    return new Promise((done) =>
      setTimeout(() => {
        inFlight.now -= 1;
        done({ ok: true, json: () => Promise.resolve(pages[page]) });
      }, 1),
    );
  };
  const hit = await resolve(fetchPage, { concurrency: 3, deadlineMs: 0 });
  assert.equal(hit.upvote, 24);
  assert.ok(inFlight.peak <= 3, `峰值并发 ${inFlight.peak} 应当 <= 3`);
});

// ★ 保存站只有入档时间；实测 2l4x53kj 入档 2026-01-02、真实发表 2025-10-01，
// 差了三个月。把入档时间当发表时间显示是错的。
test("发表时间取 live 真值；缺失或非正数则留 null", () => {
  assert.equal(pickLiveCounts([row(LID, { time: 1759309175 })], LID).time, 1759309175);
  for (const bad of [null, undefined, "", 0, -1, "abc"])
    assert.equal(pickLiveCounts([row(LID, { time: bad })], LID).time, null, String(bad));
});

test("合并层用 live 的发表时间覆盖存档入档时间", () => {
  const archivedSeconds = Math.floor(Date.parse("2026-01-02T09:12:59.895Z") / 1000);
  const merged = completeRestrictedArticleInteraction({
    article: { ...archivedArticle, time: archivedSeconds },
    archived: {},
    archivedAt: null,
    viewer: null,
    confirmed: null,
    live: { upvote: 24, favorCount: 22, replyCount: 50, time: 1759309175 },
  });
  assert.equal(merged.article.time, 1759309175);
  // 拿不到真值时保留调用方传入的值，不擅自改成 0。
  const fallback = completeRestrictedArticleInteraction({
    article: { ...archivedArticle, time: archivedSeconds },
    archived: {},
    archivedAt: null,
    viewer: null,
    confirmed: null,
    live: { upvote: 24, favorCount: 22, replyCount: 50, time: null },
  });
  assert.equal(fallback.article.time, archivedSeconds);
});

// ★ 页数预算跨两次尝试共享：否则「分类过滤扫不到 → 全量扫」会把请求数翻倍。
test("分类回退不得让请求数翻倍：页数预算跨尝试共享", async () => {
  const calls = [];
  const fetchPage = (path) => {
    calls.push(path);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(listPayload([row(`x${calls.length}`)], { perPage: 1, count: 500 })),
    });
  };
  const result = await resolve(fetchPage, { category: 3, maxPages: 4, concurrency: 2 });
  assert.equal(result, null);
  // 4 页预算 = 两次尝试合计最多 4 次请求，不是每次 4 页。
  assert.equal(calls.length, 4, calls.join(" "));
  assert.ok(calls.some((p) => p.includes("category=3")));
});

// owner 拍板接上：此前 feature.js 只能硬写 solutionFor:null / status:2。
// 官方组件读的是 article.solutionFor.pid（链到 problem.solution），
// 所以原样透传洛谷自己的字段，形状不由我们构造。
test("题解归属与审核状态原样透传，非对象的 solutionFor 一律作废", () => {
  const sol = { pid: "P3372", title: "【模板】线段树 1" };
  const hit = pickLiveCounts([row(LID, { status: 2, solutionFor: sol })], LID);
  assert.equal(hit.status, 2);
  assert.deepEqual(hit.solutionFor, sol);
  for (const bad of [null, undefined, "P3372", 0, true])
    assert.equal(pickLiveCounts([row(LID, { solutionFor: bad })], LID).solutionFor, null, String(bad));
});

test("合并层把 solutionFor 与 status 覆盖到官方 article 上", () => {
  const sol = { pid: "P3372" };
  const merged = completeRestrictedArticleInteraction({
    article: { ...archivedArticle, status: 2, solutionFor: null },
    archived: {},
    archivedAt: null,
    viewer: null,
    confirmed: null,
    live: { upvote: 24, favorCount: 22, status: 3, solutionFor: sol },
  });
  assert.equal(merged.article.status, 3);
  assert.deepEqual(merged.article.solutionFor, sol);
  // 拿不到 live 时保留调用方传入的硬编码值，不擅自改。
  const fallback = completeRestrictedArticleInteraction({
    article: { ...archivedArticle, status: 2, solutionFor: null },
    archived: {},
    archivedAt: null,
    viewer: null,
    confirmed: null,
    live: null,
  });
  assert.equal(fallback.article.status, 2);
  assert.equal(fallback.article.solutionFor, null);
});
