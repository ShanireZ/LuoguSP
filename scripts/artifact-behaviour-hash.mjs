import { createHash } from "node:crypto";

// 使用者指令碼產物的「行為雜湊」。
//
// `pnpm qa:browser` 用 Playwright 產生 `reports/browser-qa.json`。
// 行為雜湊讓報告可沿用至只修改展示文案的安裝器，因此僅豁免
// `@description`。其餘 metadata 和指令碼本體的原始內容都納入雜湊。
const DESCRIPTION_LINE = /^\/\/ @description\s.*$/m;
const PLACEHOLDER = "// @description  <not part of the behaviour hash>";

export const behaviourText = (text) =>
  String(text).replace(DESCRIPTION_LINE, PLACEHOLDER);

export const behaviourHashOf = (text) =>
  createHash("sha256").update(behaviourText(text), "utf8").digest("hex");
