// IDE 批量测试的**结果呈现**：输出归一化、逐行差异、三栏面板。
//
// ★ 从 `feature.js` 搬出来，理由只有一个：那个文件顶着 850 行的预算上限（搬之前 793）。
//   搬的全是无闭包依赖的东西 —— 不读 IDE 的任何局部状态、不碰选择器表，
//   所以行为逐字节不变。
import { makeCopyButton } from "../../browser/copy-button.js";

export function normalizeIdeOut(s) {
  return String(s == null ? "" : s)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

// 期望与实际逐行比对，返回不一致的行号集合。
// ★ 以前内联在 `applyIdeResult` 里。单独拎出来是为了能直接测 ——
//   它是「哪几行标红」的唯一判据。
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
