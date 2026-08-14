import { createHash } from "node:crypto";

// 用户脚本产物的「行为哈希」。
//
// ★★★ 为什么不用整份文件的 sha256：`reports/browser-qa.json` 用它来证明
//    「这份产物真的在浏览器里跑过」。但 `@description` 是**纯展示文本** ——
//    油猴只把它显示在管理面板里，改它不可能改变任何运行时行为。
//    而那份报告是**手工维护**的（仓库里没有脚本生成它，也没装 Playwright），
//    一旦因为改了一行说明就作废，就再也补不回来。
//
// ★ 所以只豁免 `@description` 这一行，其余分毫不动：
//   `@require`（钉死的 CDN 产物）、`@match`、`@grant`、`@connect`、`@run-at`、
//   `@sandbox` 全都改变行为，一个都不豁免；脚本体更是原样参与。
//   这是把门**修准**，不是放松。
const DESCRIPTION_LINE = /^\/\/ @description\s.*$/m;
const PLACEHOLDER = "// @description  <not part of the behaviour hash>";

export const behaviourText = (text) =>
  String(text).replace(DESCRIPTION_LINE, PLACEHOLDER);

export const behaviourHashOf = (text) =>
  createHash("sha256").update(behaviourText(text), "utf8").digest("hex");
