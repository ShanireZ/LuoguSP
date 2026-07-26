export function createSaverTransport(config) {
  const {
    baseUrl,
    fetch: fetchImpl,
    clock,
    timeoutMs = 15000,
    createAbortController = () => new AbortController(),
  } = config || {};
  if (typeof fetchImpl !== "function")
    throw new TypeError("Saver transport requires a fetch adapter");
  if (
    !clock ||
    typeof clock.setTimeout !== "function" ||
    typeof clock.clearTimeout !== "function"
  )
    throw new TypeError("Saver transport requires a clock adapter");

  const fail = (kind, message, extra) =>
    Object.assign(new Error(message), { kind, ...(extra || {}) });
  const request = async (path, init, options) => {
    const controller = createAbortController();
    const externalSignal = options && options.signal;
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (externalSignal && externalSignal.aborted)
      throw fail("cancelled", "保存站请求已取消");
    if (externalSignal)
      externalSignal.addEventListener("abort", abortFromCaller, {
        once: true,
      });
    const timer = clock.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(baseUrl + path, {
        ...(init || {}),
        signal: controller.signal,
      });
      if (!response.ok)
        throw fail("transport", `保存站 HTTP ${response.status}`, {
          status: response.status,
        });
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw fail("malformed-response", "保存站响应不是有效 JSON");
      }
      if (!payload || typeof payload.code !== "number")
        throw fail("malformed-response", "保存站响应格式无效");
      return payload;
    } catch (error) {
      if (error && error.name === "AbortError")
        throw timedOut
          ? fail("timeout", `保存站请求超时（${timeoutMs / 1000}s）`)
          : fail("cancelled", "保存站请求已取消");
      if (error && error.kind) throw error;
      throw fail("transport", String((error && error.message) || error));
    } finally {
      clock.clearTimeout(timer);
      if (externalSignal)
        externalSignal.removeEventListener("abort", abortFromCaller);
    }
  };

  return Object.freeze({
    get: (path, options) => request(path, null, options),
    post: (path, body, options) =>
      request(
        path,
        {
          method: "POST",
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        },
        options,
      ),
  });
}
