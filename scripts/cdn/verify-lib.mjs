export const DEFAULT_VERIFY_DELAYS_MS = Object.freeze([
  0,
  1000,
  2000,
  4000,
  8000,
  12000,
]);

const wait = (milliseconds) =>
  new Promise((resolveDelay) =>
    setTimeout(resolveDelay, milliseconds),
  );

export async function fetchVerified(options) {
  const {
    url,
    check,
    fetchImpl = fetch,
    delaysMs = DEFAULT_VERIFY_DELAYS_MS,
    timeoutMs = 15000,
    sleep = wait,
    onRetry = () => {},
  } = options || {};
  if (!url || typeof check !== "function" || !delaysMs.length)
    throw new Error("fetchVerified requires a URL, check, and retry schedule");
  const expectedUrl = new URL(url).href;

  const history = [];
  for (let index = 0; index < delaysMs.length; index++) {
    const delayMs = delaysMs[index];
    if (delayMs > 0) await sleep(delayMs);
    const attempt = index + 1;
    let body = Buffer.alloc(0);
    let result;
    let status = null;
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      const provenanceError = response.redirected ? "unexpected redirect" :
        response.url !== expectedUrl ? "response did not come from its exact URL" :
        status !== 200 ? `expected HTTP 200, received ${status}` : null;
      if (provenanceError) {
        await response.body?.cancel().catch(() => {});
        throw new Error(provenanceError);
      }
      body = Buffer.from(await response.arrayBuffer());
      result = {
        attempt,
        ...check(response, body),
      };
    } catch (error) {
      result = {
        attempt,
        status,
        bytes: 0,
        ok: false,
        error: error.cause?.message ?? error.message,
      };
    }
    history.push(result);
    if (result.ok)
      return {
        body,
        result: {
          ...result,
          attempts: attempt,
          ...(attempt > 1
            ? { previousFailures: history.slice(0, -1) }
            : {}),
        },
      };
    if (attempt < delaysMs.length)
      onRetry(result, delaysMs[index + 1], attempt + 1);
  }

  const last = history.at(-1);
  const error = new Error(
    `verification failed after ${history.length} attempts; last=${JSON.stringify(last)}`,
  );
  error.history = history;
  error.lastResult = last;
  throw error;
}
