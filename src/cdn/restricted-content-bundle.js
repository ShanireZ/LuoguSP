// 「显示受限文章与剪贴板」的按需加载块入口。
//
// 这个功能只在洛谷「安全访问中心」拦截页上才有用，却是启动包里最大的一块
// （2026-08-13 实测 44506 B，占 121348 B 的 37%），把所有人的每次页面加载都拖慢了。
// 拆出来之后启动包降到约 80 KB，重机械只在真的落到拦截页时才拉。
//
// 契约：`apiVersion` + `createRestrictedContentFeature`，由
// `src/cdn/optional-bundle-loader.js` 在加载后校验（缺哪个导出会点名报出）。
export { createRestrictedContentFeature } from "../features/restricted-content/feature.js";

export const apiVersion = 1;
