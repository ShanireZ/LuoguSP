# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.14.6](https://img.shields.io/badge/version-2.14.6-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

LuoguSP 是一款面向洛谷的 Tampermonkey 使用者指令碼，為題目、個人頁、IDE 模式、文章與剪貼板提供實用增強。

專案儲存庫：[GitHub](https://github.com/ShanireZ/LuoguSP)（主儲存庫）／[CNB](https://cnb.cool/Round1/LuoguSP)（輔助鏡像）

建置採用 Web Platform Baseline 分層策略：Newly 是新能力上限，全部 esbuild 瀏覽器產物顯式凍結到可重現的 Widely 語法目標，並由 `pnpm run baseline:check` 檢查核心引擎、下游瀏覽器和每個建置消費點。Baseline 不提供 Web API polyfill，也不替代真實洛谷頁面驗收。

## 功能

- **題號顯示難度顏色**：在主頁、題庫、題目詳情、題單等位置中，讓題號顯示對應的難度顏色；評測記錄列表保留洛谷原生著色。
- **題目懸停顯示預覽卡**：滑鼠停在題目連結上，就地攤開題名、難度、通過/提交、限制、標籤（預設摺疊）與我的狀態。
- **使用者名/頭像懸停顯示預覽卡**：滑鼠停在使用者名或頭像上，復刻並擴充洛谷原生的個人懸停卡——關注/粉絲/等級分/咕值/通過·提交、最近獎項，以及關注、私信、專欄、舉報、屏蔽。
- **個人頁顯示個人介紹**：在使用者個人頁的主頁中，顯示原本未繪製的個人介紹。
- **受限文章與剪貼板解限**：遇到「安全訪問中心」攔截時，通過[洛谷保存站](https://www.luogu.me/)資料，自動顯示該文章或雲剪貼板，並支援主動更新、點贊、收藏及評論傳送。
- **IDE 模式一鍵測試所有樣例**：在題目頁的 IDE 模式下一鍵執行題目的所有樣例，並可查看每組結果、用時、記憶體和輸出差異。
- **頁面內設定**：從導覽欄進入「外掛設定」，可按需開啟或關閉各項功能。

題號著色優先使用頁面原生難度，支援首屏、翻頁與站內跳轉：已有資料同步著色，新節點在下一次繪製前補上顏色。外掛從 document-start 開始觀察頁面；實際首次顯示仍取決於使用者指令碼的載入時機。缺失原生資料時，每次掛載等待 300ms 後先查快取，再按原有佇列請求題目資料。個人練習頁只處理「嘗試過的題目」，不處理「已通過的題目」。

題號難度快取（包括原生資料與查詢結果）有效期為 5 分鐘，讀取不續期，新收到的資料按新舊順序覆蓋；查詢快取最多 1000 條。懸停卡獨立快取 5 分鐘、最多 60 項。快取都只存在於當前標籤頁記憶體，站內跳轉保留、刷新清空；過期在下次使用時刷新，不後台輪詢已顯示的靜態頁面。

開發驗證：`pnpm check` 檢查工作樹；`node scripts/qa/problem-color-local.mjs` 啟動本機瀏覽器夾具，打開其輸出的 URL 查看首影格著色、翻頁、跳轉和查詢延遲結果。該夾具不替代發佈後的 `pnpm qa:browser` 或登入態洛谷現場驗證。

## 安裝

1. 安裝 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打開指令碼 Raw 位址，Tampermonkey 會自動識別指令碼，確認安裝即可：
   - [CNB Raw（🌟推薦🌟）](https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js)
   - [GitHub Raw](https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js)

也可以使用以下方式安裝：

- 複製 `LuoguSP.user.js` 的完整原始碼，在 Tampermonkey 中新建指令碼，粘貼並保存。
- 下載 `LuoguSP.user.js`，將指令碼檔案拖入 Tampermonkey，確認安裝。

## 更新

更新可以用下列方式之一來完成：

- 再次打開任一 Raw 位址，Tampermonkey 會自動識別指令碼更新，確認更新即可。（🌟推薦🌟）
- 在 Tampermonkey 管理面板中找到 LuoguSP，點擊「最後更新時間」檢查並安裝更新。
- 複製最新版 `LuoguSP.user.js` 原始碼，替換現有指令碼並保存。

## 作者

- ShanireZ
- realskc（維護至 1.8.2）

## 授權條款

本專案採用 [GNU General Public License v3.0](LICENSE) 發佈。
