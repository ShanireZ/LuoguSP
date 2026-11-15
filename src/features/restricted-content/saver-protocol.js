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
      const matchesId = typeof id === "string" && (data?.id === id ||
        (Number.isSafeInteger(data?.id) && String(data.id) === id));
      const matchesType = type === "article" ? typeof data?.title === "string" :
        type === "paste" && data?.title === undefined;
      if (matchesId && matchesType && typeof data.content === "string")
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
  return Object.freeze({
    isSuccess,
    failureMessage,
    classifyLookup,
    classifyAction,
  });
}
