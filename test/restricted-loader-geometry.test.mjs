import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOADER_MESSAGE_BOX,
  LOADER_SPINNER_BOX,
} from "../src/features/restricted-content/loader-geometry.js";

const read = (relative) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

// owner 2026-08-13 報：「載入中上方的轉圈，會隨著載入狀態產生位移」。兩個來源：
//   1. 殼內載入層用 flex 列居中，文案從「載入中…」變成
//      「該內容尚未被保存站收錄，已自動發起收錄…」後整列變高，重新居中把轉圈往上頂；
//   2. 早期載入層（html::before/::after）與殼內載入層幾何不一致，切換瞬間還跳一次。
// 修法：兩者共用 loader-geometry.js，轉圈與文案都按視口中心絕對定位。

test("转圈与文案都是绝对定位，不靠 flex 居中", () => {
  assert.match(LOADER_SPINNER_BOX, /position:fixed/);
  assert.match(LOADER_SPINNER_BOX, /left:50%/);
  assert.match(LOADER_SPINNER_BOX, /top:50%/);
  assert.match(LOADER_MESSAGE_BOX, /position:fixed/);
  // 文案絕對定位後只會向下生長，不影響轉圈。
  assert.match(LOADER_MESSAGE_BOX, /top:calc\(50% \+ 17px\)/);
});

// ★ 這是把 owner 報的 bug 釘死的那一條：殼內載入層一旦改回 flex 居中，
// 文案變長就會把轉圈頂走。
test("壳内加载层不得用 flex 居中整列", () => {
  const geometry = read("src/features/restricted-content/loader-geometry.js");
  const css = (geometry.match(/SHELL_LOADER_CSS =[\s\S]*?;\n/) || [""])[0];
  assert.ok(css.includes("luogusp-rst-loader"), "没找到壳内加载层样式");
  assert.doesNotMatch(css, /display:flex/, "flex 列会随文案变高而重新居中");
  assert.doesNotMatch(css, /justify-content:center/);
  assert.match(css, /LOADER_SPINNER_BOX/);
  assert.match(css, /LOADER_MESSAGE_BOX/);
});

// 兩套載入層先後出現在同一位置，幾何必須同源，否則以後一定會漂。
test("早期加载层与壳内加载层共用同一份几何", () => {
  const early = read("src/bootstrap/restricted-early-gate.js");
  assert.match(early, /loader-geometry\.js/);
  assert.match(early, /\$\{LOADER_SPINNER_BOX\}/);
  assert.match(early, /\$\{LOADER_MESSAGE_BOX\}/);
  // 寫死的舊幾何不許殘留，否則兩份會各自漂移。
  assert.doesNotMatch(early, /margin:-31px 0 0 -21px/);
  assert.doesNotMatch(early, /top:calc\(50% \+ 17px\);z-index/);
});
