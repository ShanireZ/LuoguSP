// esbuild 不讀取 Browserslist。所有瀏覽器產物必須顯式消費這組固定目標。
// 該集合凍結 Baseline Widely Available 的瀏覽器邊界；升級必須發新版 CDN 路徑。
export const ESBUILD_BASELINE_TARGETS = Object.freeze([
  "chrome111",
  "edge111",
  "firefox114",
  "safari16.4",
  "ios16.4",
]);
