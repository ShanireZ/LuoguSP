// 「題號與使用者懸停預覽卡」的按需載入塊入口。
//
// 只有使用者真的把指針停在題號或使用者名上才會被拉下來（見
// features/hover-card/lazy-feature.js 的探針）。啟動包裡只留那個探針。
//
// 契約：`apiVersion` + `createHoverCardFeature`，由
// src/cdn/optional-bundle-loader.js 在載入後檢核（缺哪個匯出會點名報出）。
export { createHoverCardFeature } from "../features/hover-card/feature.js";

export const apiVersion = 1;
