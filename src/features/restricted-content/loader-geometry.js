// 加载层的几何。**两套加载层必须共用这一份**：
//   1. 早期加载层（src/bootstrap/restricted-early-gate.js，用 html::before/::after，
//      document-start 就起，留在启动包里）；
//   2. 壳内加载层（restricted-content 按需块里的 .luogusp-rst-loader）。
// 它们会先后出现在同一个位置，几何一旦不一致，切换的瞬间转圈就会跳一下。
//
// ★ 转圈与文案都按视口中心**绝对定位**，不要用 flex 居中整列。
//   文案是会变的（"加载中…" → "该内容尚未被保存站收录，已自动发起收录…"），
//   flex 列一旦因为文案变长或换行而改变总高，就会重新居中，把转圈往上顶 ——
//   owner 2026-08-13 报的「转圈随加载状态产生位移」就是这个。
//   绝对定位下文案只会向下生长，转圈一动不动。

export const LOADER_SPINNER_BOX =
  "position:fixed;left:50%;top:50%;width:36px;height:36px;margin:-31px 0 0 -21px;" +
  "border:3px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;";

export const LOADER_MESSAGE_BOX =
  "position:fixed;left:0;right:0;top:calc(50% + 17px);text-align:center;";

export const LOADER_FONT =
  '14px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';

export const LOADER_TEXT_COLOR = "#595959";

export const LOADER_BACKDROP = "#f5f5f5";

// 壳内加载层的完整样式。放在这里而不是 feature.js，是为了让「几何」与「用它的 CSS」
// 同处一地，两套加载层不可能再各自漂移。
export const SHELL_LOADER_CSS =
  `.luogusp-rst-loader{position:fixed;inset:0;z-index:2147483000;background:${LOADER_BACKDROP};color:${LOADER_TEXT_COLOR};font:${LOADER_FONT};}` +
  `.luogusp-rst-spinner{${LOADER_SPINNER_BOX}animation:luogusp-rst-spin .8s linear infinite;}` +
  `.luogusp-rst-loader .msg{${LOADER_MESSAGE_BOX}padding:0 16px;}` +
  "@keyframes luogusp-rst-spin{to{transform:rotate(360deg);}}" +
  "@media (prefers-reduced-motion:reduce){.luogusp-rst-spinner{animation-duration:1.8s;}}";
