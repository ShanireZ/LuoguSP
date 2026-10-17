import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import {
  parseArticleListPayload,
  pickLiveCounts,
  resolveLiveArticleCounts,
} from "../src/features/restricted-content/article-live-counts.js";
import {
  completeRestrictedArticleInteraction,
} from "../src/features/restricted-content/article-interaction-state.js";

// 契約來源（2026-08-13 在真實登入態下實測，見 handoff/26-8-13.md）：
//   GET /user/{authorUid}/article?page=N   Header: x-lentille-request: content-only
//   → { data: { articles: { perPage: 10, count: 26, result: [ … ] } } }
//   result[i] = { lid, title, category, time, author, upvote, replyCount,
//                 favorCount, status, solutionFor, promoteStatus, collection, content }
// 受限文章 2l4x53kj 實測 upvote=24 / favorCount=22 / replyCount=50，
// 與真機點贊實測的真值 24 一致（保存站快照當時是 19 / 17）。

const LID = "2l4x53kj";
const AUTHOR = 697932;

function row(lid, extra = {}) {
  return { lid, title: `文章 ${lid}`, upvote: 1, favorCount: 2, replyCount: 3, time: 1759309175, ...extra };
}

function listPayload(rows, { perPage = 10, count = rows.length } = {}) {
  return { data: { articles: { perPage, count, result: rows } } };
}

// fetchPage 樁：按頁號回傳預置載荷，並記錄每次呼叫的 (path, init)。
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
      // 攔截頁是 HTTP 200 + text/html，`json()` 會拋。
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
  // perPage / count 缺失或非法時降級為 null，而不是編一個數字出來。
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

// ★ canary.7 踩過的坑：Number(null) === 0 且 Number.isFinite(0) 為真。
// 只判 isFinite 會把「欄位缺失」偽造成 0，再反過來蓋掉保存站的真實值。
test("upvote 或 favorCount 缺失时整体作废，绝不伪造 0", () => {
  for (const bad of [null, undefined, "", "abc", NaN]) {
    assert.equal(pickLiveCounts([row(LID, { upvote: bad })], LID), null, `upvote=${String(bad)}`);
    assert.equal(pickLiveCounts([row(LID, { favorCount: bad })], LID), null, `favorCount=${String(bad)}`);
  }
  // replyCount 允許缺失：呼叫方回落到已載入的評論條數。
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
  // 默默少掃幾頁會讓「沒找到」看起來像「洛谷沒有這條資料」。
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

// ---- 與合併層的串接 ----

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
  // 個人狀態仍然只認已確認記錄。
  assert.equal(merged.voted, 1);
  assert.equal(merged.favored, true);
});

// ★ 列表 API 不含個人狀態。就算哪天洛谷給它加上了，也不許從這條路進來 ——
// 這正是「不用 false 偽造未收藏」那條規則的延伸。
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
  // 確認記錄比存檔新 → 沿用確認計數；replyCount 保持呼叫方傳入的評論條數。
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

// ★ `?category=N` 實測生效（作者 697932：26 篇 → category=3 只剩 4 篇），
// 而保存站存檔裡就帶 category，所以掃頁前就能把搜尋空間縮小若干倍。
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

// 存檔裡的 category 可能已經過期（文章被改分類），過濾掃不到必須退回全量掃。
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

// 40 頁一次性並行發出去對洛谷不禮貌，也容易踩限流。
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

// ★ 保存站只有入檔時間；實測 2l4x53kj 入檔 2026-01-02、真實發表 2025-10-01，
// 差了三個月。把入檔時間當發表時間顯示是錯的。
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
  // 拿不到真值時保留呼叫方傳入的值，不擅自改成 0。
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

// ★ 頁數預算跨兩次嘗試共享：否則「分類過濾掃不到 → 全量掃」會把請求數翻倍。
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
  // 4 頁預算 = 兩次嘗試合計最多 4 次請求，不是每次 4 頁。
  assert.equal(calls.length, 4, calls.join(" "));
  assert.ok(calls.some((p) => p.includes("category=3")));
});

// owner 拍板接上：此前 feature.js 只能硬寫 solutionFor:null / status:2。
// 官方元件讀的是 article.solutionFor.pid（鏈到 problem.solution），
// 所以原樣透傳洛谷自己的欄位，形狀不由我們建構。
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
  // 拿不到 live 時保留呼叫方傳入的硬編碼值，不擅自改。
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

// ★ 結構守衛：`article-live-counts.js` 寫死了「截斷必須報出來 —— 默默少掃幾頁會讓
//   『沒找到』看起來像『洛谷沒有這條資料』」，而這條回呼的**唯一**生產呼叫點在
//   restricted-content/feature.js。此前那裡根本沒傳 onTruncated，截斷被靜默吞掉，
//   正好是註解禁止的那種失效。行為本身在上面已經測過，這裡只釘住「串接還在」。
test("受限文章页把 onTruncated 接了线，截断不会被静默吞掉", () => {
  const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(
    resolvePath(root, "src/features/restricted-content/feature.js"),
    "utf8",
  );
  const start = source.indexOf("resolveLiveArticleCounts({");
  assert.notEqual(start, -1, "找不到 resolveLiveArticleCounts 的调用");
  const call = [source.slice(start, source.indexOf("}),", start))];
  assert.match(
    call[0],
    /onTruncated:/,
    "resolveLiveArticleCounts 必须接 onTruncated —— 否则截断会被静默吞掉",
  );
});
