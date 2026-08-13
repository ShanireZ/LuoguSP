// 「题号与用户悬停预览卡」的按需加载块入口。
//
// 只有用户真的把指针停在题号或用户名上才会被拉下来（见
// features/hover-card/lazy-feature.js 的探针）。启动包里只留那个探针。
//
// 契约：`apiVersion` + `createHoverCardFeature`，由
// src/cdn/optional-bundle-loader.js 在加载后校验（缺哪个导出会点名报出）。
export { createHoverCardFeature } from "../features/hover-card/feature.js";

export const apiVersion = 1;
