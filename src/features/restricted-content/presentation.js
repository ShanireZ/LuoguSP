// 受限内容的**表现层常量与纯函数**：样式、图标、时间/头像格式化、几个输入卫士。
//
// ★ 这些从 `feature.js` 里搬出来，理由只有一个：那个文件顶着 850 行的预算上限
//   （搬之前 845），下一个改动进不去。搬的全是**无闭包依赖**的东西 ——
//   除了 `injectRstStyle` 之外一个都不碰 DOM，所以行为逐字节不变。
//   ★ `injectRstStyle` 也搬了：它只在调用时摸全局 `document`，和本目录其它模块同款，
//     没有捕获 feature 里的任何局部状态。
import { SHELL_LOADER_CSS } from "./loader-geometry.js";

// 转圈与文案都绝对定位（见 loader-geometry.js）：不随文案变长而位移，也与早期加载层严丝合缝。
export const RST_LOADER_CSS = SHELL_LOADER_CSS;
export const RST_LOADER_CONTENT_HTML =
  '<div class="luogusp-rst-spinner" aria-hidden="true"></div><div class="msg">加载中…</div>';
export const RST_LOADER_HTML =
  `<div id="luogusp-rst-loader" class="luogusp-rst-loader" role="status" aria-live="polite">${RST_LOADER_CONTENT_HTML}</div>`;

// 最小自有样式：加载层/失败卡（注入拦截页文档），扩展按钮样式随壳 HTML 走（见 RST_EXTRA_CSS）
export function injectRstStyle() {
  if (document.getElementById("luogusp-rst-style")) return;
  const style = document.createElement("style");
  style.id = "luogusp-rst-style";
  style.textContent = `${RST_LOADER_CSS}
    .luogusp-rst-plain{margin:0;background:#f5f5f5;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#404040;}
    .luogusp-rst-plain a{color:#3498db;text-decoration:none;}
    .luogusp-rst-plaincard{max-width:640px;margin:15vh auto 0;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(26,26,26,.1);padding:1.5em;}
    .luogusp-rst-note{color:#999;font-size:12px;text-align:center;margin:24px 0;}
  `;
  (document.head || document.documentElement).appendChild(style);
}

// 扩展按钮样式（写进壳文档；蓝色=与原生灰色互动钮区分，owner 拍板）。
// ★button-2line 的官方规则是 data-v 作用域的，注入节点吃不到 → 布局自带（镜像官方值）。
export const RST_EXTRA_CSS =
  RST_LOADER_CSS +
  ".luogusp-rst-abtn{display:flex;flex-direction:column;align-items:center;margin:0 1em;cursor:pointer;}" +
  ".luogusp-rst-abtn .icon{font-size:1.25em;margin-bottom:.3em;}" +
  ".luogusp-rst-abtn .text{text-align:center;font-size:.75em;}" +
  ".luogusp-rst-abtn>*{color:#3498db !important;}" +
  ".luogusp-rst-pactions{display:flex;align-items:center;}" +
  ".luogusp-rst-pbtn{font-size:.875em;line-height:1.5;padding:.3125em 1em;margin-left:.5em;color:#fff;background:#3498db;border:1px solid #3498db;border-radius:3px;cursor:pointer;}" +
  ".luogusp-rst-pbtn:hover{background:rgba(52,152,219,.9);}" +
  ".luogusp-rst-off{opacity:.55;cursor:not-allowed;pointer-events:none;}" +
  // 剪贴板页「更新时间」与同行左侧「发表时间」的水平间隔（author 行内横排；
  // ★勿用 margin-top——会把本项在行内往下推出错位。div 选择器只命中剪贴板项，文章页是内联 span 不受影响）
  "div.luogusp-rst-updtime{margin-left:1em;}";
// 扩展按钮图标（FontAwesome Free 6.7.2 solid 原版 path：arrows-rotate / arrow-up-right-from-square）

export const RST_BTN_ICONS = {
  refresh: {
    vb: "0 0 512 512",
    d: "M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160 352 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l111.5 0c0 0 0 0 0 0l.4 0c17.7 0 32-14.3 32-32l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 35.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1L16 432c0 17.7 14.3 32 32 32s32-14.3 32-32l0-35.1 17.6 17.5c0 0 0 0 0 0c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-.1-.1L125.6 352l34.4 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L48.4 288c-1.6 0-3.2 .1-4.8 .3s-3.1 .5-4.6 1z",
  },
  external: {
    vb: "0 0 512 512",
    d: "M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l82.7 0L201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3l0 82.7c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160c0-17.7-14.3-32-32-32L320 0zM80 32C35.8 32 0 67.8 0 112L0 432c0 44.2 35.8 80 80 80l320 0c44.2 0 80-35.8 80-80l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 112c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-320c0-8.8 7.2-16 16-16l112 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 32z",
  },
};

export function rstAvatar(uid) {
  return `https://cdn.luogu.com.cn/upload/usericon/${uid}.png`;
}

// 保存站 ISO 时间 → 本地 "YYYY-MM-DD HH:mm[:ss]"（对齐洛谷原生 <time> 显示格式）
export function rstFmtTime(iso, withSec) {
  const ms = Date.parse(iso || "");
  if (!ms) return null;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return withSec ? `${base}:${p(d.getSeconds())}` : base;
}

// 官方 userSummary：.cn 接口结果优先，保存站作者快照兜底补形
export function rstUserSummary(cnUser, snapshot, uid) {
  if (cnUser) return cnUser;
  const s = snapshot || {};
  return {
    uid: Number(uid) || 0,
    avatar: rstAvatar(uid || 0),
    name: s.name || `用户 ${uid || "?"}`,
    slogan: "",
    badge: s.badge || null,
    isAdmin: false,
    isBanned: false,
    color: s.color || "Gray",
    ccfLevel: s.ccfLevel || 0,
    xcpcLevel: s.xcpcLevel || 0,
    background: "",
  };
}

export const rstPreparationError = (message) =>
  Object.assign(new Error(message), {
    kind: "dom-drift",
    userMessage: message,
  });
export function rstTrustedCdnUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === "https://fecdn.luogu.com.cn"
    );
  } catch (error) {
    return false;
  }
}
export const rstSafeCsrf = (value) =>
  typeof value === "string" && !/["'<>\s]/.test(value);
export const rstEscapeHtmlText = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
