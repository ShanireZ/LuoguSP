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
//   上次嘗試：GET /record/list?user=&pid=    ★ 舊版頁面，不吃 lentille header，
//                                             資料在 _feInjection.currentData.records
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

// 舊版頁面把資料塞在 `window._feInjection = JSON.parse(decodeURIComponent("…"))` 裡。
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
    // 簡單 FIFO 上限：hover 卡是瀏覽態快取，不值得為它上 LRU。
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
        // 失敗也記住（記成 null），避免滑鼠來回掃時反覆重打同一個失敗請求。
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

  // 上次嘗試：匿名訪客沒有提交記錄，不必發這個請求。
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

  // 洛谷說得出口的失敗原因（例如「該使用者未通過實名認證」），按目標 key 記下來。
  // ★ 只轉述洛谷自己的話，**不編原因** —— 說不出就讓視圖退回籠統的那句。
  const reasons = new Map();

  // 兩個使用者介面的回應體**即使不是 2xx 也是 JSON**（lentille 的錯誤頁就是
  // `{status:403, data:{errorMessage:"该用户未通过实名认证"}}`），所以照樣解析，
  // 只是把「有沒有拿到 user」和「失敗原因」分開回傳。
  const readMaybe = async (path, init, signal) => {
    const response = await fetchPage(path, signal, init);
    if (!response) return null;
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  };

  const user = (uid) => {
    const target = Number(uid);
    if (!Number.isSafeInteger(target) || target <= 0)
      return Promise.resolve(null);
    const key = `user:${target}`;
    return load(key, async () => {
      const [info, page] = await Promise.all([
        readMaybe(`/api/user/info/${target}`, null, undefined),
        // ★ 補充載荷對未實名使用者回傳 403，**那不是缺陷是常態**：主介面照樣有資料，
        //   這裡拿不到就只是少畫幾行（咕值 / 獲獎 / 通過·提交）。
        readMaybe(`/user/${target}`, LENTILLE_INIT, undefined),
      ]);
      const card = buildUserCard(info, page);
      if (card) {
        reasons.delete(key);
        return card;
      }
      const message =
        (info && info.data && info.data.errorMessage) ||
        (page && page.data && page.data.errorMessage) ||
        null;
      if (typeof message === "string" && message) reasons.set(key, message);
      else reasons.delete(key);
      return null;
    });
  };

  // 關注成功後卡片上的關係與粉絲數已經改了，快取裡那份必須跟著走，
  // 否則重新 hover 會把舊狀態擺回來 —— 看起來就像「關注沒生效」。
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
    lastError: (key) => reasons.get(key) || null,
    getState: () => Object.freeze({ cached: cache.size, pending: pending.size }),
  });
}
