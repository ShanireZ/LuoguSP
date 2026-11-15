import { PID_PATTERN } from "./identity.js";
import { collectDifficultyBatches } from "./lentille-harvest.js";
import { DIFFICULTY_TIERS } from "../../core/luogu-difficulty.js";

export const LENTILLE_INIT = Object.freeze({
  headers: Object.freeze({ "x-lentille-request": "content-only" }),
});

function project(problem, pid) {
  const result = { pid };
  if (typeof problem.name === "string") result.name = problem.name;
  if (Number.isInteger(problem.difficulty) && problem.difficulty >= 0 &&
      problem.difficulty < DIFFICULTY_TIERS)
    result.difficulty = problem.difficulty;
  for (const field of ["totalAccepted", "totalSubmit", "score"])
    if (Number.isFinite(problem[field])) result[field] = problem[field];
  for (const field of ["submitted", "accepted"])
    if (typeof problem[field] === "boolean") result[field] = problem[field];
  if (Array.isArray(problem.tags)) result.tags = problem.tags.filter(Number.isInteger);
  if (problem.limits && typeof problem.limits === "object") {
    result.limits = {};
    for (const key of ["time", "memory"]) {
      const values = problem.limits[key];
      if (Array.isArray(values) && values.every(Number.isFinite)) result.limits[key] = values.slice();
    }
  }
  if (Array.isArray(problem.samples) &&
      problem.samples.every((pair) => Array.isArray(pair) &&
        typeof pair[0] === "string" && typeof pair[1] === "string"))
    result.samples = problem.samples.map(([input, output]) => [input, output]);
  if (problem.bestRecord && Number.isSafeInteger(problem.bestRecord.id)) {
    const { id, score, status } = problem.bestRecord;
    result.bestRecord = { id, score, status };
  }
  return result;
}

function parsePage(text) {
  try {
    return JSON.parse(text);
  } catch {
    const context = text.match(/<script\b[^>]*\bid=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/i);
    const legacy = text.match(/_feInjection\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/);
    try {
      return JSON.parse(context?.[1] ?? (legacy && decodeURIComponent(legacy[1])));
    } catch {
      return null;
    }
  }
}

