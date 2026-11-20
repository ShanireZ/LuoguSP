import { PID_PATTERN, isScopedProblemUrl } from "./identity.js";
import { DIFFICULTY_TIERS } from "../../core/luogu-difficulty.js";
import { asLentillePage, collectDifficultyBatches, readLentillePage } from "./lentille-harvest.js";
import { readJsonXhr } from "../../browser/luogu-get-response.js";

export const validDifficulty = (value) =>
  Number.isInteger(value) && value >= 0 && value < DIFFICULTY_TIERS;

const RECORD_PATH = /^\/record\/(list|\d+)\/?$/;
const RECORD_PAGE_LIMIT = 8;
export const recordRouteId = (pathname) => RECORD_PATH.exec(pathname)?.[1] ?? null;

// Columba uses the difficulty on each record's own problem and its current
// theme palette. Keep it scoped to that record page and query.
function recordSnapshot(page, url) {
  const routeId = url && recordRouteId(url.pathname);
  if (!routeId) return null;
  const isList = routeId === "list";
  const template = isList ? "record.list" : "record.show";
  const problems = new Map();
  if (page?.academic && page.template === template) {
    const { records, record } = page.data;
    const items = isList ? records?.result : [record];
    if (Array.isArray(items)) {
      for (const item of items) {
        const id = String(item?.id);
        if (!/^\d+$/.test(id) || (!isList && id !== routeId)) continue;
        const problem = item?.problem;
        if (typeof problem?.pid === "string" && PID_PATTERN.test(problem.pid) &&
            validDifficulty(problem.difficulty))
          problems.set(`${id}:${problem.pid}`, problem.difficulty);
      }
    }
  }
  return { path: url.pathname + url.search, problems };
}

// Only keep public pid/difficulty pairs, never the rest of a page response.
function snapshot(data, at, order) {
  const problems = collectDifficultyBatches(data).flatMap((batch) =>
    batch.problems().filter((problem) =>
      typeof problem?.pid === "string" && PID_PATTERN.test(problem.pid) &&
      validDifficulty(problem.difficulty),
    ).map(({ pid, difficulty }) => ({ pid, difficulty })),
  );
  return { problems, at, order };
}

