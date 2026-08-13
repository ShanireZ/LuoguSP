// 受限文章的互动状态合并：把四个来源合成官方 lentille `data` 的形状。
//
// 个人状态（voted / favored）优先级（高→低）
//   1. confirmed —— 洛谷官方写接口确认过的状态（本次会话或账号隔离的持久记录）；
//   2. archived  —— 保存站存档快照，实际上永远不提供个人状态；
//   3. null      —— 未知。绝不用 false 伪造「没收藏 / 没点赞」。
//
// 公共计数（upvote / favorCount）优先级（高→低）
//   1. live      —— 页面加载时从洛谷作者专栏列表 API 现取的服务器真值
//                   （见 article-live-counts.js）。它天然已经包含此前所有已确认的写入，
//                   所以无条件压过 confirmed，不需要比新鲜度。
//   2. confirmed —— 已确认写响应里的计数；
//   3. archived  —— 保存站快照，仅当比 confirmed 更新时才允许覆盖。
//
// ★ live **只**参与公共计数。作者专栏列表不含 voted / favored，
//   一个字节的个人状态都不许从那里来 —— 否则又走回「用 false 伪造未收藏」的老路。
function archivedBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function archivedVote(value) {
  return value === 1 || value === -1 ? value : null;
}

function confirmedVote(value) {
  return value === 1 || value === -1 || value === 0 ? value : null;
}

const numberOrNull = (value) =>
  Number.isFinite(Number(value)) && value !== null && value !== ""
    ? Number(value)
    : null;

export function completeRestrictedArticleInteraction(config) {
  const { article, archived, viewer, confirmed, archivedAt, live } =
    config || {};
  if (!article || typeof article !== "object")
    throw new TypeError("Restricted article data is required");
  const archive = archived && typeof archived === "object" ? archived : {};
  const record = confirmed && typeof confirmed === "object" ? confirmed : null;
  const voted = record
    ? (confirmedVote(record.voted) ?? archivedVote(archive.voted))
    : archivedVote(archive.voted);
  const favored = record
    ? (archivedBoolean(record.favored) ?? archivedBoolean(archive.favored))
    : archivedBoolean(archive.favored);
  const archiveTime = numberOrNull(archivedAt);
  const recordTime = record ? numberOrNull(record.at) : null;
  const countsWin =
    record !== null &&
    (archiveTime === null || recordTime === null || archiveTime <= recordTime);
  // live 只读三个计数键，不解构整个对象 —— 免得哪天列表 API 多返回一个
  // favored/voted 就被顺手带进个人状态。
  const liveUpvote = live ? numberOrNull(live.upvote) : null;
  const liveFavorCount = live ? numberOrNull(live.favorCount) : null;
  const upvote =
    liveUpvote ?? (countsWin ? numberOrNull(record.upvote) : null);
  const favorCount =
    liveFavorCount ?? (countsWin ? numberOrNull(record.favorCount) : null);
  // 评论数只有 live 一个可信来源；拿不到就沿用调用方传进来的已加载评论条数。
  const replyCount = live ? numberOrNull(live.replyCount) : null;
  // ★ 发表时间同理，而且更要紧：保存站只有入档时间，两者能差几个月，
  //   把入档时间当发表时间显示是错的。live 有就用真值。
  const time = live ? numberOrNull(live.time) : null;
  // 题解归属与审核状态：调用方此前只能硬写 solutionFor:null / status:2。
  // 这两个值**原样透传洛谷自己列表 API 的字段**，形状由洛谷决定，不由这里构造 ——
  // 官方组件读的是 `article.solutionFor.pid`（链到 problem.solution）。
  const status = live ? numberOrNull(live.status) : null;
  const solutionFor =
    live && live.solutionFor && typeof live.solutionFor === "object"
      ? live.solutionFor
      : null;
  const canReply = Boolean(viewer) && archive.canReply !== false;
  const canEdit = false;
  return Object.freeze({
    article: Object.freeze({
      ...article,
      ...(upvote === null ? {} : { upvote }),
      ...(favorCount === null ? {} : { favorCount }),
      ...(replyCount === null ? {} : { replyCount }),
      ...(time === null ? {} : { time }),
      ...(status === null ? {} : { status }),
      ...(solutionFor === null ? {} : { solutionFor }),
      voted,
      canReply,
      canEdit,
    }),
    favored,
    voted,
    canReply,
    canEdit,
  });
}
