// 受限文章的实时公共计数。
//
// 洛谷把「文章页」拦在「安全访问中心」后面，但**作者专栏列表 API 没有拦**：
//   GET /user/{authorUid}/article?page=N   Header: x-lentille-request: content-only
//   → data.articles = { perPage, count, result[] }，每项带 upvote / favorCount / replyCount
// 2026-08-13 实测（登录态）：受限文章 2l4x53kj 在列表里 upvote=24 / favorCount=22，
// 与真机点赞实测的真值 24 一致；同一时刻保存站快照是 19 / 17。所以这里的值可以直接
// 当服务器真值，用作后续官方写响应做增量的基线。
//
// ★ 只覆盖公共计数。列表**不含** voted / favored，个人状态一个字节都不能从这里来 ——
//   否则又会走回「用 false 伪造未收藏」那条老路。
// ★ 列表不按时间排序（实测跨页时间乱序），所以只能扫页，不能二分；
//   perPage 固定 10，?perPage=50 无效。

const LENTILLE_INIT = Object.freeze({
  headers: Object.freeze({ "x-lentille-request": "content-only" }),
});
// `?category=N` 实测生效（作者 697932：26 篇 → category=3 只剩 4 篇），而保存站的
// 存档里就带 `category`，所以扫页前就能把搜索空间缩小若干倍。`?keyword=` 实测**无效**
// （结果集不变），别指望它。
const DEFAULT_MAX_PAGES = 40;
const DEFAULT_CONCURRENCY = 5;
// ★ 这个预算直接压在受限页的首屏上（它和骨架抓取、作者查询、评论并行，
// 但总时长取最大值）。实测单页 ~600ms，分类过滤后常见情况就是 1 页，
// 2.5s 够覆盖三四批；再长就是拿所有人的首屏去赌一个罕见的巨型专栏，不值。
const DEFAULT_DEADLINE_MS = 2500;
const FALLBACK_PER_PAGE = 10;
const DEFAULT_CLOCK = Object.freeze({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

// ★同 article-interaction-store：Number(null) === 0 且 Number.isFinite(0) 为真，
// 只判 isFinite 会把「列表里没有这个字段」悄悄变成 0，再反过来盖掉保存站的真实值。
const countOrNull = (value) =>
  value === null || value === undefined || value === "" ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);

export function parseArticleListPayload(payload) {
  const box = payload && payload.data && payload.data.articles;
  if (!box || typeof box !== "object" || Array.isArray(box)) return null;
  if (!Array.isArray(box.result)) return null;
  const perPage = Number(box.perPage);
  const count = Number(box.count);
  return Object.freeze({
    perPage: Number.isSafeInteger(perPage) && perPage > 0 ? perPage : null,
    count: Number.isSafeInteger(count) && count >= 0 ? count : null,
    result: box.result,
  });
}

// 命中项 → 公共计数 + 真实发表时间。`upvote` / `favorCount` 缺一不可（它们是这个特性的
// 全部意义）；`replyCount` 与 `time` 允许缺失，调用方回落。
//
// ★ `time` 是**洛谷的真实发表时间**（秒）。保存站只有 `createdAt`＝入档时间，
//   两者可以差几个月（实测 2l4x53kj：入档 2026-01-02，真实发表 2025-10-01），
//   此前把入档时间当「创建时间」显示是错的。
export function pickLiveCounts(rows, lid) {
  if (!Array.isArray(rows) || typeof lid !== "string" || !lid) return null;
  const hit = rows.find((row) => row && row.lid === lid);
  if (!hit) return null;
  const upvote = countOrNull(hit.upvote);
  const favorCount = countOrNull(hit.favorCount);
  if (upvote === null || favorCount === null) return null;
  const time = countOrNull(hit.time);
  return Object.freeze({
    upvote,
    favorCount,
    replyCount: countOrNull(hit.replyCount),
    time: time !== null && time > 0 ? time : null,
    status: countOrNull(hit.status),
    // 原样透传：形状由洛谷决定（官方组件读 solutionFor.pid），这里不构造也不猜。
    solutionFor:
      hit.solutionFor && typeof hit.solutionFor === "object"
        ? hit.solutionFor
        : null,
  });
}

function withDeadline(promise, ms, clock) {
  const budget = Number(ms);
  if (!Number.isFinite(budget) || budget <= 0) return promise;
  return new Promise((resolve) => {
    let settled = false;
    // 超时后在途请求不再等待。它们数量有上限（maxPages），放着自然结束即可，
    // 页面级取消由外层 signal 负责。
    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, budget);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      resolve(value);
    };
    promise.then(finish, () => finish(null));
  });
}

