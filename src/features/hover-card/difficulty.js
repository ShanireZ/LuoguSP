// 懸停卡這一側的難度讀法。★ 表本身**不在這裡** —— 唯一一份在
// `core/luogu-difficulty.js`，那裡也記著它為什麼必須只有一份。
import {
  DIFFICULTY_COLORS,
  DIFFICULTY_NAMES,
  DIFFICULTY_TIERS as TIERS,
} from "../../core/luogu-difficulty.js";

const inRange = (value) =>
  Number.isInteger(value) && value >= 0 && value < TIERS;

// ★ 越界/讀不到時回落到第 0 檔「暫無評定」。owner 2026-08-14 明確保留這個行為
//   （我提過它與鐵律 #2「不偽造未知」有張力）—— 洛谷自己的 0 檔就叫這個名，
//   而 `/problem/{pid}` 一直給得出 difficulty，是隱患不是現象。**別再改回來。**
export const difficultyName = (value) =>
  inRange(value) ? DIFFICULTY_NAMES[value] : DIFFICULTY_NAMES[0];

export const difficultyColor = (value) =>
  inRange(value) ? DIFFICULTY_COLORS[value] : DIFFICULTY_COLORS[0];

export const DIFFICULTY_TIERS = TIERS;
