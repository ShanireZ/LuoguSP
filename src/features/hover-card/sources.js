import { PID_PATTERN } from "./anchors.js";
import {
  buildProblemCard,
  buildTagDictionary,
  buildUserCard,
  pickLastAttempt,
} from "./models.js";

// 卡片資料源。★ 鐵律：一切資料只從 `.com.cn` 國內站或 `api.luogu.me` 保存站取，
// **絕不走 `www.luogu.com` 國際站** —— 普通使用者沒有代理，訪問不到。
// 本模組全部請求都是當前站同源。
//
//   題目：GET /problem/{pid}                 + x-lentille-request: content-only
//   標籤：GET /_lfe/tags                     （字典，帶 version，可長快取）
//   上次嘗試：GET /record/list?user=&pid=    + x-lentille-request: content-only
//   使用者（主）：GET /api/user/info/{uid}     ★ 洛谷**原生懸停卡自己用的介面**
//   使用者（補）：GET /user/{uid}               + 同 header，只為拿主介面沒有的兩樣東西
//
// ★★★ 使用者資料為什麼是兩個來源（owner 2026-08-14：「能用原生介面的用原生卡片的介面」）：
//   主介面 `/api/user/info/{uid}` 是原生 UserFloatCard 調的那個（路由名 api.user.get_info，
//   在 `/_lfe/config` 的 routes 裡可查）。它有三個決定性好處：
//     1. **951 B**，而 `/user/{uid}` 是 12~20 KB；
//     2. **`eloValue` / `elo` 在這裡是真值**（在 `/user/{uid}` 裡恆為 null）；
//     3. **未通過實名認證的使用者照樣 200**，而 `/user/{uid}` 直接 403
//        （`errorMessage: "该用户未通过实名认证"`）—— owner 報的「拿不到這條資料」就是它。
//   它缺兩樣：`gu`（咕值）與 `prizes`（獲獎），所以補一發 `/user/{uid}`，**取不到就少畫幾行**。
//
// ★★★ 一個必須記死的陷阱：**兩個介面都有 `submittedProblemCount`，含義不一樣**。
//   實測 697932：主介面 5441、`/user/{uid}` 710，而洛谷個人頁上寫的「提交」是 **710**。
//   所以「通過 / 提交」這一行**只認 `/user/{uid}` 的口徑**，拿不到就不畫 ——
//   混著用會讓我們顯示一個比洛谷自己大 8 倍的數字。
//
// 全部按 key 快取並共享在途請求：hover 會反覆進出同一個錨點，不能每次都打網路。

const LENTILLE_INIT = Object.freeze({
  headers: Object.freeze({ "x-lentille-request": "content-only" }),
});
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 60;
const RETRY_COOLDOWN_MS = 2000;
const RETRYABLE_READ = Symbol("retryable hover read");

