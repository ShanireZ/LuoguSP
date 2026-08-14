// 洛谷难度档位的**唯一**一份表。
//
// ★★★ 这个文件存在的理由：色表原先在 `problem-color/feature.js` 与
//   `hover-card/difficulty.js` **各存一份**，而且两份同时是错的 —— 第 5/8 档填的是
//   Tailwind 的 `teal-500` / `slate-900`，根本不是从洛谷取的值。这和 `anchors.js` 里
//   记的「同一个判据不许有第二份」是同一种错，只是它还没咬到人：两份**碰巧**一直相等。
//   **碰巧相等的一致性 ≈ 不存在的一致性。** 守卫在 `test/difficulty-palette.test.mjs`。
//
// 名称：2026-08-13 在 `/user/697932/practice`（611 题）上把每个分组的标题与组内 pid 的
//   `difficulty` 逐一配对实测得到，并与 `/_lfe/config` 里**大写**的 `ProblemDifficulty`
//   逐字互证（两条独立证据）。
//   ★ 减号是 **U+2212 MINUS SIGN**（`2212`），不是 ASCII 连字符 `-`。
//   ★ 第 8 档就是 `NOI/NOI+/CTS`，**没有尾部的 C**（`textContent` 不受 CSS 省略号影响，
//     码位序列到此为止）。沿用旧记忆里的「NOI/NOI+/CTSC」会写错一个字。
//   ★★ **别照 `/_lfe/config` 里小写的 `problemDifficulty` 改** —— 那是旧的 8 档表
//     （第 7 档写作 `NOI/NOI+/CTSC`），照它改会把整套难度改回旧制。
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

// `/_lfe/config` 的 `ProblemDifficulty` 给的是**色名**而不是色值，一档一名。
// 留着它是为了让守卫能把「档位 → 色名 → 色值」这条链整条钉住，而不是只钉一串魔法数。
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

// 上面那些色名在洛谷 `:root` 上的**计算值**，2026-08-14 实测。
// ★ 第 5 档（`cyan-3` `#13c2c2`）与第 8 档（`lapis-4` `#0e1d69`）是 2.14.1 修正的两档；
//   改之前分别是 `#14b8a6`（Tailwind teal-500）与 `#0f172a`（Tailwind slate-900），
//   于是同一页里洛谷自己的难度色和我们染的色会是两个颜色 —— 第 8 档尤其明显
//   （官方是深宝蓝，我们几乎是纯黑）。其余 7 档改之前就与官方逐字相同。
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
