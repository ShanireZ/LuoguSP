// 受限文章的互动状态合并：把三个来源合成官方 lentille `data` 的形状。
// 优先级（高→低）
//   1. confirmed —— 洛谷官方写接口确认过的状态（本次会话或账号隔离的持久记录）；
//   2. archived  —— 保存站存档快照，只提供公共计数，永远不提供个人状态；
//   3. null      —— 未知。绝不用 false 伪造「没收藏 / 没点赞」。
// 公共计数在两者都有时按新鲜度取舍：保存站快照比确认记录更新才允许覆盖计数，
// 且任何情况下都不得覆盖已确认的 voted / favored。
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
  const { article, archived, viewer, confirmed, archivedAt } = config || {};
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
  const upvote = countsWin ? numberOrNull(record.upvote) : null;
  const favorCount = countsWin ? numberOrNull(record.favorCount) : null;
  const canReply = Boolean(viewer) && archive.canReply !== false;
  const canEdit = false;
  return Object.freeze({
    article: Object.freeze({
      ...article,
      ...(upvote === null ? {} : { upvote }),
      ...(favorCount === null ? {} : { favorCount }),
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
