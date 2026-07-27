function abortError(message = "Userscript request was cancelled") {
  return Object.assign(new Error(message), { name: "AbortError" });
}

function responseHeaders(rawHeaders = "") {
  const values = new Map();
  for (const line of String(rawHeaders).split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    values.set(
      line.slice(0, separator).trim().toLowerCase(),
      line.slice(separator + 1).trim(),
    );
  }
  return Object.freeze({
    get: (name) => values.get(String(name).toLowerCase()) || null,
  });
}

export function createUserscriptFetch(options = {}) {
  const ambientGmRequest =
    typeof GM_xmlhttpRequest === "function"
      ? GM_xmlhttpRequest
      : globalThis.GM_xmlhttpRequest;
  const gmRequest =
    options.gmRequest ||
    (typeof ambientGmRequest === "function"
      ? ambientGmRequest
      : null);
  if (typeof gmRequest !== "function")
    return Object.freeze({
      fetchImpl: options.fetchImpl || globalThis.fetch,
      transport: "fetch",
    });

  const fetchImpl = (url, init = {}) =>
    new Promise((resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      let settled = false;
      let request = null;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => {
        try {
          request?.abort?.();
        } catch (error) {
          // The promise still rejects even if the transport already closed.
        }
        finish(reject, abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        request = gmRequest({
          method: "GET",
          url: String(url),
          responseType: "arraybuffer",
          anonymous: true,
          nocache: true,
          onload(response) {
            const body =
              response.response instanceof ArrayBuffer
                ? response.response
                : new Uint8Array(response.response || []).buffer;
            finish(
              resolve,
              Object.freeze({
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                headers: responseHeaders(response.responseHeaders),
                arrayBuffer: async () => body,
              }),
            );
          },
          onerror(response) {
            finish(
              reject,
              new Error(
                `GM_xmlhttpRequest failed: ${response?.error || response?.statusText || "network error"}`,
              ),
            );
          },
          ontimeout() {
            finish(reject, new Error("GM_xmlhttpRequest timed out"));
          },
          onabort() {
            finish(reject, abortError());
          },
        });
      } catch (error) {
        finish(reject, error);
      }
    });

  return Object.freeze({ fetchImpl, transport: "gm-xhr" });
}
