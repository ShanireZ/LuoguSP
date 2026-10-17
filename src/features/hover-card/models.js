import { difficultyColor, difficultyName } from "./difficulty.js";

// 把洛谷各介面的原始載荷翻譯成卡片視圖模型。純函式，不碰 DOM 不發請求。
//
// 資料來源與實證見 handoff/26-8-13.md。這裡只重複三條最容易被寫錯的：
//   1. `problem.tags` 是**數字 id**，必須配 `/_lfe/tags` 字典；字典裡**沒有難度**
//      （6 個 type 全是 Region/Algorithm/Origin/Time/SpecialProblem/Others）。
//   2. 使用者的 `elo` 真資料在**頂層 `data.elo`**；`user.elo` / `user.eloValue` 恆為 null。
//   3. `user.verified` **只在看自己時回傳**，且與頁面上的 ✅ 無關 ——
//      ✅ 由 `ccfLevel > 0` 驅動，氣球由 `xcpcLevel > 0` 驅動（41 使用者雙向零反例）。

const numberOrNull = (value) =>
  value === null || value === undefined || value === "" ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);

const boolOrNull = (value) => (typeof value === "boolean" ? value : null);

// 通過率。分母為 0 時是「還沒人交過」，不是 0% —— 別顯示成 0%。
export function acceptanceRate(accepted, submitted) {
  const a = numberOrNull(accepted);
  const s = numberOrNull(submitted);
  if (a === null || s === null || s <= 0) return null;
  return Math.round((a / s) * 1000) / 10;
}

export function buildTagDictionary(payload) {
  const tags = payload && Array.isArray(payload.tags) ? payload.tags : null;
  if (!tags) return null;
  const names = new Map();
  for (const tag of tags) {
    const id = numberOrNull(tag && tag.id);
    if (id === null || typeof tag.name !== "string" || !tag.name) continue;
    names.set(id, tag.name);
  }
  if (!names.size) return null;
  return Object.freeze({
    version: numberOrNull(payload.version),
    // 認不出的 id 一律丟掉，不顯示「標籤 523」這種對使用者毫無意義的東西。
    resolve: (ids) =>
      (Array.isArray(ids) ? ids : [])
        .map((id) => names.get(numberOrNull(id)))
        .filter((name) => typeof name === "string" && name),
  });
}

// 上次嘗試：來自舊版 `/record/list` 頁面的 `_feInjection.currentData.records`。
// ★ 不能用 problem detail 的 `lastCodeAt` 代替 —— 那是 IDE 裡最後保存程式碼的時間，
//   不是最後一次提交（兩者數值可能恰好相同，語義不同）。
export function pickLastAttempt(records) {
  const rows = Array.isArray(records)
    ? records
    : records && Array.isArray(records.result)
      ? records.result
      : null;
  if (!rows || !rows.length) return null;
  let best = null;
  for (const row of rows) {
    const at = numberOrNull(row && row.submitTime);
    if (at === null) continue;
    if (best === null || at > best.at) best = { row, at };
  }
  if (!best) return null;
  const { row, at } = best;
  return Object.freeze({
    at,
    id: numberOrNull(row.id),
    score: numberOrNull(row.score),
    status: numberOrNull(row.status),
    durationMs: numberOrNull(row.time),
    memoryKb: numberOrNull(row.memory),
  });
}

export function buildProblemCard(config) {
  const { payload, tagDictionary, lastAttempt } = config || {};
  const data = payload && payload.data;
  const problem = data && data.problem;
  if (!problem || typeof problem.pid !== "string" || !problem.pid) return null;
  const difficulty = numberOrNull(problem.difficulty);
  const limits = problem.limits || {};
  const firstOf = (value) =>
    Array.isArray(value) && value.length ? numberOrNull(value[0]) : null;
  const score = numberOrNull(problem.score);
  const best = problem.bestRecord || null;
  return Object.freeze({
    kind: "problem",
    pid: problem.pid,
    name: typeof problem.name === "string" ? problem.name : problem.pid,
    difficulty,
    difficultyName: difficultyName(difficulty),
    difficultyColor: difficultyColor(difficulty),
    acceptedCount: numberOrNull(problem.totalAccepted),
    submittedCount: numberOrNull(problem.totalSubmit),
    acceptanceRate: acceptanceRate(problem.totalAccepted, problem.totalSubmit),
    // 標籤預設摺疊由視圖層決定；這裡只負責把 id 翻成名字。
    tags:
      tagDictionary && typeof tagDictionary.resolve === "function"
        ? Object.freeze(tagDictionary.resolve(problem.tags))
        : Object.freeze([]),
    timeLimitMs: firstOf(limits.time),
    memoryLimitKb: firstOf(limits.memory),
    mine: Object.freeze({
      submitted: boolOrNull(problem.submitted),
      accepted: boolOrNull(problem.accepted),
      score,
      bestRecordId: best ? numberOrNull(best.id) : null,
      bestScore: best ? numberOrNull(best.score) : score,
      bestStatus: best ? numberOrNull(best.status) : null,
      bookmarked: boolOrNull(data.bookmarked),
      lastAttempt: lastAttempt || null,
    }),
  });
}

