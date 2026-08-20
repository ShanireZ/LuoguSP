# LuoguSP 品牌资产

本目录是当前采用版本的完整自包含副本；与 `BetaPass/std/brand/luogusp/` 逐字节镜像。
生成、合成与校验脚本只保存在 `BetaPass/std/candidates/_build/`，不复制进项目。

## 当前文件

| 文件 | 用途 |
|---|---|
| `luogusp-logo-source.png` | 采用的 Logo 原生源或品牌定稿源 |
| `luogusp-logo.png` | 1024×1024 透明 Logo 定稿 |
| `luogusp-badge-bg-source.png` | 横版原生无字源图 |
| `luogusp-badge-bg.webp` | 1248×416 无字横版背景 |
| `luogusp-badge.webp` | 1248×416 带字横版定稿 |
| `luogusp-stage-bg-source.png` | 竖版原生无字源图 |
| `luogusp-stage-bg.webp` | 1280×1600 无字竖版背景 |
| `luogusp.webp` | 1280×1600 带字竖版定稿 |
| `prompts-luogusp.md` | Logo、横版、竖版提示词与合成规范 |
| `fonts/` | 实际合成使用的字体与现有授权文本 |
| `generation-notes.md` | 原生生成、筛选与修正记录 |

## 字体

Fira Code Bold 用于单行 LuoguSP 字标；OFL 1.1 授权文本随字体保存。

## 版本纪律

这里只保留当前采用版本。被否决的生成结果、带 `v1` / `v2` 的过渡命名和旧构建中间图不保留；需要复现时以本目录源图、提示词和 BetaPass 内的脚本为准。
