const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const matchesId = (value, id) =>
  typeof id === "string" &&
  (value === id || (Number.isSafeInteger(value) && String(value) === id));

// Saver's comment envelope does not require an article ID. Check it only
// if the source includes an explicit article reference.
const matchesCommentArticle = (record, id) =>
  (record.articleId == null || matchesId(record.articleId, id)) &&
  (record.lid == null || matchesId(record.lid, id));

const nonNegativeInteger = (value) => {
  const number =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

const textOrUndefined = (value) =>
  typeof value === "string" ? value : undefined;

function normalizeComments(comments, articleId) {
  const replies = [];
  const ids = new Set();
  for (const row of comments) {
    if (!isRecord(row) || !matchesCommentArticle(row, articleId) ||
        typeof row.content !== "string") continue;
    const id = nonNegativeInteger(row.id);
    const time = nonNegativeInteger(row.time ?? 0);
    // Native replies use seconds; reject times outside the JavaScript Date range.
    if (!id || ids.has(id) || time === null || time > 8.64e12) continue;
    const author = row.author ?? {};
    if (!isRecord(author)) continue;
    const uid = nonNegativeInteger(author.id ?? 0);
    if (uid === null) continue;
    ids.add(id);
    replies.push({
      id,
      time,
      content: row.content,
      author: {
        id: uid,
        name: textOrUndefined(author.name),
        badge: textOrUndefined(author.badge),
        color: textOrUndefined(author.color),
        ccfLevel: nonNegativeInteger(author.ccfLevel),
        xcpcLevel: nonNegativeInteger(author.xcpcLevel),
      },
    });
  }
  return replies;
}

export function createSaverProtocol() {
  const isSuccess = (payload) =>
    !!(
      payload &&
      typeof payload.code === "number" &&
      payload.code >= 200 &&
      payload.code < 300
    );
  const failureMessage = (payload, fallback) => {
    const code =
      payload && typeof payload.code === "number" ? ` ${payload.code}` : "";
    const message =
      payload && typeof payload.message === "string" && payload.message.trim()
        ? `：${payload.message.trim()}`
        : "";
    return `${fallback}${code}${message}`;
  };
  const classifyLookup = (payload, type, id) => {
    if (payload?.code === 200) {
      const data = payload.data;
      const matchesType = type === "article" ? typeof data?.title === "string" :
        type === "paste" && data?.title === undefined;
      if (matchesId(data?.id, id) && matchesType && typeof data.content === "string")
        return { kind: "archived", data };
      return {
        kind: "unavailable",
        reason: "保存站返回的内容与请求目标不匹配。",
        retryable: false,
        category: "invariant",
      };
    }
    if (payload && payload.code === 404) return { kind: "missing" };
    return {
      kind: "unavailable",
      reason: failureMessage(payload, "保存站查询失败"),
      retryable: false,
      category: "business",
    };
  };
  const classifyAction = (payload, fallback = "保存站拒绝请求") =>
    isSuccess(payload)
      ? { kind: "accepted" }
      : {
          kind: "unavailable",
          reason: failureMessage(payload, fallback),
          retryable: true,
          category: "business",
        };
  const classifyComments = (payload, articleId) => {
    if (!isSuccess(payload)) return classifyAction(payload, "评论存档读取失败");
    const data = payload.data;
    if (!isRecord(data) || !Array.isArray(data.comments) || !matchesCommentArticle(data, articleId))
      return {
        kind: "unavailable",
        reason: "保存站返回的评论存档格式或目标无效。",
        category: "invariant",
        retryable: false,
      };
    return { kind: "available", data: { comments: normalizeComments(data.comments, articleId) } };
  };
  return Object.freeze({
    isSuccess,
    failureMessage,
    classifyLookup,
    classifyAction,
    classifyComments,
  });
}
