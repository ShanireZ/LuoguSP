import { difficultyColor, difficultyName } from "./difficulty.js";

// 把洛谷各接口的原始载荷翻译成卡片视图模型。纯函数，不碰 DOM 不发请求。
//
// 数据来源与实证见 handoff/26-8-13.md。这里只重复三条最容易被写错的：
//   1. `problem.tags` 是**数字 id**，必须配 `/_lfe/tags` 字典；字典里**没有难度**
//      （6 个 type 全是 Region/Algorithm/Origin/Time/SpecialProblem/Others）。
//   2. 用户的 `elo` 真数据在**顶层 `data.elo`**；`user.elo` / `user.eloValue` 恒为 null。
//   3. `user.verified` **只在看自己时返回**，且与页面上的 ✅ 无关 ——
//      ✅ 由 `ccfLevel > 0` 驱动，气球由 `xcpcLevel > 0` 驱动（41 用户双向零反例）。

const numberOrNull = (value) =>
  value === null || value === undefined || value === "" ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);

const boolOrNull = (value) => (typeof value === "boolean" ? value : null);

// 通过率。分母为 0 时是「还没人交过」，不是 0% —— 别显示成 0%。
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
    // 认不出的 id 一律丢掉，不显示「标签 523」这种对用户毫无意义的东西。
    resolve: (ids) =>
      (Array.isArray(ids) ? ids : [])
        .map((id) => names.get(numberOrNull(id)))
        .filter((name) => typeof name === "string" && name),
  });
}

// 上次尝试：来自旧版 `/record/list` 页面的 `_feInjection.currentData.records`。
// ★ 不能用 problem detail 的 `lastCodeAt` 代替 —— 那是 IDE 里最后保存代码的时间，
//   不是最后一次提交（两者数值可能恰好相同，语义不同）。
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
    // 标签默认折叠由视图层决定；这里只负责把 id 翻成名字。
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

// 关系枚举实测：0 = 未关注，1 = 已关注（`reverseUserRelationship: 1` 证实「他关注了我」）。
// 洛谷没有独立的枚举字典端点（`/_lfe/relationships` 等全 404），前端把未知值兜底成
// Unrelated。所以 0/1 之外一律当「未知」，视图层据此不显示可点的关注按钮。
const RELATION_FOLLOWING = 1;
const RELATION_UNRELATED = 0;
export const relationOf = (value) => {
  const n = numberOrNull(value);
  if (n === RELATION_FOLLOWING) return "following";
  if (n === RELATION_UNRELATED) return "unrelated";
  return "unknown";
};

// 获奖。★ 形状实测是**套了一层**的：`data.prizes[i] = { prize: {year, contest, event, prize} }`，
// 而且**按年份升序**（697932 实测 2024 CSP-J 在前、2025 CSP-S 在后，洛谷个人页也照这个顺序列）。
// 旧代码 `slice(0, 4)` 取的是最早的 4 条、视图又只画第一条 ——
// 于是**永远只显示最早那一个奖**，最近拿的反而看不见（owner 追问过两次的就是这个）。
// 这里改成按年份**降序**并保留最近 4 条；没有年份的排在最后，不参与比较。
const PRIZE_LIMIT = 4;
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

export function buildUserCard(payload) {
  const data = payload && payload.data;
  const user = data && data.user;
  const uid = numberOrNull(user && user.uid);
  if (!user || uid === null) return null;
  const elo = Array.isArray(data.elo) ? data.elo : [];
  const latestElo =
    elo.find((entry) => entry && entry.latest === true) ||
    elo[elo.length - 1] ||
    null;
  const gu = data.gu || null;
  return Object.freeze({
    kind: "user",
    uid,
    name: typeof user.name === "string" ? user.name : `用户 ${uid}`,
    color: typeof user.color === "string" ? user.color : null,
    avatar: typeof user.avatar === "string" ? user.avatar : null,
    slogan: typeof user.slogan === "string" ? user.slogan : "",
    badge: typeof user.badge === "string" && user.badge ? user.badge : null,
    isAdmin: user.isAdmin === true,
    isBanned: user.isBanned === true,
    // ✅ 与气球的驱动字段（实测 41 用户双向零反例）。
    ccfLevel: numberOrNull(user.ccfLevel),
    xcpcLevel: numberOrNull(user.xcpcLevel),
    passedCount: numberOrNull(user.passedProblemCount),
    submittedCount: numberOrNull(user.submittedProblemCount),
    ranking: numberOrNull(user.ranking),
    followingCount: numberOrNull(user.followingCount),
    followerCount: numberOrNull(user.followerCount),
    registerTime: numberOrNull(user.registerTime),
    guRating: gu ? numberOrNull(gu.rating) : null,
    guScores: gu && gu.scores && typeof gu.scores === "object" ? gu.scores : null,
    // ★ 顶层 data.elo，不是 user.elo（后者恒 null）。
    eloRating: latestElo ? numberOrNull(latestElo.rating) : null,
    eloTime: latestElo ? numberOrNull(latestElo.time) : null,
    prizes: pickPrizes(data.prizes),
    relation: relationOf(user.userRelationship),
    reverseRelation: relationOf(user.reverseUserRelationship),
  });
}
