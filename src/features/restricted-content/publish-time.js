// 洛谷真實發表時間的取值，兩個來源按可信與代價排序：
//
//   1. 保存站存檔載荷的 `publishTime` —— 上游 laikit-dev/luogu-saver#84 之後自帶，
//      跟著我們本來就要發的那次存檔查詢一起回來，不額外發請求。
//   2. 作者專欄列表現掃出來的 `live.time`（article-live-counts.js）—— 要發若干請求，
//      有 2.5s 預算，掃不到就是沒有。
//
// ★ 文章那條路上，兩者都有時最終顯示的是 live —— article-interaction-state.js 會在
//   合併階段用 live.time 再覆蓋一次。兩個都是洛谷給的同一個量，誰贏不影響正確性；
//   這裡排 publishTime 在前，是為了 live 掃不到（超時/分頁沒命中）時仍然有真值。
//
// ★ 兩者都沒有時回傳 null，**絕不**拿入檔時間（createdAt）頂替：實測 2l4x53kj
//   入檔 2026-01-02、真實發表 2025-10-01，差三個月。呼叫方拿到 null 就該如實標註
//   「存檔時間」（archive-time-label.js），這是鐵律「不偽造未知」的一部分。
//
// 上游把列定成 INT UNSIGNED，所以合法值是 [1, 4294967295] 的整數；0 是「洛谷沒給值」。
const PUBLISH_TIME_MAX = 4294967295;

// ★ Number(null) === 0 且 Number.isFinite(0) 為真 —— 本專案已經咬過四次，
//   必須先把 null / undefined / 空串擋在外面再轉數字。
function publishSeconds(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) &&
    seconds >= 1 &&
    seconds <= PUBLISH_TIME_MAX
    ? seconds
    : null;
}

export function pickPublishTime(archived, live) {
  return (
    publishSeconds(archived ? archived.publishTime : null) ??
    publishSeconds(live ? live.time : null)
  );
}
