import { matchesNativeReplyResponse, saverReplyPayload } from "./reply-response.js";

export function createRestrictedReplyFetchAdapter(config) {
  const {
    fetch: realFetch,
    origin,
    Response: ResponseCtor,
    URL: URLCtor,
    lid,
    replies,
    getBaseUrl = () => origin,
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
  const wrappedFetch = async function (input, init) {
    const rawUrl =
      typeof input === "string" || input instanceof URLCtor
        ? String(input)
        : (input && input.url) || "";
    const method = String(
      (init && init.method) || (input && input.method) || "GET",
    ).toUpperCase();
    let requestUrl = null;
    try {
      requestUrl = new URLCtor(rawUrl, getBaseUrl());
    } catch (error) {
      /* 無法解析的請求交給原 fetch */
    }
    if (
      method !== "GET" ||
      !requestUrl ||
      requestUrl.origin !== origin ||
      requestUrl.username || requestUrl.password ||
      requestUrl.pathname !== repliesPath
    )
      return realFetch(input, init);

    requestUrl.hash = "";
    const signal = init?.signal === undefined ? input?.signal : init.signal;
    try {
      const response = await realFetch(input, init);
      if (response && !response.redirected && matchesNativeReplyResponse(
        requestUrl.href, response.url, response.status, response.headers.get("content-type"),
      )) {
        const payload = await response.clone().json();
        if (signal?.aborted) throw signal.reason;
        if (payload && Array.isArray(payload.replySlice)) return response;
      }
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
    }
    if (signal?.aborted) throw signal.reason;
    return new ResponseCtor(JSON.stringify(saverReplyPayload(replies, requestUrl)), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-luogusp-source": "saver",
      },
    });
  };
  return Object.freeze({ fetch: wrappedFetch });
}
