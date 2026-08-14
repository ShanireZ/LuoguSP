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
//   用户（主）：GET /api/user/info/{uid}     ★ 洛谷**原生悬停卡自己用的接口**
//   用户（补）：GET /user/{uid}               + 同 header，只为拿主接口没有的两样东西
//
// ★★★ 用户数据为什么是两个来源（owner 2026-08-14：「能用原生接口的用原生卡片的接口」）：
//   主接口 `/api/user/info/{uid}` 是原生 UserFloatCard 调的那个（路由名 api.user.get_info，
//   在 `/_lfe/config` 的 routes 里可查）。它有三个决定性好处：
//     1. **951 B**，而 `/user/{uid}` 是 12~20 KB；
//     2. **`eloValue` / `elo` 在这里是真值**（在 `/user/{uid}` 里恒为 null）；
//     3. **未通过实名认证的用户照样 200**，而 `/user/{uid}` 直接 403
//        （`errorMessage: "该用户未通过实名认证"`）—— owner 报的「拿不到这条数据」就是它。
//   它缺两样：`gu`（咕值）与 `prizes`（获奖），所以补一发 `/user/{uid}`，**取不到就少画几行**。
//
// ★★★ 一个必须记死的陷阱：**两个接口都有 `submittedProblemCount`，含义不一样**。
//   实测 697932：主接口 5441、`/user/{uid}` 710，而洛谷个人页上写的「提交」是 **710**。
//   所以「通过 / 提交」这一行**只认 `/user/{uid}` 的口径**，拿不到就不画 ——
//   混着用会让我们显示一个比洛谷自己大 8 倍的数字。
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

  // 洛谷说得出口的失败原因（例如「该用户未通过实名认证」），按目标 key 记下来。
  // ★ 只转述洛谷自己的话，**不编原因** —— 说不出就让视图退回笼统的那句。
  const reasons = new Map();

  // 两个用户接口的响应体**即使不是 2xx 也是 JSON**（lentille 的错误页就是
  // `{status:403, data:{errorMessage:"该用户未通过实名认证"}}`），所以照样解析，
  // 只是把「有没有拿到 user」和「失败原因」分开返回。
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
        // ★ 补充载荷对未实名用户返回 403，**那不是缺陷是常态**：主接口照样有数据，
        //   这里拿不到就只是少画几行（咕值 / 获奖 / 通过·提交）。
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
    lastError: (key) => reasons.get(key) || null,
    getState: () => Object.freeze({ cached: cache.size, pending: pending.size }),
  });
}
