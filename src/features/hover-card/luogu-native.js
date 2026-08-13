// 洛谷原生的表现形式。★ 这里每一个值都是 2026-08-13 在洛谷页面上**实测**取到的
// 计算样式，不是抄的也不是猜的 —— 卡片要「和原生一致」，就不能靠印象写颜色。

// 用户等级色：在 /discuss 上把 lentille-context 里每个用户的 `color` 字段
// 与其用户名链接的 computed color 配对得到。
const LEVEL_COLORS = Object.freeze({
  Gray: "#bfbfbf",
  Blue: "#3498db",
  Green: "#52c41a",
  Orange: "#f39c11",
  Red: "#fe4c61",
  Purple: "#9d3dcf",
});
// Cheater 稀有，本轮没在页面上遇到，不编一个值；未知一律落到 Gray。
export const levelColor = (color) =>
  (typeof color === "string" && LEVEL_COLORS[color]) || LEVEL_COLORS.Gray;

// ✅（fa-badge-check，CCF 等级）与 🎈（fa-balloon，XCPC 等级）：实测两者
// computed color 都是 rgb(52,152,219)，字号 1em。
export const NATIVE_BADGE_COLOR = "#3498db";

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
