// 洛谷難度檔位的**唯一**一份表。
//
// ★★★ 這個檔案存在的理由：色表原先在 `problem-color/feature.js` 與
//   `hover-card/difficulty.js` **各存一份**，而且兩份同時是錯的 —— 第 5/8 檔填的是
//   Tailwind 的 `teal-500` / `slate-900`，根本不是從洛谷取的值。這和 `anchors.js` 裡
//   記的「同一個判據不許有第二份」是同一種錯，只是它還沒咬到人：兩份**碰巧**一直相等。
//   **碰巧相等的一致性 ≈ 不存在的一致性。** 守衛在 `test/difficulty-palette.test.mjs`。
//
// 名稱：2026-08-13 在 `/user/697932/practice`（611 題）上把每個分組的標題與組內 pid 的
//   `difficulty` 逐一配對實測得到，並與 `/_lfe/config` 裡**大寫**的 `ProblemDifficulty`
//   逐字互證（兩條獨立證據）。
//   ★ 減號是 **U+2212 MINUS SIGN**（`2212`），不是 ASCII 連字元 `-`。
//   ★ 第 8 檔就是 `NOI/NOI+/CTS`，**沒有尾部的 C**（`textContent` 不受 CSS 省略號影響，
//     碼位序列到此為止）。沿用舊記憶裡的「NOI/NOI+/CTSC」會寫錯一個字。
//   ★★ **別照 `/_lfe/config` 裡小寫的 `problemDifficulty` 改** —— 那是舊的 8 檔表
//     （第 7 檔寫作 `NOI/NOI+/CTSC`），照它改會把整套難度改回舊制。
export const DIFFICULTY_NAMES = Object.freeze([
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

// `/_lfe/config` 的 `ProblemDifficulty` 給的是**色名**而不是色值，一檔一名。
// 留著它是為了讓守衛能把「檔位 → 色名 → 色值」這條鏈整條釘住，而不是只釘一串魔法數。
export const DIFFICULTY_COLOR_NAMES = Object.freeze([
  "grey-3",
  "pink-3",
  "orange-3",
  "gold-3",
  "green-3",
  "cyan-3",
  "blue-3",
  "purple-3",
  "lapis-4",
]);

// 上面那些色名在洛谷 `:root` 上的**計算值**，2026-08-14 實測。
// ★ 第 5 檔（`cyan-3` `#13c2c2`）與第 8 檔（`lapis-4` `#0e1d69`）是 2.14.1 修正的兩檔；
//   改之前分別是 `#14b8a6`（Tailwind teal-500）與 `#0f172a`（Tailwind slate-900），
//   於是同一頁裡洛谷自己的難度色和我們染的色會是兩個顏色 —— 第 8 檔尤其明顯
//   （官方是深寶藍，我們幾乎是純黑）。其餘 7 檔改之前就與官方逐字相同。
export const DIFFICULTY_COLORS = Object.freeze([
  "#bfbfbf",
  "#fe4c61",
  "#f39c11",
  "#ffc116",
  "#52c41a",
  "#13c2c2",
  "#3498db",
  "#9d3dcf",
  "#0e1d69",
]);

export const DIFFICULTY_TIERS = DIFFICULTY_NAMES.length;
