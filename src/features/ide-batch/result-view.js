// IDE 批量測試的**結果呈現**：輸出歸一化、逐行差異、三欄面板。
//
// ★ 從 `feature.js` 搬出來，理由只有一個：那個檔案頂著 850 行的預算上限（搬之前 793）。
//   搬的全是無閉包相依的東西 —— 不讀 IDE 的任何局部狀態、不碰選擇器表，
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

export function diffIdeLines(expectedLines, actualLines) {
  const expected = new Set();
  const actual = new Set();
  let start = 0;
  let expectedEnd = expectedLines.length;
  let actualEnd = actualLines.length;
  while (start < Math.min(expectedEnd, actualEnd) && expectedLines[start] === actualLines[start]) start++;
  while (expectedEnd > start && actualEnd > start && expectedLines[expectedEnd - 1] === actualLines[actualEnd - 1]) {
    expectedEnd--;
    actualEnd--;
  }
  const height = expectedEnd - start + 1;
  const width = actualEnd - start + 1;
  if (height > 1 && width > 1 && height * width <= 262_144) {
    const common = new Uint32Array(height * width);
    for (let i = height - 2; i >= 0; i--) {
      for (let j = width - 2; j >= 0; j--) {
        const at = i * width + j;
        common[at] = expectedLines[i + start] === actualLines[j + start]
          ? 1 + common[at + width + 1]
          : Math.max(common[at + width], common[at + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < height - 1 && j < width - 1) {
      const at = i * width + j;
      if (expectedLines[i + start] === actualLines[j + start]) {
        i++;
        j++;
      } else if (common[at + width] >= common[at + 1]) expected.add(start + i++);
      else actual.add(start + j++);
    }
    for (; i < height - 1; i++) expected.add(start + i);
    for (; j < width - 1; j++) actual.add(start + j);
  } else {
    // For large outputs, look for a nearby alignment with bounded work per line.
    const findAhead = (lines, from, end, text) => {
      for (let i = from + 1; i < Math.min(from + 17, end); i++)
        if (lines[i] === text) return i - from;
      return Infinity;
    };
    let i = start;
    let j = start;
    while (i < expectedEnd && j < actualEnd) {
      if (expectedLines[i] === actualLines[j]) {
        i++;
        j++;
        continue;
      }
      const missing = findAhead(expectedLines, i, expectedEnd, actualLines[j]);
      const extra = findAhead(actualLines, j, actualEnd, expectedLines[i]);
      if (missing === Infinity && extra === Infinity) {
        expected.add(i++);
        actual.add(j++);
      } else if (missing <= extra) {
        for (let k = 0; k < missing; k++) expected.add(i++);
      } else {
        for (let k = 0; k < extra; k++) actual.add(j++);
      }
    }
    for (; i < expectedEnd; i++) expected.add(i);
    for (; j < actualEnd; j++) actual.add(j);
  }
  return { expected, actual };
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
      if (badSet?.has(k)) {
        span.className = "luogusp-ide-diffline";
        span.tabIndex = -1;
      }
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
