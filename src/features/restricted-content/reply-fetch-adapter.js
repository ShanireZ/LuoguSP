export function createRestrictedReplyFetchAdapter(config) {
  const {
    fetch: realFetch,
    origin,
    Response: ResponseCtor,
    URL: URLCtor,
    lid,
    replies,
  } = config || {};
  if (typeof realFetch !== "function")
    throw new TypeError("Reply fetch adapter requires fetch");
  if (
    typeof ResponseCtor !== "function" ||
    typeof URLCtor !== "function" ||
    typeof origin !== "string" ||
    typeof lid !== "string" ||
    !/^[A-Za-z0-9]+$/.test(lid) ||
    !Array.isArray(replies)
  )
    throw new TypeError("Reply fetch adapter configuration is invalid");
  const repliesPath = `/article/${lid}/replies`;
  const wrappedFetch = function (input, init) {
    const rawUrl =
      typeof input === "string" || input instanceof URLCtor
        ? String(input)
        : (input && input.url) || "";
    const method = String(
      (init && init.method) || (input && input.method) || "GET",
    ).toUpperCase();
    let requestUrl = null;
    try {
      requestUrl = new URLCtor(rawUrl, origin);
    } catch (error) {
      /* 无法解析的请求交给原 fetch */
    }
    if (
      method !== "GET" ||
      !requestUrl ||
      requestUrl.origin !== origin ||
      requestUrl.pathname !== repliesPath
    )
      return realFetch(input, init);

    let list = replies;
    const query = requestUrl.searchParams;
    if (query.get("sort") === "time-d")
      list = [...replies].sort((left, right) => right.time - left.time);
    const after = Number(query.get("after"));
    let start = 0;
    if (after) {
      const index = list.findIndex((reply) => reply.id === after);
      start = index >= 0 ? index + 1 : list.length;
    }
    list = list.slice(start, start + 20);
    return Promise.resolve(
      new ResponseCtor(JSON.stringify({ replySlice: list }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return Object.freeze({ fetch: wrappedFetch });
}
