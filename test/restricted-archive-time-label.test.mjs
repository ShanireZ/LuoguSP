import test from "node:test";
import assert from "node:assert/strict";
import { relabelArchiveTime } from "../src/features/restricted-content/archive-time-label.js";

// 保存站只有入檔時間；實測 2l4x53kj 入檔 2026-01-02、真實發表 2025-10-01，差三個月。
// 官方範本把它繪製成「建立時間」（文章）/「發佈時間」（剪貼板，舊殼是「發表時間」），
// 等於用存檔時間冒充真值。
// .cn 上沒有任何他人剪貼板發表時間的唯讀來源（/paste/{id} 被攔、/user/{uid}/paste 404、
// /paste 只列自己的），所以剪貼板永遠只能顯示存檔時間 —— 那就得如實標註。

// 最小 DOM 替身：只實作本模組用到的 childNodes / querySelectorAll / nodeValue。
function text(value) {
  return { nodeType: 3, nodeValue: value };
}
function element(children = []) {
  const node = { nodeType: 1, childNodes: children };
  node.querySelectorAll = () => children.filter((c) => c.nodeType === 1);
  return node;
}

const flatten = (node) =>
  node.nodeType === 3
    ? node.nodeValue
    : (node.childNodes || []).map(flatten).join("");

test("把官方文案改成它的真实语义", () => {
  const bar = element([text("创建时间：2026-01-02 17:12:59")]);
  assert.equal(relabelArchiveTime([bar], "创建时间"), 1);
  assert.equal(flatten(bar), "存档时间：2026-01-02 17:12:59");
});

test("剪贴板的「发表时间」同样处理", () => {
  const row = element([text("发表时间: 2025-12-12 00:04")]);
  assert.equal(relabelArchiveTime([row], "发表时间"), 1);
  assert.equal(flatten(row), "存档时间: 2025-12-12 00:04");
});

test("剪贴板现行文案「发布时间」同样改成存档时间", () => {
  const row = element([text("发布时间 "), text("2025-12-12 00:04")]);
  assert.equal(relabelArchiveTime([row], "发布时间"), 1);
  assert.equal(flatten(row), "存档时间 2025-12-12 00:04");
});

// ★ 觀察器會反覆跑 inject，重複替換必須是空操作。
test("幂等：改过之后再调用不产生变更", () => {
  const bar = element([text("创建时间：2026-01-02")]);
  assert.equal(relabelArchiveTime([bar], "创建时间"), 1);
  assert.equal(relabelArchiveTime([bar], "创建时间"), 0);
  assert.equal(relabelArchiveTime([bar], "存档时间"), 0);
  assert.equal(flatten(bar), "存档时间：2026-01-02");
});

// ★ 整段 textContent 賦值會抹掉兄弟元素 —— LuoguSP 自己補的「更新時間」span 就在同一行。
test("只改文本节点，不动兄弟元素", () => {
  const sibling = element([text("更新时间：2026-08-13 09:31:39")]);
  const bar = element([text("创建时间：2026-01-02"), sibling]);
  relabelArchiveTime([bar], "创建时间");
  assert.equal(flatten(bar), "存档时间：2026-01-02更新时间：2026-08-13 09:31:39");
  assert.equal(bar.childNodes.length, 2);
  assert.equal(bar.childNodes[1], sibling);
});

test("嵌套在子元素里的文案也能改到", () => {
  const inner = element([text("创建时间：2026-01-02")]);
  const bar = element([inner]);
  assert.equal(relabelArchiveTime([bar], "创建时间"), 1);
  assert.equal(flatten(bar), "存档时间：2026-01-02");
});

test("找不到目标文案时什么都不做", () => {
  const bar = element([text("更新时间：2026-08-13")]);
  assert.equal(relabelArchiveTime([bar], "创建时间"), 0);
  assert.equal(flatten(bar), "更新时间：2026-08-13");
});

test("入参垃圾不抛", () => {
  assert.equal(relabelArchiveTime(null, "创建时间"), 0);
  assert.equal(relabelArchiveTime([null, undefined, {}, 1], "创建时间"), 0);
  assert.equal(relabelArchiveTime([element([text("创建时间：x")])], ""), 0);
  assert.equal(relabelArchiveTime([element([text("创建时间：x")])], null), 0);
  // 目標就是「存檔時間」時直接回傳，避免自我替換死循環式的無意義改動。
  assert.equal(relabelArchiveTime([element([text("存档时间：x")])], "存档时间"), 0);
});
