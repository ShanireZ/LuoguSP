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
const DEFAULT_MAX_PAGES = 6;
const DEFAULT_DEADLINE_MS = 4000;
const FALLBACK_PER_PAGE = 10;

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

// 命中项 → 三个公共计数。`upvote` / `favorCount` 缺一不可（它们是这个特性的全部意义）；
// `replyCount` 允许缺失，调用方回落到已加载的评论条数。
export function pickLiveCounts(rows, lid) {
  if (!Array.isArray(rows) || typeof lid !== "string" || !lid) return null;
  const hit = rows.find((row) => row && row.lid === lid);
  if (!hit) return null;
  const upvote = countOrNull(hit.upvote);
  const favorCount = countOrNull(hit.favorCount);
  if (upvote === null || favorCount === null) return null;
  return Object.freeze({
    upvote,
    favorCount,
    replyCount: countOrNull(hit.replyCount),
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
    maxPages = DEFAULT_MAX_PAGES,
    deadlineMs = DEFAULT_DEADLINE_MS,
    clock = { setTimeout, clearTimeout },
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

  const readPage = async (page) => {
    try {
      const response = await fetchPage(
        `/user/${uid}/article?page=${page}`,
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

  const scan = async () => {
    const first = await readPage(1);
    if (!first) return null;
    const found = pickLiveCounts(first.result, lid);
    if (found) return found;
    const perPage = first.perPage || first.result.length || FALLBACK_PER_PAGE;
    const total = first.count === null ? 1 : Math.ceil(first.count / perPage);
    if (total <= 1) return null;
    const limit = Math.min(total, Math.max(1, Number(maxPages) || 1));
    // 截断必须报出来：默默少扫几页会让「没找到」看起来像「洛谷没有这条数据」。
    if (total > limit && typeof onTruncated === "function")
      onTruncated({ lid, totalPages: total, scannedPages: limit });
    const rest = await Promise.all(
      Array.from({ length: limit - 1 }, (unused, index) =>
        readPage(index + 2),
      ),
    );
    for (const page of rest) {
      if (!page) continue;
      const hit = pickLiveCounts(page.result, lid);
      if (hit) return hit;
    }
    return null;
  };

  return withDeadline(
    scan().catch(() => null),
    deadlineMs,
    clock && typeof clock.setTimeout === "function"
      ? clock
      : { setTimeout, clearTimeout },
  );
}
