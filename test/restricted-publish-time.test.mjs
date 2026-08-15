import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pickPublishTime } from "../src/features/restricted-content/publish-time.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

// 保存站上游 laikit-dev/luogu-saver#84 之后，存档载荷自带 `publishTime`＝洛谷真实发表时间（秒）。
// 在此之前唯一的真值来源是作者专栏列表现扫（article-live-counts.js 的 live.time），
// 那条路要发若干请求且有 2.5s 预算，扫不到就没有。两者都没有时**必须**返回 null ——
// 入档时间（createdAt）与真实发表时间实测能差三个月（2l4x53kj），绝不能顶替。

test("保存站的 publishTime 直接可用", () => {
  assert.equal(pickPublishTime({ publishTime: 1759276800 }, null), 1759276800);
});

test("保存站没有时回落到作者专栏列表的实时值", () => {
  assert.equal(pickPublishTime({ publishTime: null }, { time: 1759276800 }), 1759276800);
  assert.equal(pickPublishTime({}, { time: 1759276800 }), 1759276800);
});

test("保存站有值时优先于实时值", () => {
  assert.equal(
    pickPublishTime({ publishTime: 1759276800 }, { time: 1700000000 }),
    1759276800,
  );
});

test("两者都没有就是 null，绝不拿入档时间顶替", () => {
  assert.equal(pickPublishTime({ createdAt: "2026-01-02T09:12:59.895Z" }, null), null);
  assert.equal(pickPublishTime({ publishTime: null }, { time: null }), null);
  assert.equal(pickPublishTime(null, null), null);
  assert.equal(pickPublishTime(undefined, undefined), null);
});

// ★ Number(null) === 0 且 Number.isFinite(0) 为真 —— 这个坑本项目已经咬过四次。
// 0 是「洛谷没有给值」，不是 1970-01-01。
test("0、负数、非整数、空串一律当作没有", () => {
  for (const value of [0, -1, -1759276800, 1.5, "", "  ", Number.NaN, Infinity]) {
    assert.equal(pickPublishTime({ publishTime: value }, null), null, `publishTime=${String(value)}`);
    assert.equal(pickPublishTime(null, { time: value }), null, `live.time=${String(value)}`);
  }
});

test("坏的 publishTime 不会挡住可用的实时值", () => {
  assert.equal(pickPublishTime({ publishTime: 0 }, { time: 1759276800 }), 1759276800);
});

// 上游把列定成 INT UNSIGNED，超出范围的值不可能是真的发表时间。
test("超出 INT UNSIGNED 的值不接受", () => {
  assert.equal(pickPublishTime({ publishTime: 4294967295 }, null), 4294967295);
  assert.equal(pickPublishTime({ publishTime: 4294967296 }, null), null);
  assert.equal(pickPublishTime({ publishTime: 1759276800000 }, null), null);
});

// 保存站的 BIGINT 列会以字符串出现在 JSON 里（评论的 time 就是这样），
// publishTime 现在是 INT UNSIGNED 所以是数字，但调用方不该因为哪天变了就崩。
test("纯数字字符串按数字接受", () => {
  assert.equal(pickPublishTime({ publishTime: "1759276800" }, null), 1759276800);
});

// ---- 结构守卫 ----
// 四个接线点全在 feature.js 的重建/挂载路径上，行为测试要把整个特性挂进 jsdom 才够得着，
// 而漏接一处的表现是「静默退回入档时间」——页面照常渲染，只是时间是错的，没有任何测试会红。
// ★ 钉整条表达式，不钉字段名：只钉 "pickPublishTime" 的话，把判据改回 `live && live.time`
//   仍然能过（本项目上一次写假门就是这么栽的）。

test("文章与剪贴板的重建时间都走 pickPublishTime，回落才是入档时间", () => {
  const source = read("src/features/restricted-content/feature.js");
  assert.match(
    source,
    /time:\s*\n?\s*pickPublishTime\(data, live\) \?\?\s*\n?\s*\(Math\.floor\(new Date\(data\.createdAt\)\.getTime\(\) \/ 1000\) \|\| 0\)/,
    "文章重建的 time 必须先取真实发表时间，取不到才退回入档时间",
  );
  assert.match(
    source,
    /time:\s*\n?\s*pickPublishTime\(data, null\) \?\?\s*\n?\s*\(Math\.floor\(new Date\(data\.createdAt\)\.getTime\(\) \/ 1000\) \|\| 0\)/,
    "剪贴板重建的 time 同理；剪贴板没有 live 那条路，第二个参数必须是 null",
  );
});

test("两处「存档时间」文案的判据与取值同源", () => {
  const source = read("src/features/restricted-content/feature.js");
  assert.match(
    source,
    /if \(pickPublishTime\(data, live\) === null\)\s*\n?\s*relabelArchiveTime\(updateBars, "创建时间"\)/,
    "文章：有真实发表时间就不该把文案改成「存档时间」",
  );
  assert.match(
    source,
    /if \(pubRow && pickPublishTime\(data, null\) === null\)\s*\n?\s*relabelArchiveTime\(\[pubRow\], "发表时间"\)/,
    "剪贴板：保存站回填到之后就该显示真实发表时间，不再一律标「存档时间」",
  );
  assert.doesNotMatch(
    source,
    /!\(live && live\.time\)/,
    "旧判据只认作者专栏列表那一条路，保存站的 publishTime 会被无视",
  );
});

// 撤掉 forceUpdate 之后，行为测试只钉「这一次发出的请求体」；
// 结构守卫再钉一遍「源码里根本不存在这个字段」，免得哪天有人顺手加回去。
test("发给保存站的更新请求不带 forceUpdate", () => {
  assert.doesNotMatch(
    read("src/features/restricted-content/saver-workflow.js"),
    /forceUpdate\s*:/,
    "上游没打算把这个权限给公开入口（luogu-saver#85），真实发表时间也已由 #84 自行回填",
  );
});
