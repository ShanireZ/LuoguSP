export function createOfficialArticleWriteAdapter(config) {
  const {
    fetch: realFetch,
    origin,
    URL: URLCtor,
    Request: RequestCtor,
    Headers: HeadersCtor,
    lid,
    csrf,
    onWrite,
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
      /* 無法解析的請求交給原 fetch */
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
    const result = realFetch(
      new RequestCtor(request, {
        credentials: "same-origin",
        headers,
      }),
    );
    if (typeof onWrite !== "function") return result;
    // 官方前端目前用 axios/XHR 寫入，這裡只是同一契約在 fetch 側的旁觀鏡像：
    // 讀取回應副本，絕不改動交還給呼叫方的原回應。
    return Promise.resolve(result).then((response) => {
      try {
        if (response && typeof response.clone === "function")
          response
            .clone()
            .text()
            .then(
              (responseText) =>
                onWrite({
                  method: "POST",
                  url: requestUrl.href,
                  status: response.status,
                  responseText,
                }),
              () => {},
            );
      } catch (error) {
        /* 觀察失敗絕不影響官方寫入本身 */
      }
      return response;
    });
  };
  return Object.freeze({ fetch: wrappedFetch });
}
