import { getMediaType, matchesGetUrl, SAME_ORIGIN_GET } from "../../browser/luogu-get-response.js";
import { PID_PATTERN } from "../problem-color/identity.js";
import {
  buildProblemCard,
  buildTagDictionary,
  buildUserCard,
  pickLastAttempt,
} from "./models.js";

const LENTILLE_INIT = Object.freeze({
  headers: Object.freeze({ "x-lentille-request": "content-only" }),
});
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 60;
const RETRY_COOLDOWN_MS = 2000;
const USER_DEADLINE_MS = 3500;
const RETRYABLE_READ = Symbol("retryable hover read");
const TEMPORARY_USER_READ = Object.freeze({ retry: true });

export function createHoverCardSources(config) {
  const {
    fetchPage,
    origin,
    problemData,
    nativeUserInfo,
    viewer = () => problemData?.viewerUid() ?? 0,
    clock,
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    logError = () => {},
  } = config || {};
  if (typeof fetchPage !== "function")
    throw new TypeError("Hover card sources require a fetch adapter");
  const now = () =>
    clock && typeof clock.now === "function" ? clock.now() : Date.now();

  const cache = new Map();
  const pending = new Map();
  const userPreviews = new Map();

  const remember = (key, value, retryAfter) => {
    // 簡單 FIFO 上限：hover 卡是瀏覽態快取，不值得為它上 LRU。
    if (!cache.has(key) && cache.size >= maxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { value, at: now(), retryAfter });
    return value;
  };

  const cached = (key) => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    const age = now() - entry.at;
    if (age > ttlMs) {
      cache.delete(key);
      return undefined;
    }
    if (entry.retryAfter !== undefined && age >= entry.retryAfter) return undefined;
    return entry.value;
  };

  const load = (key, run, signal) => {
    if (signal?.aborted) return Promise.resolve(null);
    const hit = cached(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const existing = pending.get(key);
    if (existing && !existing.signal?.aborted) return existing.promise;
    const task = Promise.resolve()
      .then(() => signal?.aborted ? null : run())
      .then((value) => {
        if (signal?.aborted) return null;
        if (value === RETRYABLE_READ) {
          // Retry on reopening. Repeated failures get a per-key cooldown.
          const repeated = cache.get(key)?.retryAfter !== undefined;
          return remember(key, null, repeated ? RETRY_COOLDOWN_MS : 0);
        }
        return remember(key, value);
      })
      .catch((error) => {
        if (signal?.aborted || error?.name === "AbortError") return null;
        logError(error);
        // 失敗也記住（記成 null），避免滑鼠來回掃時反覆重打同一個失敗請求。
        return remember(key, null);
      })
      .finally(() => {
        if (pending.get(key)?.promise === task) pending.delete(key);
      });
    pending.set(key, { promise: task, signal });
    return task;
  };

  const readResponse = async (path, signal, init) => {
    const url = new URL(path, origin).href;
    const response = await fetchPage(url, signal, { ...init, ...SAME_ORIGIN_GET });
    if (signal?.aborted || !matchesGetUrl(response, url)) return null;
    const { status } = response;
    return status === 408 || status === 429 || status >= 500 ? null : response;
  };
  const isJson = (response) => getMediaType(response) === "application/json";

  const readJson = async (path, signal, init = LENTILLE_INIT) => {
    try {
      const response = await readResponse(path, signal, init);
      if (!response) return RETRYABLE_READ;
      const { status } = response;
      if (status >= 400 && status < 500) return null;
      if (!response.ok || status !== 200 || !isJson(response)) return RETRYABLE_READ;
      return await response.json();
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      return RETRYABLE_READ;
    }
  };

  const tags = (signal) =>
    load("tags", async () => {
      const payload = await readJson("/_lfe/tags", signal, null);
      return payload === RETRYABLE_READ ? payload : buildTagDictionary(payload);
    }, signal);

  const problem = async (pid, viewerUid, signal, { href, onUpdate } = {}) => {
    if (typeof pid !== "string" || !PID_PATTERN.test(pid)) return null;
    let payload = problemData?.peek(pid, { href });
    const uid = Number(viewerUid || 0);
    const key = problemData?.recordKey(pid, href, uid);
    if (problemData && !key) return null;
    const current = () => !signal?.aborted && problemData?.recordKey(pid, href) === key;
    let dictionary = cached("tags");
    let attempt = null;
    let model = null;
    const publish = () => {
      if (!current()) return;
      model = buildProblemCard({ payload, tagDictionary: dictionary, lastAttempt: attempt });
      if (model) onUpdate?.(model);
    };
    if (payload) publish();
    try {
      const detail = problemData
        ? await problemData.load(pid, { href, signal, fields: ["name", "difficulty"] })
        : await load(`problem:${viewerUid || 0}:${pid}`, () =>
            readJson(`/problem/${encodeURIComponent(pid)}`, signal), signal);
      if (detail?.data?.problem?.pid === pid && detail !== payload) {
        payload = detail;
        publish();
      }
    } catch (error) {
      if (!signal?.aborted) logError(error);
    }
    if (!model || !current()) return model;
    const supplements = [];
    if (!dictionary && payload.data.problem.tags?.length)
      supplements.push(tags().then((value) => {
        if (!value) return;
        dictionary = value;
        publish();
      }));
    let stopRecords;
    if (Number.isSafeInteger(uid) && uid > 0) {
      const records = () => problemData?.records(pid, { href });
      const updateAttempt = (rows, fallback) => {
        if (!rows && !fallback) return;
        attempt = rows ? pickLastAttempt(rows) : fallback;
        publish();
      };
      stopRecords = problemData?.subscribeRecords(key, updateAttempt, signal);
      const existing = records();
      if (existing) updateAttempt(existing);
      else {
        const url = new URL(`/record/list?user=${uid}&pid=${pid}`, origin);
        const params = new URL(href || origin, origin).searchParams;
        for (const field of ["contestId", "lang"]) {
          const value = params.get(field);
          if (value) url.searchParams.set(field, value);
        }
        supplements.push(load(key ?? url.href, async () => {
          if (!current()) return null;
          const at = now();
          const payload = await readJson(url, signal);
          if (payload === null || payload === RETRYABLE_READ) return payload;
          if (payload?.template !== "record.list" || Number(payload.user?.uid) !== uid)
            return RETRYABLE_READ;
          const records = payload.data?.records;
          if (!Array.isArray(records?.result)) return RETRYABLE_READ;
          // The cache scopes these rows to the viewer already in effect.
          if (!current()) return null;
          problemData?.rememberPage({ template: payload.template, data: { records } }, url, at);
          return pickLastAttempt(records.result.filter((row) => row?.problem?.pid === pid && Number(row.user?.uid) === uid));
        }, signal).then((value) => updateAttempt(records(), value)));
      }
    }
    await Promise.all(supplements).finally(() => {
      if (!signal) stopRecords?.();
    });
    return model;
  };

  const readUserBranch = async (branch, uid, account, signal) => {
    try {
      const info = branch === "info";
      if (info) {
        const native = await nativeUserInfo?.read(uid, account, signal);
        if (Number(native?.user?.uid) === uid) return { payload: native };
      }
      if (signal.aborted || viewer() !== account) return TEMPORARY_USER_READ;
      const path = info ? `/api/user/info/${uid}` : `/user/${uid}`;
      const response = await readResponse(path, signal, info ? null : LENTILLE_INIT);
      if (!response || !isJson(response)) return TEMPORARY_USER_READ;
      if (response.ok !== false && response.status !== 200) return TEMPORARY_USER_READ;
      const payload = await Promise.resolve().then(() => response.json()).catch(() => null);
      if (response.ok === false) {
        const message = payload?.data?.errorMessage;
        return { reason: typeof message === "string" ? message : null };
      }
      const profile = info ? payload?.user : payload?.data?.user;
      return Number(profile?.uid) === uid ? { payload } : TEMPORARY_USER_READ;
    } catch {
      return TEMPORARY_USER_READ;
    }
  };

  const userModel = (state) => {
    const card = buildUserCard(state.info?.payload, state.page?.payload);
    return card && state.patch ? Object.freeze({ ...card, ...state.patch }) : card;
  };
  const notifyUser = (notify, model) => {
    if (!model) return;
    try {
      notify?.(model);
    } catch (error) {
      logError(error);
    }
  };

  function startUserPreview(key, target, account, state, missing) {
    const controller = new AbortController();
    const consumers = new Set();
    const remaining = new Set(missing);
    const preview = { state, consumers, finish };
    userPreviews.set(key, preview);

    const saveBranch = (branch, result) => {
      const readAt = now();
      const repeated = state[branch]?.retryAt !== undefined;
      state[branch] = {
        ...result,
        expires: readAt + ttlMs,
        retryAt: result.retry ? readAt + (repeated ? RETRY_COOLDOWN_MS : 0) : undefined,
      };
      if (result.payload) state.card = userModel(state);
      remember(key, state);
    };
    const timer = (clock?.setTimeout ?? setTimeout)(() => {
      if (viewer() === account)
        for (const branch of remaining) saveBranch(branch, TEMPORARY_USER_READ);
      finish(viewer() === account ? state.card : null);
    }, USER_DEADLINE_MS);

    function finish(model) {
      if (userPreviews.get(key) !== preview) return;
      userPreviews.delete(key);
      (clock?.clearTimeout ?? clearTimeout)(timer);
      controller.abort();
      for (const consumer of consumers) consumer.complete(model);
    }

    for (const branch of remaining) {
      void Promise.resolve().then(async () => {
        if (controller.signal.aborted) return;
        const result = await readUserBranch(branch, target, account, controller.signal);
        if (controller.signal.aborted) return;
        if (viewer() !== account) return finish(null);
        remaining.delete(branch);
        saveBranch(branch, result);
        if (result.payload)
          for (const consumer of consumers) notifyUser(consumer.onUpdate, state.card);
        if (!remaining.size) finish(state.card);
      });
    }
    return preview;
  }

  const user = (uid, signal, onUpdate) => {
    const target = Number(uid);
    if (!Number.isSafeInteger(target) || target <= 0 || signal?.aborted)
      return Promise.resolve(null);
    const account = viewer();
    const key = `${account}:user:${target}`;
    let preview = userPreviews.get(key);
    if (!preview) {
      const state = cached(key) ?? { card: null };
      const time = now();
      if (state.patch && time - state.patchAt > ttlMs) {
        state.patch = null;
        state.card = userModel(state);
      }
      for (const branch of ["info", "page"]) {
        if (state[branch]?.expires < time) {
          delete state[branch];
          state.card = userModel(state);
        }
      }
      const missing = ["info", "page"].filter(branch => !state[branch] || state[branch].retryAt <= time);
      if (!missing.length) return Promise.resolve(state.card);
      preview = startUserPreview(key, target, account, state, missing);
    }
    return new Promise(resolve => {
      const { consumers, state } = preview;
      const consumer = { onUpdate, complete };
      function complete(model) {
        signal?.removeEventListener("abort", cancel);
        consumers.delete(consumer);
        resolve(model);
      }
      function cancel() {
        complete(null);
        if (!consumers.size) preview.finish(null);
      }
      consumers.add(consumer);
      signal?.addEventListener("abort", cancel, { once: true });
      notifyUser(onUpdate, state.card);
    });
  };

  // 關注成功後卡片上的關係與粉絲數已經改了，快取裡那份必須跟著走，
  // 否則重新 hover 會把舊狀態擺回來 —— 看起來就像「關注沒生效」。
  const patchUser = (viewer, uid, patch) => {
    nativeUserInfo?.invalidate(uid, viewer);
    const key = `${viewer}:user:${uid}`;
    const state = userPreviews.get(key)?.state ?? cached(key);
    if (!state) return null;
    state.patch = { ...state.patch, ...patch };
    state.patchAt = now();
    if (state.card) state.card = Object.freeze({ ...state.card, ...patch });
    return state.card;
  };

  return Object.freeze({
    problem,
    user,
    patchUser,
    lastError: (key) => {
      const state = cached(`${viewer()}:${key}`);
      return state?.page?.reason || state?.info?.reason || null;
    },
  });
}
