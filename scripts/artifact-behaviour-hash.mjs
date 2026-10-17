import { createHash } from "node:crypto";

// 使用者指令碼產物的「行為雜湊」。
//
// ★★★ 為什麼不用整份檔案的 sha256：`reports/browser-qa.json` 用它來證明
//    「這份產物真的在瀏覽器裡跑過」。但 `@description` 是**純展示文字** ——
//    油猴只把它顯示在管理面板裡，改它不可能改變任何執行環境行為。
//    而那份報告是**手動維護**的（儲存庫裡沒有指令碼生成它，也沒裝 Playwright），
//    一旦因為改了一行說明就作廢，就再也補不回來。
//
// ★ 所以只豁免 `@description` 這一行，其餘分毫不動：
//   `@require`（釘死的 CDN 產物）、`@match`、`@grant`、`@connect`、`@run-at`、
//   `@sandbox` 全都改變行為，一個都不豁免；指令碼體更是原樣參與。
//   這是把門**修準**，不是放鬆。
const DESCRIPTION_LINE = /^\/\/ @description\s.*$/m;
const PLACEHOLDER = "// @description  <not part of the behaviour hash>";

export const behaviourText = (text) =>
  String(text).replace(DESCRIPTION_LINE, PLACEHOLDER);

export const behaviourHashOf = (text) =>
  createHash("sha256").update(behaviourText(text), "utf8").digest("hex");
