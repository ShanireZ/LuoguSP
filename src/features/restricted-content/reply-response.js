export function saverReplyPayload(replies, requestUrl) {
  const query = requestUrl.searchParams;
  const list = query.get("sort") === "time-d"
    ? [...replies].sort((left, right) => right.time - left.time)
    : replies;
  const after = Number(query.get("after"));
  const index = after ? list.findIndex(({ id }) => id === after) : -1;
  const start = after && index < 0 ? list.length : index + 1;
  return { replySlice: list.slice(start, start + 20) };
}

export function matchesNativeReplyResponse(expectedUrl, finalUrl, status, contentType) {
  return finalUrl === expectedUrl && status >= 200 && status < 300 &&
    /^application\/json(?:\s*;|\s*$)/i.test(contentType?.trim());
}
