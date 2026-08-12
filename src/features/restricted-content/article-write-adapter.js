export function createOfficialArticleWriteAdapter(config) {
  const {
    fetch: realFetch,
    origin,
    URL: URLCtor,
    Request: RequestCtor,
    Headers: HeadersCtor,
    lid,
    csrf,
  } = config || {};
  if (
    typeof realFetch !== "function" ||
    typeof URLCtor !== "function" ||
    typeof RequestCtor !== "function" ||
    typeof HeadersCtor !== "function" ||
    typeof origin !== "string" ||
    typeof lid !== "string" ||
    !/^[A-Za-z0-9]+$/.test(lid) ||
    typeof csrf !== "string" ||
    !csrf
  )
    throw new TypeError("Official article write adapter configuration is invalid");
  const directPaths = new Set([
    `/article/${lid}/favor`,
    `/article/${lid}/vote`,
    `/article/${lid}/reply`,
  ]);
  const deletePath = new RegExp(
    `^/article/${lid}/deleteReply/[1-9][0-9]*$`,
  );

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
      method !== "POST" ||
      !requestUrl ||
      requestUrl.origin !== origin ||
      (!directPaths.has(requestUrl.pathname) &&
        !deletePath.test(requestUrl.pathname))
    )
      return realFetch(input, init);

    const request =
      input instanceof RequestCtor
        ? input
        : new RequestCtor(requestUrl.href, init);
    const headers = new HeadersCtor(request.headers);
    if (!headers.has("x-csrf-token")) headers.set("x-csrf-token", csrf);
    return realFetch(
      new RequestCtor(request, {
        credentials: "same-origin",
        headers,
      }),
    );
  };
  return Object.freeze({ fetch: wrappedFetch });
}