export function createProblemData({
  origin, text, refresh = () => {}, legacyViewer = () => 0,
  now = () => Date.now(), ttlMs = 5 * 60 * 1000,
}) {
  const summaries = new Map();
  const details = new Map();
  const recordLists = new Map();
  let observedViewer;
  let viewerAt = -Infinity;

  const scope = (url, viewer) => {
    const params = new URLSearchParams();
    for (const field of ["contestId", "lang"]) {
      const value = url?.searchParams.get(field);
      if (value) params.set(field, value);
    }
    return { viewer, params };
  };
  const viewer = () => observedViewer ?? legacyViewer();
  const keyOf = (pid, context) => `${context.viewer}:${context.params}:${pid}`;
  const contextFor = (pid, href) => {
    let url;
    if (href) {
      try {
        url = new URL(href, origin);
      } catch { return null; }
      if (url.origin !== origin || url.pathname.replace(/\/$/, "") !== `/problem/${pid}`)
        return null;
    }
    return scope(url, viewer());
  };
  const read = (map, key) => {
    const entry = map.get(key);
    if (entry && now() - entry.at < ttlMs) return entry;
    map.delete(key);
    return null;
  };
  const remember = (map, key, entry, limit) => {
    if ((map.get(key)?.at ?? -Infinity) > entry.at) return;
    map.delete(key);
    map.set(key, entry);
    if (map.size > limit) map.delete(map.keys().next().value);
  };
  const rememberDetail = (data, pid, context, at) => {
    const entry = {
      at,
      problem: project(data.problem, pid),
      bookmarked: typeof data.bookmarked === "boolean" ? data.bookmarked : undefined,
    };
    remember(details, keyOf(pid, context), entry, 120);
  };
  const rememberPage = (page, url, at) => {
    if (page.viewer !== undefined && at >= viewerAt) {
      if (observedViewer !== page.viewer) {
        summaries.clear();
        details.clear();
        recordLists.clear();
      }
      observedViewer = page.viewer;
      viewerAt = at;
    }
    if (page.viewer !== undefined && page.viewer !== viewer()) return;
    const context = scope(url, page.viewer ?? viewer());
    if (page.template === "record.list" && context.viewer > 0 &&
        Number(url.searchParams.get("user")) === context.viewer) {
      const pid = url.searchParams.get("pid");
      const rows = page.data.records?.result;
      if (pid && PID_PATTERN.test(pid) && Array.isArray(rows) &&
          (!url.searchParams.has("page") || url.searchParams.get("page") === "1") &&
          !["status", "language", "orderBy"].some((key) => url.searchParams.has(key))) {
        const records = rows
          .filter((row) => row?.problem?.pid === pid && Number(row.user?.uid) === context.viewer)
          .map(({ id, submitTime, score, status, time, memory }) => ({
            id, submitTime, score, status, time, memory,
          }));
        remember(recordLists, keyOf(pid, context), { at, records }, 30);
      }
    }
    const detail = page.data.problem;
    const hasDetail = detail?.pid && url.pathname.replace(/\/$/, "") === `/problem/${detail.pid}` &&
        PID_PATTERN.test(detail.pid);
    for (const batch of collectDifficultyBatches(page.data)) {
      for (const problem of batch.problems()) {
        if (hasDetail && problem === detail) continue;
        if (typeof problem?.pid !== "string" || !PID_PATTERN.test(problem.pid)) continue;
        remember(summaries, keyOf(problem.pid, context), {
          at, problem: project(problem, problem.pid),
        }, 4000);
      }
    }
    if (hasDetail) rememberDetail(page.data, detail.pid, context, at);
  };
  const payload = (key) => {
    const detail = read(details, key);
    const summary = read(summaries, key);
    if (!detail && !summary) return null;
    return {
      data: {
        problem: detail && summary && summary.at >= detail.at
          ? { ...detail.problem, ...summary.problem }
          : detail?.problem ?? summary.problem,
        bookmarked: detail?.bookmarked,
      },
    };
  };
  const peek = (pid, { href, refreshPage = true } = {}) => {
    if (typeof pid !== "string" || !PID_PATTERN.test(pid)) return null;
    if (refreshPage) refresh();
    const context = contextFor(pid, href);
    return context ? payload(keyOf(pid, context)) : null;
  };
  const load = async (pid, { href, signal } = {}) => {
    if (typeof pid !== "string" || !PID_PATTERN.test(pid) || signal?.aborted) return null;
    refresh();
    const context = contextFor(pid, href);
    if (!context) return null;
    const key = keyOf(pid, context);
    if (read(details, key)) return payload(key);

    const path = `/problem/${encodeURIComponent(pid)}`;
    const query = new URLSearchParams(context.params);
    query.set("_contentOnly", "1");
    const at = now();
    try {
      const reply = await text(`${path}?${query}`, { key, signal });
      if (signal?.aborted || viewer() !== context.viewer) return null;
      const page = parsePage(reply);
      if (page?.user === null && context.viewer !== 0) return null;
      if (page?.user?.uid != null && Number(page.user.uid) !== context.viewer) return null;
      const data = page?.data ?? page?.currentData;
      const problem = data?.problem;
      if (problem && (problem.pid === undefined || problem.pid === pid))
        rememberDetail(data, pid, context, at);
      return payload(key);
    } catch (error) {
      if (signal?.aborted || [401, 403, 404].includes(error?.status)) return null;
      throw error;
    }
  };
  const viewerUid = () => {
    refresh();
    return viewer();
  };
  const records = (pid, { href } = {}) => {
    const context = contextFor(pid, href);
    return context ? read(recordLists, keyOf(pid, context))?.records : undefined;
  };
  return Object.freeze({ peek, load, rememberPage, viewerUid, records });
}
