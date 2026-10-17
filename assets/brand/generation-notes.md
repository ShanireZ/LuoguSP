<!-- source: BetaPass\std\candidates\luogusp\notes-logo.md -->

> 歸檔說明（2026-08-20）：以下路徑是生成當時的歷史記錄；當前採用源統一為本目錄下
> `luogusp-logo-source.png`、`luogusp-badge-bg-source.png`、`luogusp-stage-bg-source.png`。八色 v1
> 豎版已按廢稿清理，不再保留檔案。

# LuoguSP Logo 原生候選生成記錄

- 日期：2026-08-20（Asia/Shanghai）
- 工具：Codex 內建 `image_gen`
- 呼叫次數：1
- 原始生成路徑：`C:\Users\SkySa\.codex\generated_images\01a01cb2-e058-7191-87c9-54bd3e756fd2\exec-ae9eeb6e-248e-4346-a516-020a580d22f9.png`
- 寫入磁碟路徑：`D:\Workspace\BetaPass\std\candidates\luogusp\logo-source.png`
- 原始尺寸：`1254×1254`
- PNG：`Format32bppArgb`，真實 alpha；四角中三角 `A=0`、左下角 `A=1`（肉眼等效透明），畫布邊緣其餘抽查點 `A=0`
- SHA-256：`077890A3BA1250F13A3A19CB1E9B3AD3BF6EE9617BEBD8C1DAF4CEAAE32E2C95`

## 完整 prompt

```text
Use case: logo-brand
Asset type: transparent platform logo source
Primary request: an original emblem for a browser userscript that overlays an existing website and lights up its entries by difficulty — a thin enhancement lens laid over plain rows
Subject: a square thin glass plate with softly rounded corners and a slim cool-steel bezel, seen straight on; its upper-right corner is peeled up and curls forward like a lifted sticker; inside the plate nine slim horizontal color bands are stacked as a fixed ladder, evenly spaced, each band one flat solid color, in this exact top-to-bottom order: #bfbfbf, #fe4c61, #f39c11, #ffc116, #52c41a, #13c2c2, #3498db, #9d3dcf, #0e1d69; the bottom band #0e1d69 carries a thin cool-white outline so it stays separable from the dark plate interior; where the corner is peeled away, two plain flat gray bars show through underneath, unlit and uncolored; plate, bands and peeled corner fuse into one compact mark
Style/medium: precise interface-object insignia, thin machined bezel and clean flat color, slightly dimensional, crisp edges, strong readable silhouette, no photorealism, no frosted glassmorphism blur
Composition/framing: one centered square emblem, 15% padding, readable at 208px, the nine bands individually countable at full size
Color palette: cool steel gray-blue #7c8899 bezel, near-black #0e1116 plate interior, the nine ladder colors listed above, sparse warm-white specular; no magenta inside the subject
Scene/backdrop: perfectly flat solid #FF00FF chroma-key background for local removal
Constraints: one uniform backdrop with no shadow, gradient, texture, floor or reflection; no text; no letters; no numbers; no watermark; no frame; exactly nine color bands, never eight and never ten; the band order must not be rearranged into a rainbow
Avoid: puzzle piece, jigsaw, monkey or ape or any animal mascot, magnifying glass, gear, cog, angle-bracket code symbol, browser window chrome with three dots, cursor arrow, rainbow gradient, neon cyberpunk, glowing tech-blue orb, circuit board, rounded app-icon plate behind the mark, any existing website logo wordmark or mascot
```

## 九條色帶計數與順序自檢

在完整尺寸下從上到下可辨認的主色帶恰好為 9 條；第 9 條有冷白細描邊，與夜墨內板可分。下表為每條中央位置 `x=600` 的代表像素，樣本用於核對數量與順序，不代表整條色帶的唯一顏色。

| # | 目標色 | 中央代表像素 | 視覺順序 |
| --- | --- | --- | --- |
| 1 | `#bfbfbf` | `#c5c5c4` | 灰 |
| 2 | `#fe4c61` | `#fd4259` | 粉紅 |
| 3 | `#f39c11` | `#f79702` | 橙 |
| 4 | `#ffc116` | `#fdca02` | 金黃 |
| 5 | `#52c41a` | `#47c915` | 綠 |
| 6 | `#13c2c2` | `#05c3cc` | 青 |
| 7 | `#3498db` | `#2f97e4` | 藍 |
| 8 | `#9d3dcf` | `#9e2fde` | 紫 |
| 9 | `#0e1d69` | `#082072` | 深靛藍，帶冷白描邊 |

