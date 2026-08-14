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

// 关系枚举。★★ 2026-08-14 找到了权威来源：**`GET /_lfe/config`**（98 KB，洛谷前端的
// 全套配置：路由表 + 所有枚举）。里面的 `UserRelationship` 就是
//   [{type:"Unrelated",id:0},{type:"Following",id:1},{type:"Blacklisted",id:2}]
// —— 上一轮「洛谷没有独立的枚举字典端点」的结论作废，只是名字不叫 relationships/dicts/enums。
// 三个之外一律当「未知」，视图层据此不显示可点的按钮。
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

// 获奖。★ 形状实测是**套了一层**的：`data.prizes[i] = { prize: {year, contest, event, prize} }`，
// 其中 **`contest` 已经是简称**（"CSP-S" / "NOIP" / "ICPC Regional" / "CCPC 分站赛"），
// 而 `event` 是那段又臭又长的全称（"被认为是第 50 届 ICPC 国际大学生程序设计竞赛…上海站"）。
// ★ 洛谷个人页上只渲染 `[year] contest` + `prize`，**不渲染 event** —— 上一轮我把 event 也
//   摆上去了，于是 XCPC 类的奖项把整行撑爆（owner 2026-08-14 报的就是这条）。
// 而且**按年份升序**（697932 实测 2024 CSP-J 在前、2025 CSP-S 在后，洛谷个人页也照这个顺序列）。
// 旧代码 `slice(0, 4)` 取的是最早的 4 条、视图又只画第一条 ——
// 于是**永远只显示最早那一个奖**，最近拿的反而看不见（owner 追问过两次的就是这个）。
// 这里改成按年份**降序**并保留最近 4 条；没有年份的排在最后，不参与比较。
// owner 2026-08-14：只显示**最近 3 条**。
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
  // 主载荷=原生卡的 /api/user/info/{uid}；补载荷=/user/{uid}（可能 403，那就只是少几行）。
  const user = (info && info.user) || null;
  const data = (page && page.data) || null;
  const fallback = data && data.user;
  const source = user || fallback;
  const uid = numberOrNull(source && source.uid);
  if (!source || uid === null) return null;
  // ★ Elo：主接口的 `elo` / `eloValue` 是真值；`/user/{uid}` 里那两个字段恒 null，
  //   它的真值在顶层 `data.elo` 数组里。两边都试，先信主接口。
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
    // 原生卡的页头背景图。拿不到时洛谷自己会回落到一张固定图（见 card-view）。
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
    // ★★ 「通过 / 提交」**只认 `/user/{uid}` 的口径**：两个接口同名字段含义不同
    //    （实测 697932：主接口 5441、页面载荷 710，洛谷个人页写的是 710）。
    //    拿不到补载荷就是 null，宁可不画这一行也不换一个口径。
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