// Luogu's current Lentille router uses Axios/XHR and consumes the response in
// loadend. Reading in load makes difficulties available before its DOM update.
// No extra requests and no mutation of the site's response or render functions.
export function createNativeDifficultySource({
  document,
  XMLHttpRequest,
  origin,
  now = () => Date.now(),
  onPage = (page) => page.viewer ?? 0,
  prepareOtherGet,
}) {
  let initialPage;
  let initial = null;
  let initialRecord = null;
  let latest = null;
  let viewer = 0;
  let viewerOrder = 0;
  let viewerStart = 0;
  const recordPages = new Map();
  let requestOrder = 0;
  const supportedPath = /^\/(?:problem\/(?:list|[A-Za-z0-9_]+)|training\/\d+|user\/\d+\/practice)\/?$/;
  const sameOriginUrl = (raw, base) => {
    try {
      const url = new URL(raw, base);
      // XHR resolves relative URLs at open and excludes fragments from responseURL.
      url.hash = "";
      return url.origin === origin && !url.username && !url.password ? url : null;
    } catch { return null; }
  };
  const initialUrl = sameOriginUrl(document.URL, origin);
  const initialAt = now();
  const acceptPage = (page, url, at, order = 0) => {
    // Requests can start in the same millisecond. Order a claimed viewer by
    // its request, and keep unlabeled replies issued before an account switch out.
    if (order < viewerStart || (page.viewer !== undefined && page.viewer !== viewer && order < viewerOrder))
      return false;
    const next = onPage(page, url, at, order);
    if (next === undefined) return false;
    if (page.viewer !== undefined && order > viewerOrder) viewerOrder = order;
    if (next !== viewer) {
      viewer = next;
      viewerStart = order;
      initial = initialRecord = latest = null;
      recordPages.clear();
    }
    return true;
  };
  const harvest = (received) => {
    const page = readLentillePage(document);
    if (page !== initialPage) {
      initialPage = page;
      initial = initialRecord = null;
      if (page && initialUrl && acceptPage(page, initialUrl, initialAt)) {
        if (!isScopedProblemUrl(initialUrl)) initial = snapshot(page.data, initialAt, 0);
        initialRecord = recordSnapshot(page, initialUrl);
      }
    }
    return { viewer, batches: [initial, latest, received].filter(Boolean) };
  };
  const recordDifficulty = (path, id, pid) => {
    const record = recordPages.get(path) || initialRecord;
    return record?.path === path ? record.problems.get(`${id}:${pid}`) : undefined;
  };
  const observe = (accept) => {
    const proto = XMLHttpRequest?.prototype;
    if (!proto) return () => {};
    const rawOpen = proto.open;
    const rawSend = proto.send;
    const requests = new WeakMap();
    const pending = new Set();
    let active = true;
    const open = function (method, rawUrl) {
      const previous = requests.get(this);
      let request;
      if (active && String(method).toUpperCase() === "GET") {
        const url = sameOriginUrl(rawUrl, document.baseURI || origin);
        if (url) {
          if (supportedPath.test(url.pathname) || RECORD_PATH.test(url.pathname))
            request = { url };
          else {
            const prepare = prepareOtherGet?.(url);
            if (prepare) request = { prepare };
          }
        }
      }
      // OPENED handlers can send synchronously. Keep the previous observation
      // alive until the native call succeeds, and restore it if open is rejected.
      requests.set(this, request);
      let result;
      try {
        result = rawOpen.apply(this, arguments);
      } catch (error) {
        if (requests.get(this) === request) requests.set(this, previous);
        throw error;
      }
      previous?.clean?.();
      return result;
    };
    const send = function () {
      const request = active && requests.get(this);
      if (request && !request.clean) {
        const xhr = this;
        if (request.url) {
          request.at = now();
          request.order = ++requestOrder;
        }
        // Lentille needs to be read in load, before Luogu renders in loadend.
        let finish = request.prepare?.();
        const clean = () => {
          xhr.removeEventListener("load", read);
          xhr.removeEventListener("loadend", complete);
          pending.delete(clean);
          delete request.clean;
          finish?.(null);
        };
        const read = () => {
          if (!active || requests.get(xhr) !== request) return;
          if (finish) {
            const complete = finish;
            finish = null;
            return complete(xhr);
          }
          const { url } = request;
          try {
            const page = asLentillePage(readJsonXhr(xhr, url.href));
            const previousViewer = viewer;
            if (!page || !acceptPage(page, url, request.at, request.order)) return;
            const batch = isScopedProblemUrl(url) ? null : snapshot(page.data, request.at, request.order);
            const record = recordSnapshot(page, url);
            let updated = previousViewer !== viewer;
            if (batch?.problems.length) {
              // A late batch can still contain a newer value for an individual PID.
              if (!latest || batch.order > latest.order) latest = batch;
              updated = true;
            }
            if (record) {
              const previous = recordPages.get(record.path);
              if (!previous || request.order > previous.order) {
                recordPages.delete(record.path);
                recordPages.set(record.path, { ...record, order: request.order });
                if (recordPages.size > RECORD_PAGE_LIMIT)
                  recordPages.delete(recordPages.keys().next().value);
                updated = true;
              }
            }
            if (updated) accept({ batch });
          } catch { /* Unsupported/HTML/error responses leave the fallback intact. */ }
        };
        const complete = () => {
          // Reusing this XHR in a load handler can leave a previous loadend
          // queued while the next request is still OPENED.
          if (xhr.readyState !== XMLHttpRequest.DONE) return;
          try {
            if (finish) read();
          } finally {
            clean();
          }
        };
        request.clean = clean;
        pending.add(clean);
        if (!finish) xhr.addEventListener("load", read);
        xhr.addEventListener("loadend", complete);
        try {
          return rawSend.apply(xhr, arguments);
        } catch (error) {
          clean();
          throw error;
        }
      }
      return rawSend.apply(this, arguments);
    };
    proto.open = open;
    proto.send = send;
    return () => {
      active = false;
      for (const clean of pending) clean();
      if (proto.open === open) proto.open = rawOpen;
      if (proto.send === send) proto.send = rawSend;
    };
  };
  const listeners = new Set();
  let stopObserving;
  const subscribe = (listener) => {
    listeners.add(listener);
    if (!stopObserving) stopObserving = observe((event) => {
      for (const notify of listeners) notify(event);
    });
    return () => {
      listeners.delete(listener);
      if (!listeners.size && stopObserving) {
        stopObserving();
        stopObserving = null;
      }
    };
  };
  return Object.freeze({ harvest, subscribe, recordDifficulty });
}
