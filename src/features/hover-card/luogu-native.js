// 洛谷原生的表现形式。★ 这里每一个值都是 2026-08-13 在洛谷页面上**实测**取到的
// 计算样式，不是抄的也不是猜的 —— 卡片要「和原生一致」，就不能靠印象写颜色。

// 用户等级色。★ 2026-08-14 直接从洛谷前端 `UserName` 组件的原文取到映射表
// （`loader.*.js`，与 OiLevel/XcpcLevel 同一个 chunk），不再靠页面配对推断：
//   { Cheater:"yellow-4", Gray:"grey-3", Blue:"blue-3", Green:"green-3",
//     Orange:"orange-3", Red:"pink-3", Purple:"purple-3" }，认不出一律 grey-3。
// 变量值取自 :root 的计算样式。两处反直觉，别按名字猜：
//   ★ **Red 映射到 pink-3**（#fe4c61），不是 red-3（#e74c3c）；
//   ★ Gray 的变量名是 **grey**-3，写成 gray-3 取到的是空串。
// Cheater 之前因为「页面上没遇到」而留白，现在有组件原文，可以照实写。
const LEVEL_COLORS = Object.freeze({
  Cheater: "#ad8b00",
  Gray: "#bfbfbf",
  Blue: "#3498db",
  Green: "#52c41a",
  Orange: "#f39c11",
  Red: "#fe4c61",
  Purple: "#9d3dcf",
});
export const levelColor = (color) =>
  (typeof color === "string" && LEVEL_COLORS[color]) || LEVEL_COLORS.Gray;

// ✅（fa-badge-check，CCF 等级）与 🎈（fa-balloon，XCPC 等级）。
// ★★ 2026-08-14 从洛谷前端组件 `OiLevel` / `XcpcLevel` 的**原文**取得，全部照抄，
//    推翻了上一轮「ccfLevel > 0 就显示、颜色恒为 #3498db」的抽样结论：
//
//   分档表两个组件共用：[[8,"gold-3"],[6,"blue-3"],[3,"green-3"]]，
//   取第一条满足 level >= min 的；**都不满足（即 level < 3）就一个图标都不画**。
//   上一轮 41 个用户零反例，是因为抽到的人都在 6~7 档，恰好全是 blue-3。
//
//   两个图标的着色**是反的**，照抄组件里的 inline style：
//     OiLevel(✅)   --fa-primary-color:#fff      --fa-secondary-color:<等级色>
//     XcpcLevel(🎈) --fa-primary-color:<等级色>  --fa-secondary-color:#fff
//   两者都带 --fa-secondary-opacity:1（FA 默认 .4，不覆盖会淡掉一半）。
const BADGE_TIERS = Object.freeze([
  Object.freeze([8, "#ffc116"]),
  Object.freeze([6, "#3498db"]),
  Object.freeze([3, "#52c41a"]),
]);

// 称号（如「扶咕咕」）：白字 + 底色 rgb(156,61,207)、圆角 2px、0.765em、左右内边距 0.383em。
// ★ 那个底色 ≈ 紫名 #9d3dcf（差 1，像是叠了半透明），而该用户正是紫名 ——
//   所以称号底色跟随**用户等级色**，不是固定紫色。
export const badgeStyle = (color) =>
  `background:${levelColor(color)};color:#fff;border-radius:2px;font-size:.765em;padding:0 .383em;`;

// 评测状态。★ 实测洛谷**记录列表**只渲染两种：
//   status 12 → `Accepted`，底色 rgb(82,196,26)；
//   其它（实测到 14）→ `Unaccepted`，底色 rgb(231,76,60)。
// 帮助文档（manual/luogu/problem/judging）列出的 AC/CE/PC/WA/RE/TLE/MLE/OLE/UKE
// 是**记录详情页**才展开的细分状态，而「数字码 → 细分名」这张表本轮没能取到证据
// （owner 账号只有 12 与 14 两种记录，bundle 里也搜不到那些字面量）。
// 所以这里只实现有据可依的两种，**不编细分名** —— 编错一个字比少显示一个字更糟。
// 有证据的码值（2026-08-13 实测）：
//   12 → Accepted（记录 179363526 的记录级；记录 292611285 的测试点级）
//   14 → Unaccepted（记录 292611285 记录级，score 80 也是 14）
//   6  → Wrong Answer（记录 292611285 的**测试点级**）
// ★ 细分状态是**测试点级**的；洛谷的**记录级** status 本身就只有 Accepted/Unaccepted
//   （详情页顶部也只写 Unaccepted）。所以 bestRecord.status 先天只会是这两种。
//   6 收进表里是为了兼容仍带细分码的旧记录；其余码值没有证据，一律按 Unaccepted 渲染。
const DETAILED = Object.freeze({ 6: "Wrong Answer" });
const ACCEPTED = 12;
export const STATUS_ACCEPTED_COLOR = "#52c41a";
export const STATUS_UNACCEPTED_COLOR = "#e74c3c";

// ★★ `Number(null) === 0` 且 `Number.isFinite(0)` 为真 —— 只判 isFinite 会把
// 「没有状态」当成 0，进而渲染成 Unaccepted，也就是**在不知情的情况下断言用户没通过**。
// 这个陷阱本轮已经咬过两次（canary.7 的计数、这里的状态），必须显式排除空值。
const finiteOrNull = (value) =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? null
    : Number(value);

