// 載入層的幾何。**兩套載入層必須共用這一份**：
//   1. 早期載入層（src/bootstrap/restricted-early-gate.js，用 html::before/::after，
//      document-start 就起，留在啟動包裡）；
//   2. 殼內載入層（restricted-content 按需塊裡的 .luogusp-rst-loader）。
// 它們會先後出現在同一個位置，幾何一旦不一致，切換的瞬間轉圈就會跳一下。
//
// ★ 轉圈與文案都按視口中心**絕對定位**，不要用 flex 居中整列。
//   文案是會變的（"載入中…" → "該內容尚未被保存站收錄，已自動發起收錄…"），
//   flex 列一旦因為文案變長或換行而改變總高，就會重新居中，把轉圈往上頂 ——
//   owner 2026-08-13 報的「轉圈隨載入狀態產生位移」就是這個。
//   絕對定位下文案只會向下生長，轉圈一動不動。

export const LOADER_SPINNER_BOX =
  "position:fixed;left:50%;top:50%;width:36px;height:36px;margin:-31px 0 0 -21px;" +
  "border:3px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;";

export const LOADER_MESSAGE_BOX =
  "position:fixed;left:0;right:0;top:calc(50% + 17px);text-align:center;";

export const LOADER_FONT =
  '14px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';

export const LOADER_TEXT_COLOR = "#595959";

export const LOADER_BACKDROP = "#f5f5f5";

// 殼內載入層的完整樣式。放在這裡而不是 feature.js，是為了讓「幾何」與「用它的 CSS」
// 同處一地，兩套載入層不可能再各自漂移。
export const SHELL_LOADER_CSS =
  `.luogusp-rst-loader{position:fixed;inset:0;z-index:2147483000;background:${LOADER_BACKDROP};color:${LOADER_TEXT_COLOR};font:${LOADER_FONT};}` +
  `.luogusp-rst-spinner{${LOADER_SPINNER_BOX}animation:luogusp-rst-spin .8s linear infinite;}` +
  `.luogusp-rst-loader .msg{${LOADER_MESSAGE_BOX}padding:0 16px;}` +
  "@keyframes luogusp-rst-spin{to{transform:rotate(360deg);}}" +
  "@media (prefers-reduced-motion:reduce){.luogusp-rst-spinner{animation-duration:1.8s;}}";
