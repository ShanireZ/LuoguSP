import { PID_PATTERN } from "./identity.js";
import { DIFFICULTY_TIERS } from "../../core/luogu-difficulty.js";
import { collectDifficultyBatches, readLentilleData } from "./lentille-harvest.js";

export const validDifficulty = (value) =>
  Number.isInteger(value) && value >= 0 && value < DIFFICULTY_TIERS;

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
}) {
  let initialData;
  let initial = null;
  let latest = null;
  let requestOrder = 0;
  const supportedPath = /^\/(?:problem\/(?:list|[A-Za-z0-9_]+)|training\/\d+|user\/\d+\/practice|record\/list)\/?$/;
  const pageUrl = (raw) => {
    try {
      const url = new URL(raw, origin);
      return url.origin === origin && supportedPath.test(url.pathname) ? url : null;
    } catch { return null; }
  };
  const harvest = () => {
    const data = readLentilleData(document);
    if (data !== initialData) {
      initialData = data;
      initial = data ? snapshot(data, now()) : null;
    }
    return [initial, latest].filter(Boolean);
  };
  const subscribe = (accept) => {
    const proto = XMLHttpRequest?.prototype;
    if (!proto) return () => {};
    const rawOpen = proto.open;
    const rawSend = proto.send;
    const requests = new WeakMap();
    const pending = new Set();
    let active = true;
    const open = function (method, url) {
      requests.delete(this);
      if (active && String(method).toUpperCase() === "GET" && pageUrl(url))
        requests.set(this, { at: now(), order: ++requestOrder });
      return rawOpen.apply(this, arguments);
    };
    const send = function () {
      const request = active && requests.get(this);
      if (request) {
        const xhr = this;
        const clean = () => {
          xhr.removeEventListener("load", read);
          xhr.removeEventListener("loadend", clean);
          pending.delete(clean);
        };
        const read = () => {
          if (!active || xhr.status !== 200 || !pageUrl(xhr.responseURL)) return;
          try {
            const payload = xhr.responseType === "json" ? xhr.response :
              (!xhr.responseType || xhr.responseType === "text") ? JSON.parse(xhr.responseText) : null;
            if (!payload?.data || typeof payload.data !== "object") return;
            const batch = snapshot(payload.data, request.at);
            if (!batch.problems.length || (latest && request.order < latest.order)) return;
            batch.order = request.order;
            latest = batch;
            accept();
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
  return Object.freeze({ harvest, subscribe });
}