// 永不抛、永不拒绝：拿不到实时计数就返回 null，调用方回落保存站快照。
// 实时计数是增强项，任何失败都不允许影响受限页本身能不能渲染出来。
export function resolveLiveArticleCounts(config) {
  const {
    fetchPage,
    authorUid,
    lid,
    category,
    maxPages = DEFAULT_MAX_PAGES,
    concurrency = DEFAULT_CONCURRENCY,
    deadlineMs = DEFAULT_DEADLINE_MS,
    // ★ 必须包一层，不能写 `{ setTimeout, clearTimeout }` 简写。裸引用会让
    //   `clock.setTimeout(...)` 以 `this === clock` 调用原生方法 —— 在**页面 realm**
    //   （本模块随受限内容按需块经 blob: 动态 import 执行）里就是
    //   `TypeError: Illegal invocation`。在用户脚本沙箱里侥幸能过，一挪进按需块就炸。
    clock = DEFAULT_CLOCK,
    signal,
    onTruncated,
  } = config || {};
  const uid = Number(authorUid);
  if (
    typeof fetchPage !== "function" ||
    !Number.isSafeInteger(uid) ||
    uid <= 0 ||
    typeof lid !== "string" ||
    !/^[A-Za-z0-9]+$/.test(lid)
  )
    return Promise.resolve(null);

  const cat = Number(category);
  const filter =
    Number.isSafeInteger(cat) && cat > 0 ? `&category=${cat}` : "";

  // ★ 页数预算是**跨两次尝试共享**的。否则「分类过滤扫不到 → 全量扫」这条回退路径
  // 会把请求数翻倍（巨型专栏可达 40+40 页），对洛谷不礼貌。
  let pagesLeft = Math.max(1, Number(maxPages) || 1);

  const readPage = async (page, query) => {
    if (pagesLeft <= 0) return null;
    pagesLeft -= 1;
    try {
      const response = await fetchPage(
        `/user/${uid}/article?page=${page}${query}`,
        signal,
        LENTILLE_INIT,
      );
      // 拦截页是 HTTP 200 + text/html，`json()` 会抛 —— 这就是天然的守卫。
      if (!response || response.ok === false) return null;
      return parseArticleListPayload(await response.json());
    } catch (error) {
      return null;
    }
  };

  // 分批并发：40 页一次性并发发出去对洛谷不礼貌，也容易踩限流。
  const sweep = async (first, query) => {
    const perPage = first.perPage || first.result.length || FALLBACK_PER_PAGE;
    const total = first.count === null ? 1 : Math.ceil(first.count / perPage);
    if (total <= 1) return null;
    const limit = Math.min(total, pagesLeft + 1);
    // 截断必须报出来：默默少扫几页会让「没找到」看起来像「洛谷没有这条数据」。
    if (total > limit && typeof onTruncated === "function")
      onTruncated({
        lid,
        totalPages: total,
        scannedPages: limit,
        category: query ? cat : null,
      });
    const step = Math.max(1, Number(concurrency) || 1);
    for (let start = 2; start <= limit; start += step) {
      const batch = await Promise.all(
        Array.from(
          { length: Math.min(step, limit - start + 1) },
          (unused, index) => readPage(start + index, query),
        ),
      );
      for (const page of batch) {
        if (!page) continue;
        const hit = pickLiveCounts(page.result, lid);
        if (hit) return hit;
      }
    }
    return null;
  };

  const attempt = async (query) => {
    const first = await readPage(1, query);
    if (!first) return null;
    return pickLiveCounts(first.result, lid) ?? (await sweep(first, query));
  };

  const scan = async () => {
    // 先按分类过滤扫（保存站给了 category，搜索空间小很多）；
    // 分类过滤扫不到就退回全量扫 —— 存档的 category 可能已经过期（文章被改分类）。
    const filtered = filter ? await attempt(filter) : null;
    return filtered ?? (await attempt(""));
  };

  return withDeadline(
    scan().catch(() => null),
    deadlineMs,
    clock && typeof clock.setTimeout === "function"
      ? clock
      : DEFAULT_CLOCK,
  );
}
