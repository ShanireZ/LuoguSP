import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pickPublishTime } from "../src/features/restricted-content/publish-time.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

// 保存站上游 laikit-dev/luogu-saver#84 之後，存檔載荷自帶 `publishTime`＝洛谷真實發表時間（秒）。
// 在此之前唯一的真值來源是作者專欄列表現掃（article-live-counts.js 的 live.time），
// 那條路要發若干請求且有 2.5s 預算，掃不到就沒有。兩者都沒有時**必須**回傳 null ——
// 入檔時間（createdAt）與真實發表時間實測能差三個月（2l4x53kj），絕不能頂替。

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

// ★ Number(null) === 0 且 Number.isFinite(0) 為真 —— 這個坑本專案已經咬過四次。
// 0 是「洛谷沒有給值」，不是 1970-01-01。
test("0、负数、非整数、空串一律当作没有", () => {
  for (const value of [0, -1, -1759276800, 1.5, "", "  ", Number.NaN, Infinity]) {
    assert.equal(pickPublishTime({ publishTime: value }, null), null, `publishTime=${String(value)}`);
    assert.equal(pickPublishTime(null, { time: value }), null, `live.time=${String(value)}`);
  }
});

test("坏的 publishTime 不会挡住可用的实时值", () => {
  assert.equal(pickPublishTime({ publishTime: 0 }, { time: 1759276800 }), 1759276800);
});

// 上游把列定成 INT UNSIGNED，超出範圍的值不可能是真的發表時間。
test("超出 INT UNSIGNED 的值不接受", () => {
  assert.equal(pickPublishTime({ publishTime: 4294967295 }, null), 4294967295);
  assert.equal(pickPublishTime({ publishTime: 4294967296 }, null), null);
  assert.equal(pickPublishTime({ publishTime: 1759276800000 }, null), null);
});

// 保存站的 BIGINT 列會以字串出現在 JSON 裡（評論的 time 就是這樣），
// publishTime 現在是 INT UNSIGNED 所以是數字，但呼叫方不該因為哪天變了就崩。
test("纯数字字符串按数字接受", () => {
  assert.equal(pickPublishTime({ publishTime: "1759276800" }, null), 1759276800);
});

// ---- 結構守衛 ----
// 四個串接點全在 feature.js 的重建/掛載路徑上，行為測試要把整個特性掛進 jsdom 才夠得著，
// 而漏接一處的表現是「靜默退回入檔時間」——頁面照常繪製，只是時間是錯的，沒有任何測試會紅。
// ★ 釘整條表達式，不釘欄位名：只釘 "pickPublishTime" 的話，把判據改回 `live && live.time`
//   仍然能過（本專案上一次寫假門就是這麼栽的）。

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
    /if \(pickPublishTime\(data, null\) === null\) \{\s*\n?\s*const label = pasteTimeLabel\(timeRow\);\s*\n?\s*if \(label\) relabelArchiveTime\(\[timeRow\], label\);\s*\n?\s*\}/,
    "剪贴板：保存站回填到之后就该显示真实发表时间，不再一律标「存档时间」",
  );
  const pasteShow = read("src/features/restricted-content/paste-show.js");
  assert.match(pasteShow, /发布时间/);
  assert.match(pasteShow, /发表时间/);
  assert.doesNotMatch(
    source,
    /!\(live && live\.time\)/,
    "旧判据只认作者专栏列表那一条路，保存站的 publishTime 会被无视",
  );
});

// 撤掉 forceUpdate 之後，行為測試只釘「這一次發出的請求體」；
// 結構守衛再釘一遍「原始碼里根本不存在這個欄位」，免得哪天有人順手加回去。
test("发给保存站的更新请求不带 forceUpdate", () => {
  assert.doesNotMatch(
    read("src/features/restricted-content/saver-workflow.js"),
    /forceUpdate\s*:/,
    "上游没打算把这个权限给公开入口（luogu-saver#85），真实发表时间也已由 #84 自行回填",
  );
});
