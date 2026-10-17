// 受限文章的即時公共計數。
//
// 洛谷把「文章頁」攔在「安全訪問中心」後面，但**作者專欄列表 API 沒有攔**：
//   GET /user/{authorUid}/article?page=N   Header: x-lentille-request: content-only
//   → data.articles = { perPage, count, result[] }，每項帶 upvote / favorCount / replyCount
// 2026-08-13 實測（登入態）：受限文章 2l4x53kj 在列表裡 upvote=24 / favorCount=22，
// 與真機點贊實測的真值 24 一致；同一時刻保存站快照是 19 / 17。所以這裡的值可以直接
// 當伺服器真值，用作後續官方寫回應做增量的基線。
//
// ★ 只覆蓋公共計數。列表**不含** voted / favored，個人狀態一個位元組都不能從這裡來 ——
//   否則又會走回「用 false 偽造未收藏」那條老路。
// ★ 列表不按時間排序（實測跨頁時間亂序），所以只能掃頁，不能二分；
//   perPage 固定 10，?perPage=50 無效。

const LENTILLE_INIT = Object.freeze({
  headers: Object.freeze({ "x-lentille-request": "content-only" }),
});
// `?category=N` 實測生效（作者 697932：26 篇 → category=3 只剩 4 篇），而保存站的
// 存檔裡就帶 `category`，所以掃頁前就能把搜尋空間縮小若干倍。`?keyword=` 實測**無效**
// （結果集不變），別指望它。
const DEFAULT_MAX_PAGES = 40;
const DEFAULT_CONCURRENCY = 5;
// ★ 這個預算直接壓在受限頁的首屏上（它和骨架抓取、作者查詢、評論並行，
// 但總時長取最大值）。實測單頁 ~600ms，分類過濾後常見情況就是 1 頁，
// 2.5s 夠覆蓋三四批；再長就是拿所有人的首屏去賭一個罕見的巨型專欄，不值。
const DEFAULT_DEADLINE_MS = 2500;
const FALLBACK_PER_PAGE = 10;
const DEFAULT_CLOCK = Object.freeze({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

// ★同 article-interaction-store：Number(null) === 0 且 Number.isFinite(0) 為真，
// 只判 isFinite 會把「列表裡沒有這個欄位」悄悄變成 0，再反過來蓋掉保存站的真實值。
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

// 命中項 → 公共計數 + 真實發表時間。`upvote` / `favorCount` 缺一不可（它們是這個特性的
// 全部意義）；`replyCount` 與 `time` 允許缺失，呼叫方回落。
//
// ★ `time` 是**洛谷的真實發表時間**（秒）。保存站只有 `createdAt`＝入檔時間，
//   兩者可以差幾個月（實測 2l4x53kj：入檔 2026-01-02，真實發表 2025-10-01），
//   此前把入檔時間當「建立時間」顯示是錯的。
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
    // 原樣透傳：形狀由洛谷決定（官方元件讀 solutionFor.pid），這裡不建構也不猜。
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
    // 超時後在途請求不再等待。它們數量有上限（maxPages），放著自然結束即可，
    // 頁面級取消由外層 signal 負責。
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

// 永不拋、永不拒絕：拿不到即時計數就回傳 null，呼叫方回落保存站快照。
// 即時計數是增強項，任何失敗都不允許影響受限頁本身能不能繪製出來。
export function resolveLiveArticleCounts(config) {
  const {
    fetchPage,
    authorUid,
    lid,
    category,
    maxPages = DEFAULT_MAX_PAGES,
    concurrency = DEFAULT_CONCURRENCY,
    deadlineMs = DEFAULT_DEADLINE_MS,
    // ★ 必須包一層，不能寫 `{ setTimeout, clearTimeout }` 簡寫。裸引用會讓
    //   `clock.setTimeout(...)` 以 `this === clock` 呼叫原生方法 —— 在**頁面 realm**
    //   （本模組隨受限內容按需塊經 blob: 動態 import 執行）裡就是
    //   `TypeError: Illegal invocation`。在使用者指令碼沙箱裡僥倖能過，一挪進按需塊就炸。
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

  // ★ 頁數預算是**跨兩次嘗試共享**的。否則「分類過濾掃不到 → 全量掃」這條退回路徑
  // 會把請求數翻倍（巨型專欄可達 40+40 頁），對洛谷不禮貌。
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
      // 攔截頁是 HTTP 200 + text/html，`json()` 會拋 —— 這就是天然的守衛。
      if (!response || response.ok === false) return null;
      return parseArticleListPayload(await response.json());
    } catch (error) {
      return null;
    }
  };

  // 分批並行：40 頁一次性並行發出去對洛谷不禮貌，也容易踩限流。
  const sweep = async (first, query) => {
    const perPage = first.perPage || first.result.length || FALLBACK_PER_PAGE;
    const total = first.count === null ? 1 : Math.ceil(first.count / perPage);
    if (total <= 1) return null;
    const limit = Math.min(total, pagesLeft + 1);
    // 截斷必須報出來：默默少掃幾頁會讓「沒找到」看起來像「洛谷沒有這條資料」。
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
    // 先按分類過濾掃（保存站給了 category，搜尋空間小很多）；
    // 分類過濾掃不到就退回全量掃 —— 存檔的 category 可能已經過期（文章被改分類）。
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
