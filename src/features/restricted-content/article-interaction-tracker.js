import { completeRestrictedArticleInteraction } from "./article-interaction-state.js";
import { articleWriteRequestUrl, interpretArticleWrite } from "./article-write-observer.js";

const countOrNull = (value) =>
  value === null || value === undefined || value === "" ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);
// 官方 lentille viewer 是 userSummary 形狀（uid）；容忍 id 只是為了不因欄位改名靜默失效。
const viewerUid = (viewer) =>
  Number(viewer && (viewer.uid != null ? viewer.uid : viewer.id)) || null;

// 單一互動狀態模型的執行環境入口：持有當前頁面正在顯示的公共計數與個人狀態，
// 觀察官方寫請求的真實回應，成功時同時更新記憶體快照與帳號隔離的持久記錄。
// 匿名訪客只更新記憶體快照（供收藏計數 ±1 推導），不寫入磁碟。
export function createArticleInteractionTracker(config) {
  const { store, origin, lid, uid, onPersistFailure, onUnconfirmed } = config || {};
  let current = { upvote: null, favorCount: null, voted: null, favored: null };

  const seed = (state) => {
    const next = state && typeof state === "object" ? state : {};
    current = {
      // ★同 store：Number(null) === 0，只判 isFinite 會把未知計數偽造成 0。
      upvote: countOrNull(next.upvote),
      favorCount: countOrNull(next.favorCount),
      voted: next.voted === 1 || next.voted === -1 || next.voted === 0
        ? next.voted
        : null,
      favored: typeof next.favored === "boolean" ? next.favored : null,
    };
    return current;
  };

  const observeWrite = (event) => {
    const write = { ...event, origin, lid, current };
    const confirmed = interpretArticleWrite(write);
    if (!confirmed) {
      if (onUnconfirmed && articleWriteRequestUrl(write)) onUnconfirmed();
      return null;
    }
    const { kind, ...patch } = confirmed;
    current = { ...current, ...patch };
    // Keep the confirmed state in this session even if browser storage fails.
    const saved = store ? store.save({ uid, lid, ...patch }) : null;
    if (!saved && typeof onPersistFailure === "function")
      onPersistFailure({
        lid,
        reason: viewerUid({ uid }) === null ? "no-account" : "storage-unavailable",
      });
    return confirmed;
  };

  return Object.freeze({
    seed,
    observeWrite,
    snapshot: () => ({ ...current }),
  });
}

// 引導受限文章頁時的單一入口：讀回本帳號已確認的狀態、與保存站快照合併成官方
// `data` 形狀，並用同一份合併結果給 tracker 打底，避免顯示值與內部狀態分家。
export function prepareRestrictedArticleInteraction(config) {
  const {
    store,
    origin,
    lid,
    viewer,
    article,
    archivedAt,
    live,
    onPersistFailure,
    onUnconfirmed,
  } = config || {};
  const uid = viewerUid(viewer);
  const interaction = completeRestrictedArticleInteraction({
    article,
    archivedAt,
    live,
    confirmed: store ? store.read({ uid, lid }) : null,
  });
  const tracker = createArticleInteractionTracker({
    store,
    origin,
    lid,
    uid,
    onPersistFailure,
    onUnconfirmed,
  });
  tracker.seed({
    upvote: interaction.article.upvote,
    favorCount: interaction.article.favorCount,
    voted: interaction.voted,
    favored: interaction.favored,
  });
  return Object.freeze({ interaction, tracker });
}
