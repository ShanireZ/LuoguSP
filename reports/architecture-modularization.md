# LuoguSP 原始碼模組化報告

日期：2026-07-26

## 結論

LuoguSP 已完成“原始碼模組化、發佈時單檔案打包”的架構遷移。開發原始碼改為
ES Modules，發佈入口仍是根目錄 `LuoguSP.user.js`，安裝位址、metadata、
權限、四個 `@require`、五個設定 key 和使用者行為保持不變。

CDN loader 沒有進入生產實作；當前仍以單檔案 IIFE 作為唯一發布架構。

## 遷移前後

| 指標 | 遷移前 Git blob | 當前 |
|---|---:|---:|
| `LuoguSP.user.js` 位元組 | 176,879 | 164,401 |
| gzip 位元組 | 51,122 | 40,495 |
| 發佈檔案行數 | 4,632 | 4,029 |
| `createLuoguSPApp` 所在檔案行數 | 2,760 | 128 |
| Node 測試 | 65/65 | 66/66 |
| 生產 Node/CJS 匯出分支 | 有 | 無 |

發佈檔案體積變化是 esbuild 的穩定格式化副作用，不是本次遷移的主要目標。
主要收益是原始碼邊界、直接測試和裝配複雜度下降。

## 目錄邊界

- `src/core/`：GET 排程、路由適配、頁面生命週期。禁止直接訪問
  `window`、`document`、`localStorage`。
- `src/browser/`：跨功能重複使用的瀏覽器 DOM helper。
- `src/features/<feature>/`：功能 descriptor、DOM 選擇器、觀察器狀態、
  樣式和瀏覽器適配。
- `src/app/`：統一 descriptor 約束和應用裝配。
- `src/entry.js`：瀏覽器啟動與受限頁早期 loading gate。
- `src/userscript.meta.js`：userscript metadata 單獨來源。
- `LuoguSP.user.js`：自動生成的單一 IIFE 發佈產物。

五個可設定功能分別回傳同一種 descriptor：

```text
{ id, key, label, storageKey, defaultEnabled, enabled, mount, onRoute? }
```

設定面板直接讀取這些 descriptor，不再維護第二份 key/label 註冊表。

## 建置和測試

```bash
npm run build
npm run build:check
npm test
npm run check
```

- esbuild 版本通過 `package-lock.json` 精確鎖定。
- `build:check` 在記憶體中重新建置並逐位元組比較 `LuoguSP.user.js`。
- 行為測試直接匯入 `src` 模組；發佈契約測試繼續檢查最終 userscript。
- `npm run check` 串聯可重現建置、品質預算和 66 個測試。

## 品質預算

預算定義在 `config/quality-budget.json`，實測快照位於
`reports/quality-report.json`。

當前主要資料：

- 發佈包：164,401 B；gzip 40,495 B。
- Node `vm.Script` 25 次解析中位數：低於 1 ms；只作為趨勢資料。
- 真實 Chromium 中四個 `@require` 與 userscript 的同步解析/啟動最大值：
  20.3 ms，預算不超過 50 ms；不包含網路下載時間。
- `@require`：4 個，線上實測合計 473,733 B；gzip 143,935 B。
- `createLuoguSPApp`：128 行，預算不超過 300 行。
- 最大功能原始碼檔案：802 行，預算不超過 850 行。
- `core` 瀏覽器全域引用：0。

“branchPoints”是基於原始碼 token 的趨勢指標，不等同於嚴格的 AST
cyclomatic complexity；它用於比較同一指令碼的後續變化。

## 功能複雜度快照

| 功能目錄 | 檔案數 | 行數 | 函式指標 | 分支點指標 |
|---|---:|---:|---:|---:|
| chat-shortcut | 1 | 125 | 17 | 38 |
| hidden-intro | 2 | 473 | 70 | 133 |
| ide-batch | 3 | 1,064 | 131 | 277 |
| problem-color | 3 | 517 | 68 | 159 |
| restricted-content | 12 | 1,602 | 205 | 404 |
| settings | 2 | 229 | 24 | 36 |

IDE 和受限內容仍是主要複雜度來源。它們已經脫離裝配入口，但後續若繼續
優化，應優先按 view、browser driver、document builder 拆分，而不是為了
行數刪除行為。

## 保持不變的發佈契約

- metadata 版本：2.12.5。
- `@match https://www.luogu.com.cn/*`。
- `@grant none`。
- `@run-at document-start`。
- GitHub homepage/support URL。
- CNB update/download URL。
- 四個固定版本 `@require`。
- 五個設定 key 與預設開啟語義。

## 真實頁面驗證

本次在未登入的真實 Chromium / `www.luogu.com.cn` 頁面，用固定版本的四個
`@require` 加當前建置產物完成了以下檢查：

- 首頁原生導覽中設定入口僅 1 個；設定彈層顯示 5 項既定 key，預設均開啟。
- P1001 題目頁麵包屑題號被著為 `rgb(254, 76, 97)`。
- 使用者頁執行 `/user/3 -> /user/3/activity -> /user/3` 的真實 SPA 往返；
  動態頁補顯 1 張簡介卡，回主頁後外掛卡清理為 0，原生簡介恢復為 1。
- SPA 往返後設定入口仍為 1 個，三份功能樣式均未重複。
- 已存檔受限文章 `9vrutkkt` 成功重建為洛谷原生文章殼，正文、目錄、評論、
  “申請更新”和“國際站原文”均正常，且未再出現失敗卡。
- 刷新的基線路由與受限文章頁中，LuoguSP 和洛谷自身的 console
  error/warn 均為 0。
- 同一建置的三次同步解析/啟動為 18.5 ms、20.3 ms、17.7 ms。

結構化證據位於 `reports/browser-qa.json`。品質門會比較其中的
`artifactSha256` 與當前 userscript，避免把舊瀏覽器結果套到新產物。

當前瀏覽器無法安裝 userscript 擴充或在 `document-start` 注入，因此受限頁
首影格 loading gate 仍由模組測試覆蓋。IDE 批量執行和私信 Ctrl+Click 需要
登入態或專用路由夾具，本次未登入驗證未覆蓋；它們仍是發佈前人工迴歸清單。
