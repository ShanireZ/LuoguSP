import { completeRestrictedArticleInteraction } from "./article-interaction-state.js";
import { interpretArticleWrite } from "./article-write-observer.js";

const countOrNull = (value) =>
  value === null || value === undefined || value === "" ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);
// 官方 lentille viewer 是 userSummary 形状（uid）；容忍 id 只是为了不因字段改名静默失效。
const viewerUid = (viewer) =>
  Number(viewer && (viewer.uid != null ? viewer.uid : viewer.id)) || null;

// 单一互动状态模型的运行时入口：持有当前页面正在显示的公共计数与个人状态，
// 观察官方写请求的真实响应，成功时同时更新内存快照与账号隔离的持久记录。
// 匿名访客只更新内存快照（供收藏计数 ±1 推导），不落盘。
export function createArticleInteractionTracker(config) {
  const { store, origin, lid, uid, onPersistFailure } = config || {};
  let current = { upvote: null, favorCount: null, voted: null, favored: null };

  const seed = (state) => {
    const next = state && typeof state === "object" ? state : {};
    current = {
      // ★同 store：Number(null) === 0，只判 isFinite 会把未知计数伪造成 0。
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
    const confirmed = interpretArticleWrite({
      origin,
      lid,
      method: event && event.method,
      url: event && event.url,
      status: event && event.status,
      responseText: event && event.responseText,
      current,
    });
    if (!confirmed) return null;
    const { kind, ...patch } = confirmed;
    current = { ...current, ...patch };
    // 官方已经确认了这次互动，但状态无处可存 —— 刷新后必然撤不回。
    // 静默降级会把「持久化根本没生效」伪装成「功能没做」，所以必须报出来。
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

// 引导受限文章页时的单一入口：读回本账号已确认的状态、与保存站快照合并成官方
// `data` 形状，并用同一份合并结果给 tracker 打底，避免显示值与内部状态分家。
export function prepareRestrictedArticleInteraction(config) {
  const {
    store,
    origin,
    lid,
    viewer,
    article,
    archived,
    archivedAt,
    live,
    onPersistFailure,
  } = config || {};
  const uid = viewerUid(viewer);
  const interaction = completeRestrictedArticleInteraction({
    article,
    archived,
    viewer,
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
  });
  tracker.seed({
    upvote: interaction.article.upvote,
    favorCount: interaction.article.favorCount,
    voted: interaction.voted,
    favored: interaction.favored,
  });
  return Object.freeze({ interaction, tracker });
}
