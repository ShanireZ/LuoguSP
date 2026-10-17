// IDE 批量測試的**結果呈現**：輸出歸一化、逐行差異、三欄面板。
//
// ★ 從 `feature.js` 搬出來，理由只有一個：那個檔案頂著 850 行的預算上限（搬之前 793）。
//   搬的全是無閉包依賴的東西 —— 不讀 IDE 的任何局部狀態、不碰選擇器表，
//   所以行為逐位元組不變。
import { makeCopyButton } from "../../browser/copy-button.js";

export function normalizeIdeOut(s) {
  return String(s == null ? "" : s)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

// 期望與實際逐行比對，回傳不一致的行號集合。
// ★ 以前內聯在 `applyIdeResult` 裡。單獨拎出來是為了能直接測 ——
//   它是「哪幾行標紅」的唯一判據。
export function diffLineNumbers(expectedLines, actualLines) {
  const bad = new Set();
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let k = 0; k < max; k += 1)
    if ((expectedLines[k] || "") !== (actualLines[k] || "")) bad.add(k);
  return bad;
}

export function idePane(title, lines, badSet, emptyNote) {
  const pre = document.createElement("pre");
  if (!lines.length || (lines.length === 1 && lines[0] === "")) {
    if (emptyNote) {
      const span = document.createElement("span");
      span.className = "luogusp-ide-empty";
      span.textContent = emptyNote;
      pre.appendChild(span);
    }
  } else {
    lines.forEach((l, k) => {
      const span = document.createElement("span");
      if (badSet && badSet.has(k)) span.className = "luogusp-ide-diffline";
      span.textContent = l;
      pre.appendChild(span);
      if (k < lines.length - 1)
        pre.appendChild(document.createTextNode("\n"));
    });
  }
  const box = document.createElement("div");
  box.className = "code-container";
  box.append(pre, makeCopyButton(pre));
  const pane = document.createElement("div");
  pane.className = "luogusp-ide-pane";
  const h = document.createElement("h5");
  h.textContent = title;
  pane.append(h, box);
  return pane;
}
