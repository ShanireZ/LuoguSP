// 悬停卡这一侧的难度读法。★ 表本身**不在这里** —— 唯一一份在
// `core/luogu-difficulty.js`，那里也记着它为什么必须只有一份。
import {
  DIFFICULTY_COLORS,
  DIFFICULTY_NAMES,
  DIFFICULTY_TIERS as TIERS,
} from "../../core/luogu-difficulty.js";

const inRange = (value) =>
  Number.isInteger(value) && value >= 0 && value < TIERS;

// ★ 越界/读不到时回落到第 0 档「暂无评定」。owner 2026-08-14 明确保留这个行为
//   （我提过它与铁律 #2「不伪造未知」有张力）—— 洛谷自己的 0 档就叫这个名，
//   而 `/problem/{pid}` 一直给得出 difficulty，是隐患不是现象。**别再改回来。**
export const difficultyName = (value) =>
  inRange(value) ? DIFFICULTY_NAMES[value] : DIFFICULTY_NAMES[0];

export const difficultyColor = (value) =>
  inRange(value) ? DIFFICULTY_COLORS[value] : DIFFICULTY_COLORS[0];

export const DIFFICULTY_TIERS = TIERS;
