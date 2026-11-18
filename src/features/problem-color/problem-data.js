import { PID_PATTERN } from "./identity.js";
import { collectDifficultyBatches } from "./lentille-harvest.js";
import { DIFFICULTY_TIERS } from "../../core/luogu-difficulty.js";

export const LENTILLE_INIT = Object.freeze({
  headers: Object.freeze({ "x-lentille-request": "content-only" }),
});

function project(problem) {
  const result = {};
  if (typeof problem.name === "string" && problem.name.trim()) result.name = problem.name;
  if (Number.isInteger(problem.difficulty) && problem.difficulty >= 0 &&
      problem.difficulty < DIFFICULTY_TIERS)
    result.difficulty = problem.difficulty;
  for (const field of ["totalAccepted", "totalSubmit", "score"])
    if (Number.isFinite(problem[field])) result[field] = problem[field];
  for (const field of ["submitted", "accepted"])
    if (typeof problem[field] === "boolean") result[field] = problem[field];
  if (Array.isArray(problem.tags)) {
    const tags = problem.tags.filter(Number.isInteger);
    if (tags.length || !problem.tags.length) result.tags = tags;
  }
  if (problem.limits && typeof problem.limits === "object") {
    for (const key of ["time", "memory"]) {
      const values = problem.limits[key];
      if (Array.isArray(values) && values.length && values.every(Number.isFinite))
        result[`limits.${key}`] = values.slice();
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
  const isFresh = (at, currentTime) => currentTime - at < ttlMs;

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
  const readRecords = (key) => {
    const entry = recordLists.get(key);
    if (entry && isFresh(entry.at, now())) return entry;
    recordLists.delete(key);
    return null;
  };
  const remember = (map, key, entry, limit) => {
    map.delete(key);
    map.set(key, entry);
    if (map.size > limit) map.delete(map.keys().next().value);
  };
  const readFields = (map, key, currentTime) => {
    const fields = map.get(key);
    if (!fields) return null;
    for (const [field, { at }] of fields) {
      if (!isFresh(at, currentTime)) fields.delete(field);
    }
    if (fields.size) return fields;
    map.delete(key);
    return null;
  };
  const rememberFields = (map, key, values, at, limit) => {
    const currentTime = now();
    if (!isFresh(at, currentTime)) return;
    const fields = readFields(map, key, currentTime) ?? new Map();
    let changed = false;
    // An older response can fill an omission without renewing other fields.
    for (const [field, value] of Object.entries(values)) {
      if ((fields.get(field)?.at ?? -Infinity) > at) continue;
      fields.set(field, { value, at });
      changed = true;
    }
    if (changed) remember(map, key, fields, limit);
  };
  const rememberDetail = (data, pid, context, at) => {
    if (!data.problem || typeof data.problem !== "object" || Array.isArray(data.problem)) return;
    const values = project(data.problem);
    if (!Object.keys(values).length) return;
    if (typeof data.bookmarked === "boolean") values.bookmarked = data.bookmarked;
    rememberFields(details, keyOf(pid, context), values, at, 120);
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
        const key = keyOf(pid, context);
        if ((recordLists.get(key)?.at ?? -Infinity) <= at)
          remember(recordLists, key, { at, records }, 30);
      }
    }
    const detail = page.data.problem;
    const hasDetail = detail?.pid && url.pathname.replace(/\/$/, "") === `/problem/${detail.pid}` &&
        PID_PATTERN.test(detail.pid);
    for (const batch of collectDifficultyBatches(page.data)) {
      for (const problem of batch.problems()) {
        if (hasDetail && problem === detail) continue;
        if (typeof problem?.pid !== "string" || !PID_PATTERN.test(problem.pid)) continue;
        rememberFields(summaries, keyOf(problem.pid, context), project(problem), at, 4000);
      }
    }
    if (hasDetail) rememberDetail(page.data, detail.pid, context, at);
  };
  const payload = (pid, key, currentTime = now(), detail = readFields(details, key, currentTime)) => {
    const summary = readFields(summaries, key, currentTime);
    if (!detail && !summary) return null;
    const values = {};
    for (const [field, { value }] of detail ?? []) values[field] = value;
    for (const [field, { value, at }] of summary ?? []) {
      if (at >= (detail?.get(field)?.at ?? -Infinity)) values[field] = value;
    }
    const { "limits.time": time, "limits.memory": memory, bookmarked, ...fields } = values;
    const problem = { pid, ...fields };
    if (time) (problem.limits ??= {}).time = time;
    if (memory) (problem.limits ??= {}).memory = memory;
    return { data: { problem, bookmarked } };
  };
  const peek = (pid, { href, refreshPage = true } = {}) => {
    if (typeof pid !== "string" || !PID_PATTERN.test(pid)) return null;
    if (refreshPage) refresh();
    const context = contextFor(pid, href);
    return context ? payload(pid, keyOf(pid, context)) : null;
  };
  const load = async (pid, { href, signal, fields = [] } = {}) => {
    if (typeof pid !== "string" || !PID_PATTERN.test(pid) || signal?.aborted) return null;
    refresh();
    const context = contextFor(pid, href);
    if (!context) return null;
    const key = keyOf(pid, context);
    let at = now();
    const detail = readFields(details, key, at);
    if (detail && fields.every((field) => field === "limits"
      ? detail.has("limits.time") || detail.has("limits.memory")
      : field === "pid" || (field !== "bookmarked" && detail.has(field))))
      return payload(pid, key, at, detail);

    const path = `/problem/${encodeURIComponent(pid)}`;
    const query = new URLSearchParams(context.params);
    query.set("_contentOnly", "1");
    try {
      const reply = await text(`${path}?${query}`, {
        key, signal, onScheduled: (scheduledAt) => { at = scheduledAt; },
      });
      if (signal?.aborted || viewer() !== context.viewer) return null;
      const page = parsePage(reply);
      if (page?.user === null && context.viewer !== 0) return null;
      if (page?.user?.uid != null && Number(page.user.uid) !== context.viewer) return null;
      const data = page?.data ?? page?.currentData;
      const problem = data?.problem;
      if (problem && (problem.pid === undefined || problem.pid === pid))
        rememberDetail(data, pid, context, at);
      return payload(pid, key);
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
    return context ? readRecords(keyOf(pid, context))?.records : undefined;
  };
  return Object.freeze({ peek, load, rememberPage, viewerUid, records });
}
