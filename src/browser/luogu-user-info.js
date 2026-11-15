const INFO_PATH = /^\/api\/user\/info\/(\d+)$/;
const INFO_TTL_MS = 5 * 60_000;
const USER_FIELDS = [
  "uid", "name", "color", "avatar", "background", "slogan", "badge", "isAdmin",
  "ccfLevel", "xcpcLevel", "followingCount", "followerCount", "eloValue",
  "userRelationship", "reverseUserRelationship",
];

export function createNativeUserInfo({ origin, viewer }) {
  const cached = new Map();
  const pending = new Map();

  function uidFromUrl(raw) {
    if (!String(raw).includes("/api/user/info/")) return null;
    try {
      const url = new URL(raw, origin);
      const uid = Number(INFO_PATH.exec(url.pathname)?.[1]);
      return url.origin === origin && Number.isSafeInteger(uid) && uid > 0 ? uid : null;
    } catch {
      return null;
    }
  }

  function prepare(raw) {
    const uid = uidFromUrl(raw);
    if (!uid) return null;
    return (xhr) => {
      const account = viewer();
      const key = `${account}:${uid}`;
      let resolve;
      const request = new Promise(done => { resolve = done; });
      pending.set(key, request);
      xhr.addEventListener("loadend", () => {
        let payload = null;
        try {
          if (xhr.status === 200 && uidFromUrl(xhr.responseURL) === uid && viewer() === account) {
            const result = xhr.responseType === "json" ? xhr.response : JSON.parse(xhr.responseText);
            const user = result?.user;
            if (Number(user?.uid) === uid) {
              const fields = Object.fromEntries(USER_FIELDS.filter(field => field in user)
                .map(field => [field, user[field]]));
              if (user.elo) fields.elo = { rating: user.elo.rating };
              payload = { user: fields };
            }
          }
        } catch { /* An unsupported native response leaves the fallback available. */ }
        if (pending.get(key) === request) {
          pending.delete(key);
          if (payload) {
            cached.delete(key);
            cached.set(key, { payload, expires: Date.now() + INFO_TTL_MS });
            if (cached.size > 60) cached.delete(cached.keys().next().value);
          }
        } else payload = null;
        resolve(payload);
      }, { once: true });
    };
  }

  async function read(uid, account, signal) {
    if (signal?.aborted) return null;
    const key = `${account}:${uid}`;
    const request = pending.get(key);
    if (request) {
      // A stalled native lookup must not block the preview indefinitely.
      let timer;
      let cancel;
      try {
        const payload = await Promise.race([request, new Promise(resolve => {
          cancel = () => resolve(null);
          timer = setTimeout(cancel, 500);
          signal?.addEventListener("abort", cancel, { once: true });
        })]);
        if (payload && !signal?.aborted && viewer() === account) return payload;
        return null;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    }
    const entry = cached.get(key);
    if (entry?.expires > Date.now() && viewer() === account) return entry.payload;
    cached.delete(key);
    return null;
  }

  function invalidate(uid, account) {
    const key = `${account}:${uid}`;
    cached.delete(key);
    pending.delete(key);
  }

  return Object.freeze({ prepare, read, invalidate });
}
