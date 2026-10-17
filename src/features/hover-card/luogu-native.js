// 洛谷原生的表現形式。★ 這裡每一個值都是 2026-08-13 在洛谷頁面上**實測**取到的
// 計算樣式，不是抄的也不是猜的 —— 卡片要「和原生一致」，就不能靠印象寫顏色。

// 使用者等級色。★ 2026-08-14 直接從洛谷前端 `UserName` 元件的原文取到映射表
// （`loader.*.js`，與 OiLevel/XcpcLevel 同一個 chunk），不再靠頁面配對推斷：
//   { Cheater:"yellow-4", Gray:"grey-3", Blue:"blue-3", Green:"green-3",
//     Orange:"orange-3", Red:"pink-3", Purple:"purple-3" }，認不出一律 grey-3。
// 變數值取自 :root 的計算樣式。兩處反直覺，別按名字猜：
//   ★ **Red 映射到 pink-3**（#fe4c61），不是 red-3（#e74c3c）；
//   ★ Gray 的變數名是 **grey**-3，寫成 gray-3 取到的是空串。
// Cheater 之前因為「頁面上沒遇到」而留白，現在有元件原文，可以照實寫。
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

// ✅（fa-badge-check，CCF 等級）與 🎈（fa-balloon，XCPC 等級）。
// ★★ 2026-08-14 從洛谷前端元件 `OiLevel` / `XcpcLevel` 的**原文**取得，全部照抄，
//    推翻了上一輪「ccfLevel > 0 就顯示、顏色恆為 #3498db」的抽樣結論：
//
//   分檔表兩個元件共用：[[8,"gold-3"],[6,"blue-3"],[3,"green-3"]]，
//   取第一條滿足 level >= min 的；**都不滿足（即 level < 3）就一個圖標都不畫**。
//   上一輪 41 個使用者零反例，是因為抽到的人都在 6~7 檔，恰好全是 blue-3。
//
//   兩個圖標的著色**是反的**，照抄元件裡的 inline style：
//     OiLevel(✅)   --fa-primary-color:#fff      --fa-secondary-color:<等级色>
//     XcpcLevel(🎈) --fa-primary-color:<等级色>  --fa-secondary-color:#fff
//   兩者都帶 --fa-secondary-opacity:1（FA 預設 .4，不覆蓋會淡掉一半）。
const BADGE_TIERS = Object.freeze([
  Object.freeze([8, "#ffc116"]),
  Object.freeze([6, "#3498db"]),
  Object.freeze([3, "#52c41a"]),
]);

// 稱號（如「扶咕咕」）：白字 + 底色 rgb(156,61,207)、圓角 2px、0.765em、左右內邊距 0.383em。
// ★ 那個底色 ≈ 紫名 #9d3dcf（差 1，像是疊了半透明），而該使用者正是紫名 ——
//   所以稱號底色跟隨**使用者等級色**，不是固定紫色。
export const badgeStyle = (color) =>
  `background:${levelColor(color)};color:#fff;border-radius:2px;font-size:.765em;padding:0 .383em;`;

// 評測狀態。★ 實測洛谷**記錄列表**只繪製兩種：
//   status 12 → `Accepted`，底色 rgb(82,196,26)；
//   其它（實測到 14）→ `Unaccepted`，底色 rgb(231,76,60)。
// 幫助文件（manual/luogu/problem/judging）列出的 AC/CE/PC/WA/RE/TLE/MLE/OLE/UKE
// 是**記錄詳情頁**才展開的細分狀態，而「數字碼 → 細分名」這張表本輪沒能取到證據
// （owner 帳號只有 12 與 14 兩種記錄，bundle 裡也搜不到那些字面值）。
// 所以這裡只實作有據可依的兩種，**不編細分名** —— 編錯一個字比少顯示一個字更糟。
// 有證據的碼值（2026-08-13 實測）：
//   12 → Accepted（記錄 179363526 的記錄級；記錄 292611285 的測試點級）
//   14 → Unaccepted（記錄 292611285 記錄級，score 80 也是 14）
//   6  → Wrong Answer（記錄 292611285 的**測試點級**）
// ★ 細分狀態是**測試點級**的；洛谷的**記錄級** status 本身就只有 Accepted/Unaccepted
//   （詳情頁頂部也只寫 Unaccepted）。所以 bestRecord.status 先天只會是這兩種。
//   6 收進表裡是為了相容仍帶細分碼的舊記錄；其餘碼值沒有證據，一律按 Unaccepted 繪製。
const DETAILED = Object.freeze({ 6: "Wrong Answer" });
const ACCEPTED = 12;
export const STATUS_ACCEPTED_COLOR = "#52c41a";
export const STATUS_UNACCEPTED_COLOR = "#e74c3c";

// ★★ `Number(null) === 0` 且 `Number.isFinite(0)` 為真 —— 只判 isFinite 會把
// 「沒有狀態」當成 0，進而繪製成 Unaccepted，也就是**在不知情的情況下斷言使用者沒通過**。
// 這個陷阱本輪已經咬過兩次（canary.7 的計數、這裡的狀態），必須顯式排除空值。
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

// 計數縮寫（owner 拍板）：小於 1000 全顯示；小於 1000000 用 k；否則用 m。
// 保留一位小數，且不留 `1.0k` 這種尾巴。
export function abbreviateCount(value) {
  const n = finiteOrNull(value);
  if (n === null) return null;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs < 1000) return `${sign}${abs}`;
  const scale = abs < 1000000 ? { div: 1000, unit: "k" } : { div: 1000000, unit: "m" };
  // ★★★ **向下截斷，不是四捨五入**，而且兩位小數一位都不省。
  //   判據是 owner 2026-08-14 親自給的 `999999 -> 999.99k` —— 四捨五入會得到
  //   `1000.00k`，既多一位又翻過 k/m 的分界線。★ 這條對**所有**值生效，不只是邊界：
  //   `1237` 截斷成 `1.23k`，四捨五入會是 `1.24k`。
  // ★★ 全程整數運算：先乘 100 再除，而不是「先除再乘 100」。後者會踩浮點，
  //   於是偶發地少一分 —— **實測最小的發散值是 1130**：`1130/1000*100` 是
  //   `112.99999999999999`，`Math.floor` 之後成了 `1.12k`，正確答案是 `1.13k`。
  //   （1000~999999 全掃過一遍，發散的還有 1140/1150/1160/2010/2030…）
  const hundredths = Math.floor((abs * 100) / scale.div);
  const whole = Math.floor(hundredths / 100);
  const frac = String(hundredths % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}${scale.unit}`;
}

// FA duotone 的兩段 path，逐位元組抄自洛谷載入的 `fontawsm~*.js`
// （長度 589+211 與 125+320，與上一輪實測的字元數完全一致）。
// 陣列順序就是 FA 的順序：[secondary, primary]，繪製時 secondary 在下、primary 在上。
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

// 等級 → 徽章配色。拿不到等級、或等級低於最低檔，都回傳 null（＝不畫圖標）。
export function badgeTierColor(level) {
  const value = finiteOrNull(level);
  if (value === null) return null;
  for (const [min, color] of BADGE_TIERS) if (value >= min) return color;
  return null;
}

// CCF 認證徽章（✅）。primary 是那一鉤，恆為白；secondary 是盾面，取等級色。
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

// XCPC 認證徽章（🎈）。★ 與 ✅ 相反：primary 是氣球本體，取等級色；secondary 是那道高光，
// 恆為白。寫反了會得到一個白底卡片上看不見的白氣球。
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
