# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.14.6](https://img.shields.io/badge/version-2.14.6-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文(TW)](README.zh-TW.md) | [日本語](README.ja.md)

用於增強洛谷題目頁面、個人首頁、IDE 模式、文章與剪貼簿的 Tampermonkey 使用者腳本。

儲存庫：[GitHub](https://github.com/ShanireZ/LuoguSP) · [CNB 鏡像](https://cnb.cool/Round1/LuoguSP)。

## 功能

- **題目難度著色**：在支援的頁面依洛谷難度為題號著色，保留提交列表的原生色彩。
- **題目懸停預覽**：在題目連結旁顯示標題、難度、通過／提交次數、限制、可摺疊標籤與個人狀態。
- **使用者懸停預覽**：擴充使用者名稱／頭像卡片，顯示簡介、獎項及可用的追蹤、私訊、文章、檢舉、封鎖操作。
- **個人介紹**：顯示個人首頁省略的介紹內容。
- **受限文章與剪貼簿**：透過 [Luogu Saver](https://www.luogu.me/) 讀取封存內容，並提供支援的文章重新整理與互動。
- **IDE 範例批次測試**：執行全部範例，檢查結果、耗時、記憶體與輸出差異。
- **頁內設定**：透過導覽列設定入口啟用或關閉功能。

著色跟隨首次轉譯、分頁與用戶端導覽。已有原生資料在下一次繪製前套用；缺少資料時，掛載後等待 300 ms，再使用快取或現有請求佇列。練習頁只處理嘗試過的題目，保留已通過列表。首次可見效果也受使用者腳本注入時機影響。

難度快取五分鐘後過期，不因查詢延長壽命，最多保留 1,000 個已查詢項目。懸停預覽有獨立的五分鐘、60 筆快取。兩者均留在目前分頁的記憶體，跨用戶端導覽保留，重新載入後清空。過期內容在使用時更新，不輪詢靜態頁面。

## 安裝

1. 安裝 [Tampermonkey](https://www.tampermonkey.net/)。
2. 開啟腳本並確認安裝：[CNB Raw](https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js) 或 [GitHub Raw](https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js)。

也可以將完整的 LuoguSP.user.js 原始碼貼入新建使用者腳本，或將下載的檔案拖入 Tampermonkey。

## 更新

再次開啟任一 Raw 連結並確認更新、使用 Tampermonkey 的更新檢查，或以最新完整原始碼取代已安裝腳本。

## 開發

閱讀[專案指南](AGENTS.md)與[文件](docs/index.md)。`pnpm check` 檢查工作樹。本機瀏覽器夾具 `node scripts/qa/problem-color-local.mjs` 在其輸出的網址提供首次繪製著色、分頁、導覽與請求延遲檢查。它不能取代已發布位元組的瀏覽器 QA 或已登入洛谷的實際驗證。

## 作者與授權

由 ShanireZ 維護；realskc 維護了截至 1.8.2 的版本。依 [GNU 通用公共授權條款 v3.0](LICENSE) 散布。