export function statusPresentation(status) {
  const code = finiteOrNull(status);
  if (code === null) return null;
  if (code === ACCEPTED)
    return Object.freeze({
      label: "Accepted",
      color: STATUS_ACCEPTED_COLOR,
      accepted: true,
    });
  return Object.freeze({
    label: DETAILED[code] || "Unaccepted",
    color: STATUS_UNACCEPTED_COLOR,
    accepted: false,
  });
}

// 计数缩写（owner 拍板）：小于 1000 全显示；小于 1000000 用 k；否则用 m。
// 保留一位小数，且不留 `1.0k` 这种尾巴。
export function abbreviateCount(value) {
  const n = finiteOrNull(value);
  if (n === null) return null;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs < 1000) return `${sign}${abs}`;
  const scale = abs < 1000000 ? { div: 1000, unit: "k" } : { div: 1000000, unit: "m" };
  const scaled = abs / scale.div;
  const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, "");
  return `${sign}${text}${scale.unit}`;
}

// FA duotone 的两段 path，逐字节抄自洛谷加载的 `fontawsm~*.js`
// （长度 589+211 与 125+320，与上一轮实测的字符数完全一致）。
// 数组顺序就是 FA 的顺序：[secondary, primary]，渲染时 secondary 在下、primary 在上。
export const FA_BADGE_CHECK = Object.freeze({
  viewBox: "0 0 512 512",
  secondary:
    "M0 256C0 292.8 20.7 324.8 51.1 340.9 41 373.8 49 411 75 437s63.3 34 96.1 23.9C187.2 491.3 219.2 512 256 512s68.8-20.7 84.9-51.1C373.8 471 411 463 437 437s34-63.3 23.9-96.1C491.3 324.8 512 292.8 512 256s-20.7-68.8-51.1-84.9C471 138.2 463 101 437 75s-63.3-34-96.1-23.9C324.8 20.7 292.8 0 256 0s-68.8 20.7-84.9 51.1C138.2 41 101 49 75 75s-34 63.3-23.9 96.1C20.7 187.2 0 219.2 0 256zm152.3 41.6c-9.2-9.5-9-24.7 .6-33.9 9.5-9.2 24.7-8.9 33.9 .6l35.8 37 106.1-145.8c7.8-10.7 22.8-13.1 33.5-5.3 10.7 7.8 13.1 22.8 5.3 33.5L244.7 352.7c-4.2 5.7-10.7 9.4-17.8 9.8-7.1 .5-14-2.2-18.9-7.3l-55.7-57.6z",
  primary:
    "M328.7 155.5c7.8-10.7 22.8-13.1 33.5-5.3 10.7 7.8 13.1 22.8 5.3 33.5L244.7 352.7c-4.2 5.7-10.7 9.4-17.8 9.8-7.1 .5-14-2.2-18.9-7.3l-55.7-57.6c-9.2-9.5-9-24.7 .6-33.9 9.5-9.2 24.7-8.9 33.9 .6l35.8 37 106.1-145.8z",
});

export const FA_BALLOON = Object.freeze({
  viewBox: "0 0 384 512",
  secondary:
    "M56 176c0 13.3 10.7 24 24 24s24-10.7 24-24c0-39.8 32.2-72 72-72 13.3 0 24-10.7 24-24s-10.7-24-24-24C109.7 56 56 109.7 56 176z",
  primary:
    "M0 192C0 86 86 0 192 0S384 86 384 192c0 128-160 240-160 240l27.9 41.8c2.7 4 4.1 8.8 4.1 13.6 0 13.6-11 24.6-24.6 24.6l-78.9 0c-13.6 0-24.6-11-24.6-24.6 0-4.8 1.4-9.6 4.1-13.6L160 432S0 320 0 192zm104-16c0-39.8 32.2-72 72-72 13.3 0 24-10.7 24-24s-10.7-24-24-24c-66.3 0-120 53.7-120 120 0 13.3 10.7 24 24 24s24-10.7 24-24z",
});

// 等级 → 徽章配色。拿不到等级、或等级低于最低档，都返回 null（＝不画图标）。
export function badgeTierColor(level) {
  const value = finiteOrNull(level);
  if (value === null) return null;
  for (const [min, color] of BADGE_TIERS) if (value >= min) return color;
  return null;
}

// CCF 认证徽章（✅）。primary 是那一钩，恒为白；secondary 是盾面，取等级色。
export function ccfBadge(level) {
  const color = badgeTierColor(level);
  return color === null
    ? null
    : Object.freeze({
        icon: FA_BADGE_CHECK,
        primary: "#fff",
        secondary: color,
        label: `CCF 认证 ${finiteOrNull(level)} 级`,
      });
}

// XCPC 认证徽章（🎈）。★ 与 ✅ 相反：primary 是气球本体，取等级色；secondary 是那道高光，
// 恒为白。写反了会得到一个白底卡片上看不见的白气球。
export function xcpcBadge(level) {
  const color = badgeTierColor(level);
  return color === null
    ? null
    : Object.freeze({
        icon: FA_BALLOON,
        primary: color,
        secondary: "#fff",
        label: `XCPC 认证 ${finiteOrNull(level)} 级`,
      });
}
