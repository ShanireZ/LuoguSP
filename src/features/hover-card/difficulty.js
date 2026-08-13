// 洛谷难度档位。★ 这张表是 2026-08-13 从洛谷自己的页面**实测**出来的，不是抄的也不是猜的：
// 在 `/user/697932/practice`（611 题）上把每个分组的标题与组内 pid 的 `difficulty`
// 逐一配对，得到 0–8 共 9 档、一档一组，无空档。
//
// ★★ 两个必须逐字保留的细节（都逐码位核对过）：
//   1. 减号是 **U+2212 MINUS SIGN**（`2212`），不是 ASCII 连字符 `-`；
//   2. 第 8 档就是 `NOI/NOI+/CTS`，**没有尾部的 C** —— 我一度以为是 CSS 省略号截断，
//      但 `textContent` 不受 CSS 影响，码位序列 `4e4f49 2f 4e4f49 2b 2f 435453` 到此为止。
//      沿用旧记忆里的「NOI/NOI+/CTSC」会写错一个字。
//
// 颜色沿用 problem-color 的既有 9 色表（同一套值，保持两处显示一致）。
const NAMES = Object.freeze([
  "暂无评定",
  "入门",
  "普及−",
  "普及",
  "普及+/提高−",
  "提高",
  "提高+/省选−",
  "省选/NOI−",
  "NOI/NOI+/CTS",
]);

const COLORS = Object.freeze([
  "#bfbfbf",
  "#fe4c61",
  "#f39c11",
  "#ffc116",
  "#52c41a",
  "#14b8a6",
  "#3498db",
  "#9d3dcf",
  "#0f172a",
]);

const inRange = (value) =>
  Number.isInteger(value) && value >= 0 && value < NAMES.length;

export const difficultyName = (value) =>
  inRange(value) ? NAMES[value] : NAMES[0];

export const difficultyColor = (value) =>
  inRange(value) ? COLORS[value] : COLORS[0];

export const DIFFICULTY_TIERS = NAMES.length;
