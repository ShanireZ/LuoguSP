// 拿不到洛谷真實發表時間時，那一行顯示的其實是**保存站入檔時間** ——
// 實測能差三個月（2l4x53kj：入檔 2026-01-02，真實發表 2025-10-01）。
// 官方範本把它繪製成「建立時間」（文章）/「發佈時間」（剪貼板，舊殼是「發表時間」），
// 等於用存檔時間冒充真值，所以要把文案改成它的真實語義。
//
// 適用範圍：由 publish-time.js 的 pickPublishTime 決定 —— 取不到真值才改文案。
// 剪貼板此前是「永遠」（.cn 上沒有任何他人剪貼板發表時間的唯讀來源 ——
// /paste/{id} 被攔、/user/{uid}/paste 是 404、/paste 只列自己的），
// 保存站上游 laikit-dev/luogu-saver#84 之後存檔載荷自帶 publishTime，
// 於是剪貼板也可能有真值；存量檔案要等保存站那邊回填到才會出現。
//
// ★ 冪等：改完文案後原標籤就不再出現，重複呼叫不會二次替換。呼叫方的定位正則
//   必須同時容忍改後的「存檔時間」，否則觀察器下一輪會找不到那一行。
const ARCHIVE_LABEL = "存档时间";

export function relabelArchiveTime(elements, label) {
  if (typeof label !== "string" || !label || label === ARCHIVE_LABEL) return 0;
  let changed = 0;
  for (const element of elements || []) {
    if (!element || typeof element.querySelectorAll !== "function") continue;
    const targets = [element, ...element.querySelectorAll("*")];
    for (const node of targets)
      for (const child of node.childNodes || []) {
        // 只改文字節點：整段 textContent 賦值會抹掉兄弟元素。
        if (child.nodeType !== 3) continue;
        const text = child.nodeValue || "";
        if (!text.includes(label)) continue;
        child.nodeValue = text.split(label).join(ARCHIVE_LABEL);
        changed += 1;
      }
  }
  return changed;
}
