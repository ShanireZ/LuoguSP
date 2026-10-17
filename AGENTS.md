# AGENTS.md — LuoguSP

> 繼承 [`../AGENTS.md`](../AGENTS.md)；勿假定自動載入。

LuoguSP 是洛谷瀏覽器使用者指令碼。原始碼在 `src/`，`LuoguSP.user.js` 是可重現 loader 產物，`cdn/releases/<version>/` 是不可變 CDN 發佈。使用說明見 [`README.md`](README.md)，不在此複述。

## 命令與驗收

從儲存庫根執行；Node/pnpm 要求與包管理版本以 `package.json` 為準，唯一 lockfile 是 `pnpm-lock.yaml`。命令定義與兩套 CI 對齊；下表不是已通過記錄。

| 何時 | 命令 / 前置 | 能證明什麼 / 邊界 |
|---|---|---|
| 準備依賴 | `pnpm install --frozen-lockfile`；執行環境匹配 | 鎖定檔與 package 一致；不等於行為驗收 |
| 普通原始碼/合同變更 | `pnpm check`；依賴已裝 | baseline:check、可重現建置檢查、品質預算、Node 全套測試；不含已發佈產物的瀏覽器 QA |
| Baseline 診斷 | `pnpm baseline:check` | 查詢邊界與全部 esbuild 瀏覽器產物固定 target 消費點；已含於 check |
| 查看發佈計畫 | `pnpm release -- --plan --version <version>` | 查看計畫，不改生產；不是發佈或 QA 通過 |
| 已授權發佈 | `pnpm release -- --version <version>`；全域 wrangler 已準備/登入 | 建置、部署不可變 CDN 並同步版本檔案，然後停在真實瀏覽器 QA；會外部寫入，publish 僅相容別名 |
| 發佈後注入準備 | `pnpm qa:prepare` | 獲取當前 promoted 的依賴並在系統暫存目錄生成注入物；非離線檢查 |
| 發佈後、提交/推送前 | `pnpm qa:browser`；Chrome/Edge 或 Playwright Chromium 可用 | 測兩條 @require 實際指向的 promoted 位元組，寫 reports/browser-qa.json；離線 fixture 不證明真實洛谷 DOM/線上全連線路徑 |

驗收須區分工作樹 check、發佈位元組 QA、手動線上洛谷行為與自定義源驗證，逐項報告命令/結果/未覆蓋項。qa:browser 應在 release 後跑，不能用工作樹測試替代；優先系統 Chrome/Edge，缺失才退回 bundled Chromium。

## 發佈、資料與安全合同

- 不編輯或覆蓋 `cdn/releases/` 既有目錄/雜湊檔案。`@require #sha256=` 釘住位元組，發佈路徑不可變。
- `wrangler` 為全域 CLI，不由 npx 臨時鎖版；`scripts/cdn/publish.mjs` 先測全域版本，低於 `config/cdn.json` 的 `cli.wrangler.minimum` 即停。降低這個已驗證下限須重驗真實發布。
- 發佈指令碼負責同步 `src/userscript.meta.js`、`LuoguSP.user.js`、package/lockfile、README 版本 badge、CDN manifest、release reports，不手動維護第二套版本源。pnpm 版本只取 packageManager，由 pnpm 自身硬檢核；GitHub/CNB CI 均 frozen install + check。
- QA stamp 使用 `scripts/artifact-behaviour-hash.mjs`：僅豁免 @description 一行，所有其他 metadata/body 都計入 behaviour hash；單改 description 不使真實 QA 失效。
- 獲批修復/增量驗證後聚焦 commit 本機 main；agent 不 push，owner 批量推進 GitHub，CNB 按工作區同步入口執行。推送/同步後核兩端分支頭與 CI；延後推送不弱化本機門禁。
- 專案 release 指不可變 CDN 部署；沒有明確要求不建立 GitHub/CNB Release 物件。
- token、請求頭、cookie、瀏覽器 storage 不得出現在紀錄或入庫 QA 產物。臨時注入/瀏覽器產物放倉外，約定的 reports/browser-qa.json 由 QA 指令碼生成；保留無關使用者修改。

## 外部介面與相容

- Baseline：`runtime: browser-tool`、`featureTarget: newly`；生產語法固定在 `baseline-targets.mjs` 的獲准 Widely 邊界。六欄位/工具快照在 `baseline.config.json`，不復制第二份宣告；Baseline 不補 Web API polyfill，也不替代真實洛谷頁面驗收。
- 洛谷 DOM 與嵌入 payload 是會變動的外部介面：先 shape check，失敗關閉；每次相容修復增加回歸 fixture。
- `/user/{uid}/practice` 只給“嘗試過的題目”著色。“已通過的題目”已有難度分組，不重染色、不抓取、不批量快取。
- Issue tracker：本儲存庫 GitHub Issues；triage、domain、OKF 沿用 [`docs/agents/index.md`](docs/agents/index.md)。
