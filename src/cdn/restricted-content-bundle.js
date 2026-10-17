// 「顯示受限文章與剪貼板」的按需載入塊入口。
//
// 這個功能只在洛谷「安全訪問中心」攔截頁上才有用，卻是啟動包裡最大的一塊
// （2026-08-13 實測 44506 B，佔 121348 B 的 37%），把所有人的每次頁面載入都拖慢了。
// 拆出來之後啟動包降到約 80 KB，重機械只在真的落到攔截頁時才拉。
//
// 契約：`apiVersion` + `createRestrictedContentFeature`，由
// `src/cdn/optional-bundle-loader.js` 在載入後檢核（缺哪個匯出會點名報出）。
export { createRestrictedContentFeature } from "../features/restricted-content/feature.js";

export const apiVersion = 1;
