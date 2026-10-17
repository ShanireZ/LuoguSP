// 受限文章的互動狀態合併：把四個來源合成官方 lentille `data` 的形狀。
//
// 個人狀態（voted / favored）優先級（高→低）
//   1. confirmed —— 洛谷官方寫介面確認過的狀態（本次工作階段或帳號隔離的持久記錄）；
//   2. archived  —— 保存站存檔快照，實際上永遠不提供個人狀態；
//   3. null      —— 未知。絕不用 false 偽造「沒收藏 / 沒點贊」。
//
// 公共計數（upvote / favorCount）優先級（高→低）
//   1. live      —— 頁面載入時從洛谷作者專欄列表 API 現取的伺服器真值
//                   （見 article-live-counts.js）。它天然已經包含此前所有已確認的寫入，
//                   所以無條件壓過 confirmed，不需要比新鮮度。
//   2. confirmed —— 已確認寫回應裡的計數；
//   3. archived  —— 保存站快照，僅當比 confirmed 更新時才允許覆蓋。
//
// ★ live **只**參與公共計數。作者專欄列表不含 voted / favored，
//   一個位元組的個人狀態都不許從那裡來 —— 否則又走回「用 false 偽造未收藏」的老路。
function archivedBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function archivedVote(value) {
  return value === 1 || value === -1 ? value : null;
}

function confirmedVote(value) {
  return value === 1 || value === -1 || value === 0 ? value : null;
}

const numberOrNull = (value) =>
  Number.isFinite(Number(value)) && value !== null && value !== ""
    ? Number(value)
    : null;

export function completeRestrictedArticleInteraction(config) {
  const { article, archived, viewer, confirmed, archivedAt, live } =
    config || {};
  if (!article || typeof article !== "object")
    throw new TypeError("Restricted article data is required");
  const archive = archived && typeof archived === "object" ? archived : {};
  const record = confirmed && typeof confirmed === "object" ? confirmed : null;
  const voted = record
    ? (confirmedVote(record.voted) ?? archivedVote(archive.voted))
    : archivedVote(archive.voted);
  const favored = record
    ? (archivedBoolean(record.favored) ?? archivedBoolean(archive.favored))
    : archivedBoolean(archive.favored);
  const archiveTime = numberOrNull(archivedAt);
  const recordTime = record ? numberOrNull(record.at) : null;
  const countsWin =
    record !== null &&
    (archiveTime === null || recordTime === null || archiveTime <= recordTime);
  // live 唯讀三個計數鍵，不解構整個物件 —— 免得哪天列表 API 多回傳一個
  // favored/voted 就被順手帶進個人狀態。
  const liveUpvote = live ? numberOrNull(live.upvote) : null;
  const liveFavorCount = live ? numberOrNull(live.favorCount) : null;
  const upvote =
    liveUpvote ?? (countsWin ? numberOrNull(record.upvote) : null);
  const favorCount =
    liveFavorCount ?? (countsWin ? numberOrNull(record.favorCount) : null);
  // 評論數只有 live 一個可信來源；拿不到就沿用呼叫方傳進來的已載入評論條數。
  const replyCount = live ? numberOrNull(live.replyCount) : null;
  // ★ 發表時間同理，而且更要緊：保存站只有入檔時間，兩者能差幾個月，
  //   把入檔時間當發表時間顯示是錯的。live 有就用真值。
  const time = live ? numberOrNull(live.time) : null;
  // 題解歸屬與審核狀態：呼叫方此前只能硬寫 solutionFor:null / status:2。
  // 這兩個值**原樣透傳洛谷自己列表 API 的欄位**，形狀由洛谷決定，不由這裡建構 ——
  // 官方元件讀的是 `article.solutionFor.pid`（鏈到 problem.solution）。
  const status = live ? numberOrNull(live.status) : null;
  const solutionFor =
    live && live.solutionFor && typeof live.solutionFor === "object"
      ? live.solutionFor
      : null;
  const canReply = Boolean(viewer) && archive.canReply !== false;
  const canEdit = false;
  return Object.freeze({
    article: Object.freeze({
      ...article,
      ...(upvote === null ? {} : { upvote }),
      ...(favorCount === null ? {} : { favorCount }),
      ...(replyCount === null ? {} : { replyCount }),
      ...(time === null ? {} : { time }),
      ...(status === null ? {} : { status }),
      ...(solutionFor === null ? {} : { solutionFor }),
      voted,
      canReply,
      canEdit,
    }),
    favored,
    voted,
    canReply,
    canEdit,
  });
}