export function createHoverCardSources(config) {
  const {
    fetchPage,
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

  const readJson = async (path, signal, init = LENTILLE_INIT) => {
    try {
      const response = await fetchPage(path, signal, init);
      if (!response) return RETRYABLE_READ;
      if (response.ok === false) {
        const { status } = response;
        return status === 408 || status === 429 || status >= 500 ? RETRYABLE_READ : null;
      }
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

  // 上次嘗試：匿名訪客沒有提交記錄，不必發這個請求。
  const lastAttempt = (pid, viewerUid, signal, href) => {
    const uid = Number(viewerUid);
    if (!Number.isSafeInteger(uid) || uid <= 0) return Promise.resolve(null);
    const existing = problemData?.records?.(pid, { href });
    if (existing) return Promise.resolve(pickLastAttempt(existing));
    const query = new URLSearchParams({ user: String(uid), pid });
    if (href) {
      const params = new URLSearchParams(href.split("?")[1]?.split("#")[0]);
      for (const field of ["contestId", "lang"]) {
        const value = params.get(field);
        if (value) query.set(field, value);
      }
    }
    return load(`record:${query}`, async () => {
      const payload = await readJson(
        `/record/list?${query}`,
        signal,
      );
      if (payload === null || payload === RETRYABLE_READ) return payload;
      if (payload?.template !== "record.list" || Number(payload.user?.uid) !== uid)
        return RETRYABLE_READ;
      const rows = payload.data?.records?.result;
      return Array.isArray(rows) ? pickLastAttempt(rows.filter((row) =>
        row?.problem?.pid === pid && Number(row.user?.uid) === uid,
      )) : RETRYABLE_READ;
    }, signal);
  };

  const problem = async (pid, viewerUid, signal, { href, onUpdate } = {}) => {
    if (typeof pid !== "string" || !PID_PATTERN.test(pid)) return null;
    let payload = problemData?.peek(pid, { href });
    let dictionary = cached("tags");
    let attempt = null;
    let model = null;
    const publish = () => {
      if (signal?.aborted || (problemData && problemData.viewerUid() !== (viewerUid || 0))) return;
      model = buildProblemCard({ payload, tagDictionary: dictionary, lastAttempt: attempt });
      if (model) onUpdate?.(model);
    };
    if (payload) publish();
    try {
      const detail = problemData
        ? await problemData.load(pid, { href, signal })
        : await load(`problem:${viewerUid || 0}:${pid}`, () =>
            readJson(`/problem/${encodeURIComponent(pid)}`, signal), signal);
      if (detail?.data?.problem?.pid === pid && detail !== payload) {
        payload = { data: {
          ...detail.data,
          problem: { ...payload?.data.problem, ...detail.data.problem },
        } };
        publish();
      }
    } catch (error) {
      if (!signal?.aborted) logError(error);
    }
    if (!model || signal?.aborted) return model;
    const supplements = [];
    if (!dictionary && payload.data.problem.tags?.length)
      supplements.push(tags().then((value) => {
        if (!value) return;
        dictionary = value;
        publish();
      }));
    if (viewerUid)
      supplements.push(lastAttempt(pid, viewerUid, signal, href).then((value) => {
        if (!value) return;
        attempt = value;
        publish();
      }));
    await Promise.all(supplements);
    return model;
  };

  // 洛谷說得出口的失敗原因（例如「該使用者未通過實名認證」），按目標 key 記下來。
  // ★ 只轉述洛谷自己的話，**不編原因** —— 說不出就讓視圖退回籠統的那句。
  const reasons = new Map();

  // 兩個使用者介面的回應體**即使不是 2xx 也是 JSON**（lentille 的錯誤頁就是
  // `{status:403, data:{errorMessage:"该用户未通过实名认证"}}`），所以照樣解析，
  // 只是把「有沒有拿到 user」和「失敗原因」分開回傳。
  const readMaybe = async (path, init, signal) => {
    try {
      const response = await fetchPage(path, signal, init);
      if (!response) return null;
      return await response.json();
    } catch {
      return null;
    }
  };

  const user = (uid, onUpdate) => {
    const target = Number(uid);
    if (!Number.isSafeInteger(target) || target <= 0)
      return Promise.resolve(null);
    const account = viewer();
    const key = `${account}:user:${target}`;
    const hit = cached(key);
    if (hit !== undefined) return Promise.resolve(hit);
    let preview = userPreviews.get(key);
    if (!preview) {
      preview = { card: null, patch: null, listeners: new Set() };
      userPreviews.set(key, preview);
    }
    if (onUpdate) {
      preview.listeners.add(onUpdate);
      if (preview.card) onUpdate(preview.card);
    }
    return load(key, async () => {
      let info;
      let page;
      let message;
      const publish = () => {
        if (viewer() !== account) return;
        const card = buildUserCard(info, page);
        if (!card) return;
        preview.card = preview.patch ? Object.freeze({ ...card, ...preview.patch }) : card;
        for (const notify of preview.listeners) notify(preview.card);
      };
      const readInfo = async () =>
        (await nativeUserInfo?.read(target, account)) || readMaybe(`/api/user/info/${target}`, null);
      await Promise.all([
        readInfo().then(payload => {
          if (Number(payload?.user?.uid) === target) {
            info = payload;
            publish();
          } else message ||= payload?.data?.errorMessage;
        }),
        readMaybe(`/user/${target}`, LENTILLE_INIT).then(payload => {
          if (Number(payload?.data?.user?.uid) === target) {
            page = payload;
            publish();
          } else message = payload?.data?.errorMessage || message;
        }),
      ]);
      if (!preview.card && typeof message === "string" && message) reasons.set(key, message);
      else reasons.delete(key);
      return preview.card;
    }).finally(() => {
      preview.listeners.delete(onUpdate);
      if (!pending.has(key) && userPreviews.get(key) === preview) userPreviews.delete(key);
    });
  };

  // 關注成功後卡片上的關係與粉絲數已經改了，快取裡那份必須跟著走，
  // 否則重新 hover 會把舊狀態擺回來 —— 看起來就像「關注沒生效」。
  const patchUser = (viewer, uid, patch) => {
    nativeUserInfo?.invalidate(uid, viewer);
    const key = `${viewer}:user:${uid}`;
    const preview = userPreviews.get(key);
    if (preview) {
      preview.patch = { ...preview.patch, ...patch };
      if (preview.card) preview.card = Object.freeze({ ...preview.card, ...patch });
    }
    const entry = cache.get(key);
    if (!entry?.value) return preview?.card;
    const value = Object.freeze({ ...entry.value, ...patch });
    cache.set(key, { at: entry.at, value });
    return value;
  };

  return Object.freeze({
    problem,
    user,
    tags,
    patchUser,
    lastError: (key) => reasons.get(`${viewer()}:${key}`) || null,
    getState: () => Object.freeze({ cached: cache.size, pending: pending.size }),
  });
}
