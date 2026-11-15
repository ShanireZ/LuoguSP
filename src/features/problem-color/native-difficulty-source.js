import { PID_PATTERN, isScopedProblemUrl } from "./identity.js";
import { DIFFICULTY_TIERS } from "../../core/luogu-difficulty.js";
import { asLentillePage, collectDifficultyBatches, readLentillePage } from "./lentille-harvest.js";

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
function snapshot(data, at) {
  const problems = collectDifficultyBatches(data).flatMap((batch) =>
    batch.problems().filter((problem) =>
      typeof problem?.pid === "string" && PID_PATTERN.test(problem.pid) &&
      validDifficulty(problem.difficulty),
    ).map(({ pid, difficulty }) => ({ pid, difficulty })),
  );
  return { source: problems, problems, at };
}

// Luogu's current Lentille router uses Axios/XHR and consumes the response in
// loadend. Reading in load makes difficulties available before its DOM update.
// No extra requests and no mutation of the site's response or render functions.
export function createNativeDifficultySource({
  document,
  XMLHttpRequest,
  origin,
  now = () => Date.now(),
  onPage = () => {},
  prepareOtherGet,
}) {
  let initialPage;
  let initial = null;
  let initialRecord = null;
  let latest = null;
  const recordPages = new Map();
  let requestOrder = 0;
  const supportedPath = /^\/(?:problem\/(?:list|[A-Za-z0-9_]+)|training\/\d+|user\/\d+\/practice)\/?$/;
  const pageUrl = (raw, initial = false) => {
    try {
      const url = new URL(raw, origin);
      return url.origin === origin &&
        (initial || supportedPath.test(url.pathname) || RECORD_PATH.test(url.pathname)) ? url : null;
    } catch { return null; }
  };
  const initialUrl = pageUrl(document.URL, true);
  const initialAt = now();
  const harvest = () => {
    const page = readLentillePage(document);
    if (page !== initialPage) {
      initialPage = page;
      initial = page && !isScopedProblemUrl(initialUrl) ? snapshot(page.data, now()) : null;
      initialRecord = recordSnapshot(page, initialUrl);
      if (page && initialUrl) onPage(page, initialUrl, initialAt);
    }
    return [initial, latest].filter(Boolean);
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
    const open = function (method, url) {
      requests.delete(this);
      if (active && String(method).toUpperCase() === "GET") {
        if (pageUrl(url)) requests.set(this, { at: now(), order: ++requestOrder });
        else {
          const track = prepareOtherGet?.(url);
          if (track) requests.set(this, { track });
        }
      }
      return rawOpen.apply(this, arguments);
    };
    const send = function () {
      const request = active && requests.get(this);
      if (request?.track) {
        request.track(this);
        return rawSend.apply(this, arguments);
      }
      if (request) {
        const xhr = this;
        const clean = () => {
          xhr.removeEventListener("load", read);
          xhr.removeEventListener("loadend", clean);
          pending.delete(clean);
        };
        const read = () => {
          if (!active || xhr.status !== 200) return;
          const url = pageUrl(xhr.responseURL);
          if (!url) return;
          try {
            const payload = xhr.responseType === "json" ? xhr.response :
              (!xhr.responseType || xhr.responseType === "text") ? JSON.parse(xhr.responseText) : null;
            const page = asLentillePage(payload);
            if (!page) return;
            onPage(page, url, request.at);
            const batch = isScopedProblemUrl(url) ? null : snapshot(page.data, request.at);
            const record = recordSnapshot(page, url);
            let updated = false;
            if (batch?.problems.length && (!latest || request.order > latest.order)) {
              latest = { ...batch, order: request.order };
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
            if (updated) accept();
          } catch { /* Unsupported/HTML/error responses leave the fallback intact. */ }
        };
        pending.add(clean);
        xhr.addEventListener("load", read);
        xhr.addEventListener("loadend", clean, { once: true });
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
    if (!stopObserving) stopObserving = observe(() => {
      for (const notify of listeners) notify();
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
