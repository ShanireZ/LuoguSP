function archivedBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function archivedVote(value) {
  return value === 1 || value === -1 ? value : null;
}

export function completeRestrictedArticleInteraction(config) {
  const { article, archived, viewer } = config || {};
  if (!article || typeof article !== "object")
    throw new TypeError("Restricted article data is required");
  const archive = archived && typeof archived === "object" ? archived : {};
  const voted = archivedVote(archive.voted);
  const favored = archivedBoolean(archive.favored);
  const canReply = Boolean(viewer) && archive.canReply !== false;
  const canEdit = false;
  return Object.freeze({
    article: Object.freeze({
      ...article,
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
