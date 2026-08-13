import {
  buildProblemCard,
  buildTagDictionary,
  buildUserCard,
  pickLastAttempt,
} from "./models.js";

// 卡片数据源。★ 铁律：一切数据只从 `.com.cn` 国内站或 `api.luogu.me` 保存站取，
// **绝不走 `www.luogu.com` 国际站** —— 普通用户没有代理，访问不到。
// 本模块全部请求都是当前站同源。
//
//   题目：GET /problem/{pid}                 + x-lentille-request: content-only
//   标签：GET /_lfe/tags                     （字典，带 version，可长缓存）
//   上次尝试：GET /record/list?user=&pid=    ★ 旧版页面，不吃 lentille header，
//                                             数据在 _feInjection.currentData.records
//   用户：GET /user/{uid}                    + 同 header
//
// 全部按 key 缓存并共享在途请求：hover 会反复进出同一个锚点，不能每次都打网络。

const LENTILLE_INIT = Object.freeze({
  headers: Object.freeze({ "x-lentille-request": "content-only" }),
});
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 60;
const PID_PATTERN = /^[A-Za-z0-9]+$/;

// 旧版页面把数据塞在 `window._feInjection = JSON.parse(decodeURIComponent("…"))` 里。
export function parseLegacyInjection(html) {
  const match = String(html || "").match(
    /_feInjection\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/,
  );
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch (error) {
    return null;
  }
}

export function createHoverCardSources(config) {
  const {
    fetchPage,
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

  const remember = (key, value) => {
    // 简单 FIFO 上限：hover 卡是浏览态缓存，不值得为它上 LRU。
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { value, at: now() });
    return value;
  };

  const cached = (key) => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (now() - entry.at > ttlMs) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  };

  const load = (key, run) => {
    const hit = cached(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const existing = pending.get(key);
    if (existing) return existing;
    const task = Promise.resolve()
      .then(run)
      .then((value) => remember(key, value))
      .catch((error) => {
        logError(error);
        // 失败也记住（记成 null），避免鼠标来回扫时反复重打同一个失败请求。
        return remember(key, null);
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };

  const readJson = async (path, signal) => {
    const response = await fetchPage(path, signal, LENTILLE_INIT);
    if (!response || response.ok === false) return null;
    return response.json();
  };

  const tags = (signal) =>
    load("tags", async () =>
      buildTagDictionary(
        await (async () => {
          const response = await fetchPage("/_lfe/tags", signal, null);
          if (!response || response.ok === false) return null;
          return response.json();
        })(),
      ),
    );

  // 上次尝试：匿名访客没有提交记录，不必发这个请求。
  const lastAttempt = (pid, viewerUid, signal) => {
    const uid = Number(viewerUid);
    if (!Number.isSafeInteger(uid) || uid <= 0) return Promise.resolve(null);
    return load(`record:${uid}:${pid}`, async () => {
      const response = await fetchPage(
        `/record/list?user=${uid}&pid=${encodeURIComponent(pid)}`,
        signal,
        null,
      );
      if (!response || response.ok === false) return null;
      const injection = parseLegacyInjection(await response.text());
      const box = injection && injection.currentData && injection.currentData.records;
      return pickLastAttempt(box);
    });
  };

  const problem = async (pid, viewerUid, signal) => {
    if (typeof pid !== "string" || !PID_PATTERN.test(pid)) return null;
    return load(`problem:${viewerUid || 0}:${pid}`, async () => {
      const [payload, dictionary, attempt] = await Promise.all([
        readJson(`/problem/${encodeURIComponent(pid)}`, signal),
        tags(signal),
        lastAttempt(pid, viewerUid, signal),
      ]);
      return buildProblemCard({
        payload,
        tagDictionary: dictionary,
        lastAttempt: attempt,
      });
    });
  };

  const user = (uid) => {
    const target = Number(uid);
    if (!Number.isSafeInteger(target) || target <= 0)
      return Promise.resolve(null);
    return load(`user:${target}`, async () =>
      buildUserCard(await readJson(`/user/${target}`, undefined)),
    );
  };

  // 关注成功后卡片上的关系与粉丝数已经改了，缓存里那份必须跟着走，
  // 否则重新 hover 会把旧状态摆回来 —— 看起来就像「关注没生效」。
  const patchUser = (uid, patch) => {
    const key = `user:${Number(uid)}`;
    const entry = cache.get(key);
    if (!entry || !entry.value) return;
    cache.set(key, {
      at: entry.at,
      value: Object.freeze({ ...entry.value, ...patch }),
    });
  };

  return Object.freeze({
    problem,
    user,
    tags,
    patchUser,
    getState: () => Object.freeze({ cached: cache.size, pending: pending.size }),
  });
}
