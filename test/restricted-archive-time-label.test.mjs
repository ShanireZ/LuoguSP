import test from "node:test";
import assert from "node:assert/strict";
import { relabelArchiveTime } from "../src/features/restricted-content/archive-time-label.js";

// 保存站只有入档时间；实测 2l4x53kj 入档 2026-01-02、真实发表 2025-10-01，差三个月。
// 官方模板把它渲染成「创建时间」（文章）/「发表时间」（剪贴板），等于用存档时间冒充真值。
// .cn 上没有任何他人剪贴板发表时间的只读来源（/paste/{id} 被拦、/user/{uid}/paste 404、
// /paste 只列自己的），所以剪贴板永远只能显示存档时间 —— 那就得如实标注。

// 最小 DOM 替身：只实现本模块用到的 childNodes / querySelectorAll / nodeValue。
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

// ★ 观察器会反复跑 inject，重复替换必须是空操作。
test("幂等：改过之后再调用不产生变更", () => {
  const bar = element([text("创建时间：2026-01-02")]);
  assert.equal(relabelArchiveTime([bar], "创建时间"), 1);
  assert.equal(relabelArchiveTime([bar], "创建时间"), 0);
  assert.equal(relabelArchiveTime([bar], "存档时间"), 0);
  assert.equal(flatten(bar), "存档时间：2026-01-02");
});

// ★ 整段 textContent 赋值会抹掉兄弟元素 —— LuoguSP 自己补的「更新时间」span 就在同一行。
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
  // 目标就是「存档时间」时直接返回，避免自我替换死循环式的无意义改动。
  assert.equal(relabelArchiveTime([element([text("存档时间：x")])], "存档时间"), 0);
});