結論：色帶數量和目標色相順序均正確，沒有少條、多條或調換；但模型加入了高光與輕微明暗變化，代表像素並非九個目標十六進制的逐字精確值，因此當前只通過“計數與順序”的視覺門，不通過“整條純平色且精確色值”的取色器門。

## 禁止項與主體自檢

- 未見文字、字母、數字、站台 Logo/字標/吉祥物或可辨認頁面外觀。
- 未見拼圖塊、猴子/動物、放大鏡、齒輪、尖括號、瀏覽器三點窗框、遊標、科技藍光球或電路板。
- 上右角剝起，露出兩條灰條；九色只在鏡片內主色階出現，鏡片外仍有灰條。
- 生成結果直接帶真實 alpha，沒有使用或保留品紅摳圖底。

---

<!-- source: BetaPass\std\candidates\luogusp\notes-badge.md -->

# LuoguSP badge background native candidate notes

- Date: 2026-08-20 (Asia/Shanghai)
- Tool: Codex built-in `image_gen` (`image_gen.imagegen`), one call only
- Generated path: `C:\Users\SkySa\.codex\generated_images\01a01cb2-c910-7882-95e8-f730f6573c8c\exec-94988f6b-d581-4ade-a151-d20a6e8d5d3d.png`
- Candidate path: `D:\Workspace\BetaPass\std\candidates\luogusp\badge-bg-source.png`
- Native dimensions: 1774 × 887 px (`2:1`, not the requested `3:1`)
- File size: 1,253,984 bytes

## Final prompt

```text
Use case: stylized-concept
Asset type: platform badge background, 3:1 full-bleed
Primary request: a wide dark workspace showing a long stack of plain rows with an enhancement lens hovering over part of it
Scene/backdrop: a deep ink-slate surface carrying a very faint fine interface grid; a long stack of evenly spaced horizontal rows rendered as abstract flat gray bars with no legible characters, fading into darkness toward the left
Subject: right 40% holds the hero — a thin glass lens plate with a slim cool-steel bezel hovering just above the row stack at a slight angle, its upper-right corner peeled up; the rows caught under the lens are lit with the nine difficulty colors #bfbfbf, #fe4c61, #f39c11, #ffc116, #52c41a, #13c2c2, #3498db, #9d3dcf, #0e1d69 in that fixed ladder order and sit a few millimetres higher than the rest; from one lit row a semi-transparent preview panel unfolds outward to the right, blank and characterless; every row outside the lens stays flat gray; left 55% stays dark, flat and low-detail for later typography
Style/medium: premium interface illustration with a real sense of material, thin machined bezel, flat solid color fills, precise, restrained, no frosted glassmorphism blur
Composition/framing: wide 3:1, full bleed, right focal point, clean left text-safe zone
Lighting/mood: low cool key light, one interface-blue #3498db rim highlight along the lens bezel, calm and precise, no drama
Color palette: ink slate #0e1116 and #161b22, cool steel gray-blue #7c8899, warm white #eceff4, interface blue #3498db; the nine ladder colors appear only inside the lens
Constraints: no text, no letters, no numbers, no logo, no watermark, no frame, no legible characters anywhere, no real user interface, no browser chrome, no cursor
Avoid: puzzle piece, jigsaw, monkey or ape or any mascot, magnifying glass, gear, angle-bracket code symbol, rainbow gradient across the whole image, neon cyberpunk, glowing blue network globe, circuit board, any existing website logo or recognizable page design, cluttered left side
```

## Preliminary visual self-check

- Color bands: **PASS by visual count/order** — exactly nine distinct bars are visible inside the lens, ordered gray, pink/red, orange, gold/yellow, green, cyan, blue, purple, deep lapis. The dark ninth bar remains visibly separable from the ink background. The nine colors do not spread across the rest of the image.
- Color fidelity caveat: this is a visual candidate check only. Directional lighting introduces shading across the bars, so the native render must not be treated as an exact pixel-level match to all nine hexadecimal tokens without later measured processing/validation.
- Outside-lens rows: **PASS** — the left-side rows remain gray and unenhanced.
- Left text-safe zone: **PASS** — the hero is concentrated on the right and the left side remains dark, simple, and characterless.
- Character/UI boundary: **PASS** — no readable letters or numbers, pseudo-text, browser chrome, cursor, recognizable site navigation, or identifiable page design observed.
- Prohibited motifs: **PASS** — no existing-site logo/wordmark/mascot, puzzle or jigsaw piece, monkey/ape/animal mascot, magnifying glass, gear, angle-bracket code symbol, network globe, or circuit-board motif observed.
- Preview panel: **PASS** — a blank translucent panel extends to the right with no text or controls.
- Aspect ratio: **FAIL against prompt** — the built-in generator returned `2:1` rather than `3:1`. Per the one-call instruction, no retry was made.
- Overall candidate judgment: visually clean and semantically on-direction, but requires a deliberate 3:1 crop/extension decision before production use; it is not a dimension-complete badge background as generated.

