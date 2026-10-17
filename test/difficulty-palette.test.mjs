import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DIFFICULTY_COLOR_NAMES,
  DIFFICULTY_COLORS,
  DIFFICULTY_NAMES,
  DIFFICULTY_TIERS,
} from "../src/core/luogu-difficulty.js";
import {
  difficultyColor,
  difficultyName,
} from "../src/features/hover-card/difficulty.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 洛谷 `:root` 上這些色名的計算值，2026-08-14 實測（交接單裡也記著同一份）。
// ★ 這是**獨立複述**的一份，故意不從被測模組 import —— 從被測模組取值會讓斷言
//   變成「它等於它自己」，那種門永遠紅不了（本專案已經被這種門咬過一次）。
const ROOT_COMPUTED = Object.freeze({
  "grey-3": "#bfbfbf",
  "pink-3": "#fe4c61",
  "orange-3": "#f39c11",
  "gold-3": "#ffc116",
  "green-3": "#52c41a",
  "cyan-3": "#13c2c2",
  "blue-3": "#3498db",
  "purple-3": "#9d3dcf",
  "lapis-4": "#0e1d69",
});

test("难度表三列等长且档数就是 9", () => {
  assert.equal(DIFFICULTY_TIERS, 9);
  assert.equal(DIFFICULTY_NAMES.length, 9);
  assert.equal(DIFFICULTY_COLOR_NAMES.length, 9);
  assert.equal(DIFFICULTY_COLORS.length, 9);
});

test("每一档的色值都等于该色名在洛谷 :root 上的计算值", () => {
  DIFFICULTY_COLOR_NAMES.forEach((colorName, tier) => {
    assert.equal(
      DIFFICULTY_COLORS[tier],
      ROOT_COMPUTED[colorName],
      `第 ${tier} 档（${colorName}）色值与官方不符`,
    );
  });
});

// 反證：2.14.1 修的就是這兩檔。它們原先填的是 Tailwind 的 teal-500 / slate-900，
// 於是同一頁裡洛谷自己的難度色和我們染的色是兩個顏色（第 8 檔尤其明顯）。
test("第 5 / 8 档不许退回 Tailwind 的近似色", () => {
  assert.equal(DIFFICULTY_COLORS[5], "#13c2c2");
  assert.equal(DIFFICULTY_COLORS[8], "#0e1d69");
  assert.notEqual(DIFFICULTY_COLORS[5], "#14b8a6");
  assert.notEqual(DIFFICULTY_COLORS[8], "#0f172a");
});

// 兩個曾經寫錯過的字，各釘一條。
test("档位名保留 U+2212 减号，且第 8 档没有尾部的 C", () => {
  assert.ok(DIFFICULTY_NAMES[2].includes("−"), "普及− 用的必须是 U+2212");
  assert.ok(!DIFFICULTY_NAMES[2].includes("-"), "普及− 里不许出现 ASCII 连字符");
  assert.equal(DIFFICULTY_NAMES[8], "NOI/NOI+/CTS");
});

const collectSourceFiles = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collectSourceFiles(path, out);
    else if (path.endsWith(".js")) out.push(path);
  }
  return out;
};

// ★★★ 結構守衛：難度色表只許有一份。
//
// 判據挑的是**難度獨有**的兩個色 —— `cyan-3` 與 `lapis-4` 在洛谷其它映射裡都不出現
// （使用者等級色、CCF/XCPC 等級色都用不到它們），所以任何第二份難度表必然帶著這兩個值，
// 而任何正當的 CSS 強調色都不會同時帶上它們。用全部 9 個色去掃會誤傷：
// `#3498db` / `#52c41a` 這些是好幾個 style.js 正當在用的強調色。
test("难度独有的两个色值在 src 下只出现在唯一那份表里", () => {
  const files = collectSourceFiles(resolve(root, "src"));
  // 掃查器先自證：它必須真的讀到了一堆檔案，而且真的能在已知那份表上命中。
  assert.ok(files.length > 50, `只扫到 ${files.length} 个文件，扫查器可能瞎了`);

  const owner = resolve(root, "src", "core", "luogu-difficulty.js");
  const strangers = [];
  let ownerHits = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8").toLowerCase();
    const hits = ["#13c2c2", "#0e1d69"].filter((c) => text.includes(c));
    if (!hits.length) continue;
    if (file === owner) ownerHits = hits.length;
    else strangers.push(`${file} → ${hits.join(" ")}`);
  }
  assert.equal(ownerHits, 2, "唯一那份表里没同时找到这两个色，扫查器或表出了问题");
  assert.deepEqual(strangers, [], "难度色表出现了第二份");
});

test("悬停卡侧的读法仍然走同一份表", () => {
  assert.equal(difficultyColor(5), DIFFICULTY_COLORS[5]);
  assert.equal(difficultyColor(8), DIFFICULTY_COLORS[8]);
  assert.equal(difficultyName(8), "NOI/NOI+/CTS");
  // owner 2026-08-14 明確保留：越界/讀不到一律回落第 0 檔。
  assert.equal(difficultyName(null), "暂无评定");
  assert.equal(difficultyColor(null), "#bfbfbf");
  assert.equal(difficultyName(9), "暂无评定");
});
