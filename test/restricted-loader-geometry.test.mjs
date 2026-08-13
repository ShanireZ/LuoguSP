import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOADER_MESSAGE_BOX,
  LOADER_SPINNER_BOX,
} from "../src/features/restricted-content/loader-geometry.js";

const read = (relative) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

// owner 2026-08-13 报：「加载中上方的转圈，会随着加载状态产生位移」。两个来源：
//   1. 壳内加载层用 flex 列居中，文案从「加载中…」变成
//      「该内容尚未被保存站收录，已自动发起收录…」后整列变高，重新居中把转圈往上顶；
//   2. 早期加载层（html::before/::after）与壳内加载层几何不一致，切换瞬间还跳一次。
// 修法：两者共用 loader-geometry.js，转圈与文案都按视口中心绝对定位。

test("转圈与文案都是绝对定位，不靠 flex 居中", () => {
  assert.match(LOADER_SPINNER_BOX, /position:fixed/);
  assert.match(LOADER_SPINNER_BOX, /left:50%/);
  assert.match(LOADER_SPINNER_BOX, /top:50%/);
  assert.match(LOADER_MESSAGE_BOX, /position:fixed/);
  // 文案绝对定位后只会向下生长，不影响转圈。
  assert.match(LOADER_MESSAGE_BOX, /top:calc\(50% \+ 17px\)/);
});

// ★ 这是把 owner 报的 bug 钉死的那一条：壳内加载层一旦改回 flex 居中，
// 文案变长就会把转圈顶走。
test("壳内加载层不得用 flex 居中整列", () => {
  const geometry = read("src/features/restricted-content/loader-geometry.js");
  const css = (geometry.match(/SHELL_LOADER_CSS =[\s\S]*?;\n/) || [""])[0];
  assert.ok(css.includes("luogusp-rst-loader"), "没找到壳内加载层样式");
  assert.doesNotMatch(css, /display:flex/, "flex 列会随文案变高而重新居中");
  assert.doesNotMatch(css, /justify-content:center/);
  assert.match(css, /LOADER_SPINNER_BOX/);
  assert.match(css, /LOADER_MESSAGE_BOX/);
});

// 两套加载层先后出现在同一位置，几何必须同源，否则以后一定会漂。
test("早期加载层与壳内加载层共用同一份几何", () => {
  const early = read("src/bootstrap/restricted-early-gate.js");
  assert.match(early, /loader-geometry\.js/);
  assert.match(early, /\$\{LOADER_SPINNER_BOX\}/);
  assert.match(early, /\$\{LOADER_MESSAGE_BOX\}/);
  // 写死的旧几何不许残留，否则两份会各自漂移。
  assert.doesNotMatch(early, /margin:-31px 0 0 -21px/);
  assert.doesNotMatch(early, /top:calc\(50% \+ 17px\);z-index/);
});