// 關係枚舉。★★ 2026-08-14 找到了權威來源：**`GET /_lfe/config`**（98 KB，洛谷前端的
// 全套設定：路由表 + 所有枚舉）。裡面的 `UserRelationship` 就是
//   [{type:"Unrelated",id:0},{type:"Following",id:1},{type:"Blacklisted",id:2}]
// —— 上一輪「洛谷沒有獨立的枚舉字典端點」的結論作廢，只是名字不叫 relationships/dicts/enums。
// 三個之外一律當「未知」，視圖層據此不顯示可點的按鈕。
export const RELATIONSHIP_UNRELATED = 0;
export const RELATIONSHIP_FOLLOWING = 1;
export const RELATIONSHIP_BLACKLISTED = 2;
const RELATION_NAMES = Object.freeze({
  0: "unrelated",
  1: "following",
  2: "blacklisted",
});
export const relationOf = (value) => {
  const n = numberOrNull(value);
  return (n !== null && RELATION_NAMES[n]) || "unknown";
};

// 獲獎。★ 形狀實測是**套了一層**的：`data.prizes[i] = { prize: {year, contest, event, prize} }`，
// 其中 **`contest` 已經是簡稱**（"CSP-S" / "NOIP" / "ICPC Regional" / "CCPC 分站賽"），
// 而 `event` 是那段又臭又長的全稱（"被認為是第 50 屆 ICPC 國際大學生處理程序設計競賽…上海站"）。
// ★ 洛谷個人頁上只繪製 `[year] contest` + `prize`，**不繪製 event** —— 上一輪我把 event 也
//   擺上去了，於是 XCPC 類的獎項把整行撐爆（owner 2026-08-14 報的就是這條）。
// 而且**按年份升序**（697932 實測 2024 CSP-J 在前、2025 CSP-S 在後，洛谷個人頁也照這個順序列）。
// 舊程式碼 `slice(0, 4)` 取的是最早的 4 條、視圖又只畫第一條 ——
// 於是**永遠只顯示最早那一個獎**，最近拿的反而看不見（owner 追問過兩次的就是這個）。
// 這裡改成按年份**降序**並保留最近 4 條；沒有年份的排在最後，不參與比較。
// owner 2026-08-14：只顯示**最近 3 條**。
const PRIZE_LIMIT = 3;
export function pickPrizes(prizes) {
  const rows = Array.isArray(prizes) ? prizes.filter((row) => row && row.prize) : [];
  const year = (row) => numberOrNull(row.prize.year);
  return Object.freeze(
    rows
      .slice()
      .sort((a, b) => {
        const left = year(a);
        const right = year(b);
        if (left === right) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        return right - left;
      })
      .slice(0, PRIZE_LIMIT),
  );
}

export function buildUserCard(info, page) {
  // 主載荷=原生卡的 /api/user/info/{uid}；補載荷=/user/{uid}（可能 403，那就只是少幾行）。
  const user = (info && info.user) || null;
  const data = (page && page.data) || null;
  const fallback = data && data.user;
  const source = user || fallback;
  const uid = numberOrNull(source && source.uid);
  if (!source || uid === null) return null;
  // ★ Elo：主介面的 `elo` / `eloValue` 是真值；`/user/{uid}` 裡那兩個欄位恆 null，
  //   它的真值在頂層 `data.elo` 陣列裡。兩邊都試，先信主介面。
  const eloList = data && Array.isArray(data.elo) ? data.elo : [];
  const latestElo =
    (source.elo && typeof source.elo === "object" ? source.elo : null) ||
    eloList.find((entry) => entry && entry.latest === true) ||
    eloList[eloList.length - 1] ||
    null;
  const gu = data && data.gu ? data.gu : null;
  return Object.freeze({
    kind: "user",
    uid,
    name: typeof source.name === "string" ? source.name : `用户 ${uid}`,
    color: typeof source.color === "string" ? source.color : null,
    avatar: typeof source.avatar === "string" ? source.avatar : null,
    // 原生卡的頁頭背景圖。拿不到時洛谷自己會回落到一張固定圖（見 card-view）。
    background:
      typeof source.background === "string" && source.background
        ? source.background
        : null,
    slogan: typeof source.slogan === "string" ? source.slogan : "",
    badge: typeof source.badge === "string" && source.badge ? source.badge : null,
    blogAddress:
      typeof source.blogAddress === "string" && source.blogAddress
        ? source.blogAddress
        : null,
    isAdmin: source.isAdmin === true,
    isBanned: source.isBanned === true,
    ccfLevel: numberOrNull(source.ccfLevel),
    xcpcLevel: numberOrNull(source.xcpcLevel),
    // ★★ 「通過 / 提交」**只認 `/user/{uid}` 的口徑**：兩個介面同名欄位含義不同
    //    （實測 697932：主介面 5441、頁面載荷 710，洛谷個人頁寫的是 710）。
    //    拿不到補載荷就是 null，寧可不畫這一行也不換一個口徑。
    passedCount: fallback ? numberOrNull(fallback.passedProblemCount) : null,
    submittedCount: fallback ? numberOrNull(fallback.submittedProblemCount) : null,
    ranking: numberOrNull(source.ranking),
    followingCount: numberOrNull(source.followingCount),
    followerCount: numberOrNull(source.followerCount),
    registerTime: numberOrNull(source.registerTime),
    guRating: gu ? numberOrNull(gu.rating) : null,
    eloRating: latestElo ? numberOrNull(latestElo.rating) : null,
    eloTime: latestElo ? numberOrNull(latestElo.time) : null,
    prizes: pickPrizes(data && data.prizes),
    relation: relationOf(source.userRelationship),
    reverseRelation: relationOf(source.reverseUserRelationship),
  });
}
