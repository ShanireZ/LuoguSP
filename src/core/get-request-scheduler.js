export function createGetRequestScheduler(config) {
  const {
    fetch: fetchImpl,
    clock,
    launchGap = 300,
    concurrency = 3,
    timeoutMs = 15000,
    maxRetries = 1,
    createAbortController = () => new AbortController(),
  } = config || {};
  if (typeof fetchImpl !== "function")
    throw new TypeError("GET scheduler requires a fetch adapter");
  if (
    !clock ||
    typeof clock.now !== "function" ||
    typeof clock.setTimeout !== "function" ||
    typeof clock.clearTimeout !== "function"
  )
    throw new TypeError("GET scheduler requires a clock adapter");

  const queue = [];
  const inflight = new Map();
  const controllers = new Set();
  let active = 0;
  let nextAt = 0;
  let wakeTimer = null;
  let disposed = false;

  const abortError = () => {
    const error = new Error("GET request cancelled");
    error.name = "AbortError";
    return error;
  };
  const retryAfterMs = (raw) => {
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, at - clock.now()) : 0;
  };
  const defer = (ms) => {
    if (disposed || !(ms > 0)) return;
    const until = clock.now() + ms;
    if (until <= nextAt) return;
    nextAt = until;
    if (wakeTimer !== null) {
      clock.clearTimeout(wakeTimer);
      wakeTimer = null;
    }
    drain();
  };
  const drain = () => {
    if (disposed) return;
    while (active < concurrency && queue.length) {
      const wait = nextAt - clock.now();
      if (wait > 0) {
        if (wakeTimer === null) {
          wakeTimer = clock.setTimeout(() => {
            wakeTimer = null;
            drain();
          }, wait);
        }
        return;
      }
      const job = queue.shift();
      job.startedAt = clock.now();
      nextAt = job.startedAt + launchGap;
      const controller = createAbortController();
      const timeout = clock.setTimeout(() => controller.abort(), timeoutMs);
      controllers.add(controller);
      active++;
      (async () => {
        try {
          const response = await fetchImpl(job.url, {
            signal: controller.signal,
          });
          if (disposed) throw abortError();
          if (!response.ok) {
            const error = new Error(`HTTP ${response.status} ${job.url}`);
            error.status = response.status;
            if (
              (response.status === 429 || response.status === 503) &&
              job.retries < maxRetries
            ) {
              const retryAfter =
                response.headers &&
                typeof response.headers.get === "function" &&
                response.headers.get("retry-after");
              defer(retryAfterMs(retryAfter) || launchGap);
              if (job.consumers > 0) {
                job.retries++;
                queue.unshift(job);
                return;
              }
            }
            throw error;
          }
          const text = await response.text();
          if (disposed) throw abortError();
          job.resolve(text);
        } catch (error) {
          job.reject(error);
        } finally {
          clock.clearTimeout(timeout);
          controllers.delete(controller);
          active--;
          drain();
        }
      })();
    }
  };
  const dropQueued = (job) => {
    const index = queue.indexOf(job);
    if (index === -1) return;
    queue.splice(index, 1);
    inflight.delete(job.key);
    job.reject(abortError());
    if (queue.length === 0 && wakeTimer !== null) {
      clock.clearTimeout(wakeTimer);
      wakeTimer = null;
    }
  };
  const attachSignal = (job, signal) => {
    job.consumers++;
    if (!signal) return job.promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        job.consumers--;
        if (job.consumers === 0) dropQueued(job);
        reject(abortError());
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      job.promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  };
  const text = (url, options) => {
    const signal = options?.signal;
    if (disposed || signal?.aborted) return Promise.reject(abortError());
    const key = options?.key ?? url;
    let job = inflight.get(key);
    if (!job) {
      job = { url, key, retries: 0, consumers: 0 };
      job.promise = new Promise((resolve, reject) => {
        job.resolve = resolve;
        job.reject = reject;
      }).finally(() => {
        if (inflight.get(key) === job) inflight.delete(key);
      });
      inflight.set(key, job);
      queue.push(job);
    }
    const result = attachSignal(job, signal);
    drain();
    const onResponse = options?.onResponse;
    if (!onResponse) return result;
    // All consumers receive the start time of the attempt that returned this body.
    return result.then((body) => {
      onResponse(job.startedAt);
      return body;
    });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (wakeTimer !== null) clock.clearTimeout(wakeTimer);
    wakeTimer = null;
    const error = abortError();
    while (queue.length) queue.shift().reject(error);
    for (const controller of controllers) controller.abort();
  };

  return Object.freeze({ text, dispose });
}