---

<!-- source: BetaPass\std\candidates\luogusp\notes-stage.md -->

# LuoguSP 豎版原生候選生成記錄

- 日期：2026-08-20（Asia/Shanghai）
- 工具：Codex 內建 `image_gen`
- 最終採用：第 2 次（總嘗試 2/2，已停止）
- v1 原始路徑：`C:\Users\SkySa\.codex\generated_images\01a01cb2-f669-7023-a3f9-d66659d9078a\exec-ef996722-e69c-4434-aa8d-b1ed5faabc8b.png`
- v1 處置：僅八條可辨色帶，判廢並於資源歸檔時移除
- v2 原始路徑：`C:\Users\SkySa\.codex\generated_images\01a01cb2-f669-7023-a3f9-d66659d9078a\exec-b58c44a2-edf3-457e-9ed5-1c51c88fc8ca.png`
- v2 入選路徑：本目錄 `luogusp-stage-bg-source.png`

## 原始 prompt

```text
Use case: stylized-concept
Asset type: full-height vertical key-visual background, 4:5
Primary request: a vertical composition looking down a tall column of plain rows, with an enhancement lens crossing it near the top
Scene/backdrop: a tall deep ink-slate field with a very faint fine interface grid; a column of evenly spaced horizontal rows rendered as abstract flat gray bars with no legible characters runs from the top edge to the bottom edge, thinning and dimming as it descends
Subject: the upper third holds the hero — a thin glass lens plate with a slim cool-steel bezel lying across the row column at a slight angle, its upper-right corner peeled up; the rows under it are lit with the nine difficulty colors #bfbfbf, #fe4c61, #f39c11, #ffc116, #52c41a, #13c2c2, #3498db, #9d3dcf, #0e1d69 in that fixed ladder order, brightest at the lens and falling back to flat gray past its edges; one blank semi-transparent preview panel unfolds sideways from a lit row; the vertical middle and lower-middle stay calm, dark and low-detail so a logo and one line of typography can be added later
Style/medium: premium interface illustration, thin machined bezel, flat solid color fills, precise geometry, restrained, tactile
Composition/framing: 4:5 portrait, full bleed; hero inside the upper part of the central 64% safe area; top and bottom 12% expendable to responsive cropping
Lighting/mood: cool low key with a single interface-blue #3498db accent along the bezel, calm, precise, no drama
Color palette: #0e1116, #161b22, cool steel gray-blue #7c8899, warm white #eceff4, interface blue #3498db; the nine ladder colors appear only under the lens
Constraints: no text, no letters, no numbers, no logo, no watermark, no frame, no legible characters anywhere, no real user interface, no browser chrome, no cursor, no people
Avoid: puzzle piece, jigsaw, monkey or ape or any mascot, magnifying glass, gear, angle-bracket code symbol, full-image rainbow gradient, neon, glowing blue globe, circuit board, any existing website logo or recognizable page design, a small logo floating in an empty box
```

第 2 次只追加了下列定向約束：

```text
EXACTLY NINE DISTINCT COLOR BANDS, count them 1 through 9 before rendering; fixed order gray, pink-red, orange, gold-yellow, green, cyan, blue, purple, deep lapis; never omit or merge a band; all nine must be visibly separate; no text/letters/numbers.
```

## 自檢與取捨

- v1：`1122×1402`，約 4:5；無可讀字元、偽 UI、第三方站台標誌或禁用陳詞，但只能明確辨認 8 條色帶，判廢並完整保留。
- v2：`1003×1568`，視覺上恰好 9 條獨立色帶，順序為灰、粉紅、橙、金黃、綠、青、藍、紫、深青金石藍；無可讀字元、字母或數字。
- v2 原生比例不是 4:5。確定性建置從頂部對齊裁成 `1280×1600`，保住上部鏡片 HERO，只裁去下方重複的暗灰條；原始檔不改寫。
- 九色僅出現在鏡片內，鏡片外保留灰條；未見拼圖、猴子/動物、放大鏡、齒輪、瀏覽器窗框、遊標、第三方標誌或可辨頁面外觀。
- 結論：v2 可進入確定性合成，最終成片仍待 owner 視覺審閱。
