// esbuild 不读取 Browserslist。所有浏览器产物必须显式消费这组固定目标。
// 该集合冻结 Baseline Widely Available 的浏览器边界；升级必须发新版 CDN 路径。
export const ESBUILD_BASELINE_TARGETS = Object.freeze([
  "chrome111",
  "edge111",
  "firefox114",
  "safari16.4",
  "ios16.4",
]);
