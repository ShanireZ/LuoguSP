// 受限文章的「已確認互動狀態」持久層。
// 唯一寫入來源是洛谷官方寫介面的成功回應（見 article-write-observer.js）；
// 保存站快照是公共存檔，永遠不進這裡。記錄按「當前登入 UID + 文章 ID」隔離：
// 匿名訪客既不讀也不寫，帳號切換後讀不到上一個帳號的狀態。
const STORE_KEY = "luogusp.article-interaction.v2";
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 200;
const FIELDS = ["voted", "favored", "upvote", "favorCount"];

// ★ Number(null) === 0 且 Number.isFinite(0) 為真：只判 isFinite 會把「未確認」的計數
// 悄悄變成 0，反過來蓋掉保存站快照裡的真實值。未知必須留 null。
const countOrNull = (value) =>
  value === null || value === undefined || value === "" ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);
const validUid = (uid) => Number.isSafeInteger(uid) && uid > 0;
const validLid = (lid) => typeof lid === "string" && /^[A-Za-z0-9]+$/.test(lid);
const entryKey = (uid, lid) => `${uid}:${lid}`;

export function readInteractionTimes(record) {
  if (record && (Object.hasOwn(record, "voteAt") || Object.hasOwn(record, "favorAt"))) {
    return { voteAt: countOrNull(record.voteAt), favorAt: countOrNull(record.favorAt) };
  }
  // Legacy v2 records only stored an aggregate time. Import it without
  // advancing either clock, and never apply it to an already split record.
  const legacyAt = countOrNull(record?.at);
  return { voteAt: legacyAt, favorAt: legacyAt };
}

function normalizeRecord(value, cutoff) {
  if (!value || typeof value !== "object") return null;
  const { voteAt, favorAt } = readInteractionTimes(value);
  const voted = value.voted === 1 || value.voted === -1 || value.voted === 0
    ? value.voted
    : null;
  const favored = typeof value.favored === "boolean" ? value.favored : null;
  const upvote = countOrNull(value.upvote);
  const favorCount = countOrNull(value.favorCount);
  const keepVote = voteAt !== null && voteAt >= cutoff && (voted !== null || upvote !== null);
  const keepFavor = favorAt !== null && favorAt >= cutoff && (favored !== null || favorCount !== null);
  if (!keepVote && !keepFavor) return null;
  return {
    voted: keepVote ? voted : null,
    favored: keepFavor ? favored : null,
    upvote: keepVote ? upvote : null,
    favorCount: keepFavor ? favorCount : null,
    voteAt: keepVote ? voteAt : null,
    favorAt: keepFavor ? favorAt : null,
    // Keep the aggregate for eviction ordering and older v2 readers.
    at: Math.max(keepVote ? voteAt : -Infinity, keepFavor ? favorAt : -Infinity),
  };
}

export function createArticleInteractionStore(config) {
  const {
    storage,
    now = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    key = STORE_KEY,
  } = config || {};
  const usable =
    storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function";

  const load = (at = now()) => {
    if (!usable) return new Map();
    let raw = null;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      return null;
    }
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      /* 損壞的負載按空表處理，下一次寫入會整體覆蓋 */
    }
    const entries = new Map();
    if (parsed && typeof parsed === "object")
      for (const [entry, value] of Object.entries(parsed)) {
        const record = normalizeRecord(value, at - ttlMs);
        if (record) entries.set(entry, record);
      }
    return entries;
  };

  const persist = (entries) => {
    const kept = [...entries.entries()]
      .sort((left, right) => right[1].at - left[1].at)
      .slice(0, Math.max(1, maxEntries));
    try {
      storage.setItem(key, JSON.stringify(Object.fromEntries(kept)));
      return true;
    } catch (error) {
      return false;
    }
  };

  const read = ({ uid, lid } = {}) => {
    if (!usable || !validUid(uid) || !validLid(lid)) return null;
    const record = load()?.get(entryKey(uid, lid));
    return record ? Object.freeze({ ...record }) : null;
  };

  const save = ({ uid, lid, ...patch } = {}) => {
    if (!usable || !validUid(uid) || !validLid(lid)) return null;
    const at = now();
    const entries = load(at);
    if (!entries) return null;
    const entry = entryKey(uid, lid);
    const previous = entries.get(entry);
    const merged = {
      ...previous,
      voteAt: patch.voted !== undefined || patch.upvote !== undefined ? at : previous?.voteAt,
      favorAt: patch.favored !== undefined || patch.favorCount !== undefined ? at : previous?.favorAt,
    };
    for (const field of FIELDS)
      if (patch[field] !== undefined) merged[field] = patch[field];
    const record = normalizeRecord(merged, at - ttlMs);
    if (!record) return null;
    entries.set(entry, record);
    return persist(entries) ? Object.freeze({ ...record }) : null;
  };

  return Object.freeze({ read, save });
}
