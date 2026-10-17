# LuoguSP 品牌資產

本目錄是當前採用版本的完整自包含副本；與 `BetaPass/std/brand/luogusp/` 逐位元組鏡像。
生成、合成與檢核指令碼只保存在 `BetaPass/std/candidates/_build/`，不複製進專案。

## 當前檔案

| 檔案 | 用途 |
|---|---|
| `luogusp-logo-source.png` | 採用的 Logo 原生源或品牌定稿源 |
| `luogusp-logo.png` | 1024×1024 透明 Logo 定稿 |
| `luogusp-badge-bg-source.png` | 橫版原生無字源圖 |
| `luogusp-badge-bg.webp` | 1248×416 無字橫版背景 |
| `luogusp-badge.webp` | 1248×416 帶字橫版定稿 |
| `luogusp-stage-bg-source.png` | 豎版原生無字源圖 |
| `luogusp-stage-bg.webp` | 1280×1600 無字豎版背景 |
| `luogusp.webp` | 1280×1600 帶字豎版定稿 |
| `prompts-luogusp.md` | Logo、橫版、豎版提示詞與合成規範 |
| `fonts/` | 實際合成使用的字體與現有授權文字 |
| `generation-notes.md` | 原生生成、篩選與修正記錄 |

## 字體

Fira Code Bold 用於單行 LuoguSP 字標；OFL 1.1 授權文字隨字體保存。

## 版本紀律

這裡只保留當前採用版本。被否決的生成結果、帶 `v1` / `v2` 的過渡命名和舊建置中間圖不保留；需要重現時以本目錄源圖、提示詞和 BetaPass 內的指令碼為準。
