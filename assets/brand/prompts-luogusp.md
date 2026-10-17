# LuoguSP（`luogusp`）— 提示詞

> ★ **本專案不是 BetaPass 平台**，只借用 `BetaPass/std/` 的製作標準（五件套、畫幅、安全區、
> 「先圖後字」的合成紀律）。資產**不進** `BetaPass/src/web/assets/platform/`，也不登記它的
> `manifest.json`；`validate.cjs` 那條「正好 25 張」的硬斷言與本專案無關。
>
> | 落位 | 路徑 |
> | --- | --- |
> | BetaPass 鏡像 | `BetaPass/std/brand/luogusp/` |
> | 專案完整副本 | `LuoguSP/assets/brand/` |
> | 指令碼 | `BetaPass/std/candidates/_build/`（只存 BetaPass） |
>
> 正文一律寫工作區相對路徑、不用 Markdown 相對連結 —— 兩份副本要能逐位元組相同。
>
> ★★ **本專案是公開發布物**（GitHub 與 CNB 雙倉、CDN 散布、GPL-3.0），與暫不公開的樞衡不同：
> 這套視覺一完成實作就是對外的。因此它有一條別的專案沒有的硬約束 —— **它是第三方站台的第三方外掛**，
> 畫面裡不得出現被增強站台的標誌、字標、吉祥物或可辨認的頁面外觀。`LuoguSP` 是**自己的**牌子，
> 不是那個站台的子品牌。九檔難度色的重複使用口徑見「視覺方向 · 商標邊界」。
>
> ★ 全文十六進制**一律小寫**，正是為了讓九檔色能與 `LuoguSP/src/core/luogu-difficulty.js` 的
> `DIFFICULTY_COLORS` 逐字相等 —— 改成大寫「統一風格」會讓 grep 對不上。

## 專案檔案

| 項 | 值 |
| --- | --- |
| code / 顯示名 | `luogusp` / LuoguSP |
| 定位 | 面向洛谷的 Tampermonkey 使用者指令碼：題號染難度色、題目與使用者懸停預覽卡、個人介紹顯形、受限文章與剪貼簿解限、IDE 模式一鍵測全範例 |
| 最終文字 | ★ **單語單行主標 `LuoguSP`，沒有副標**（照 `horus` 先例） |
| 字體 | 拉丁 **Fira Code Bold**（OFL）· 當前字體與授權副本在本目錄 `fonts/` |
| 色板 | 夜墨 `#0e1116` · 石板 `#161b22` · 冷鋼灰藍 `#7c8899` · 暖白 `#eceff4` · 介面藍 `#3498db` · 九檔難度色（唯一彩色源） |
| 視覺方向 | **增強鏡片覆在樸素灰條目上，鏡片下的條目按九檔難度色被點亮** |

### 為什麼沒有中文主標（我拍的，owner 可否決）

專案自稱只有一種形態：`LuoguSP/src/userscript.meta.js` 的 `@name` 是 `LuoguSP`，README 標題是
`LuoguSP`，導覽欄那一項叫「外掛設定」—— 那是功能名不是產品名。**編一箇中文名是產品決策，
不是設計決策**，所以這裡照 `horus`（單行 `HORUS`）的先例走單語單行。

owner 若要兩行，兩條現成的路：

- 加一行描述性副標 `USERSCRIPT`（全大寫、寬字距、`#7c8899`），不算新造品牌；
- 或者定一箇中文名 —— 那要 owner 自己拍，我不代拍。

### 九檔難度色（唯一權威）

取自 `LuoguSP/src/core/luogu-difficulty.js` 的 `DIFFICULTY_COLORS`，那是全倉**唯一**一份色表 ——
它存在的理由正是此前兩處各存一份、且兩份同時是錯的（第 5 / 8 檔填成了 Tailwind 的值）。
**順序不可改、色值不可近似**：

| # | 色名 | 色值 |
| --- | --- | --- |
| 1 | `grey-3` | `#bfbfbf` |
| 2 | `pink-3` | `#fe4c61` |
| 3 | `orange-3` | `#f39c11` |
| 4 | `gold-3` | `#ffc116` |
| 5 | `green-3` | `#52c41a` |
| 6 | `cyan-3` | `#13c2c2` |
| 7 | `blue-3` | `#3498db` |
| 8 | `purple-3` | `#9d3dcf` |
| 9 | `lapis-4` | `#0e1d69` |

第 1 檔是「暫無評定」，第 9 檔是最難的一檔；這是一道**難度階梯**，不是彩虹。

## 視覺方向

這個外掛不生產內容，它**就地把已經在那兒的東西點亮**：題號本來是黑字，它染成難度色；
個人介紹本來沒被繪製，它顯出來；文章本來被攔，它取回來；範例本來要一組組手點，它一次跑完。
所以主體不是一件器物，而是**一層關係** —— **一片增強鏡片壓在一疊樸素灰條目上，被鏡片蓋到的
那幾條當場吃上難度色**；鏡片之外的條目仍然是灰的，那是「原頁面還在，沒有被替換」。

★ 灰條用 `#bfbfbf` —— 它正好就是第 1 檔「暫無評定」的顏色。**未被增強 ＝ 暫無評定**，
這不是湊出來的巧合，是同一套色表本來的含義。

★ **九色只允許出現在色階那一處。** 畫面其餘部分嚴格是夜墨 / 石板 / 冷鋼灰藍 / 暖白的單色世界，
邊緣光與點睛只用介面藍 `#3498db`（取證自外掛自己的按鈕與連結色，見 `LuoguSP/src/features/`
下懸停卡的樣式；它同時也是第 7 檔 `blue-3`）。放開這一條，九色立刻退化成 AI 彩虹漸變 ——
那是這批圖裡最容易掉進去的坑，因為九個顏色擺在一起本來就長得像漸變。

★ **`puzzle piece` 必須寫進 Avoid**：拼圖塊是瀏覽器擴充的通用陳詞，生成模型看到
"browser extension / userscript" 幾乎一定會塞一塊進來 —— 它對應樞衡那邊的螃蟹。同理要擋住
猴子與猿（使用者指令碼管理器的名字裡帶 monkey）、放大鏡、齒輪、尖括號程式碼符號、帶三個圓點的瀏覽器窗框。

★ **背景裡的條目行必須是抽象色條，不得出現任何可讀字元。** 這一條比另外四個專案都吃緊 ——
畫的本來就是一疊文字列表，模型會本能地往裡寫字。出現可讀字母、數字或偽 UI 即判廢。

### 商標邊界

九檔色值是被增強站台的設計權杖，我們重複使用它是因為**這個產品的工作本身就是把那九個顏色繪製出來**；
色值不是標誌。但畫面裡不得出現那個站台的標誌、字標、吉祥物、導覽條或任何可辨認的頁面外觀，
條目行一律是抽象色塊。★ **對外發布前 owner 需再確認一次這條口徑。**

## 1. Logo 原生生成（隨後摳圖）

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

摳圖後入庫 `LuoguSP/assets/brand/luogusp-logo.png`。

## 2. 徽章背景原生生成（3:1）

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

入庫 `LuoguSP/assets/brand/luogusp-badge-bg.webp`。

## 3. 豎版背景原生生成（4:5）

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

入庫 `LuoguSP/assets/brand/luogusp-stage-bg.webp`。

## 4. 後期合成

- **徽章**：左側 1/4 疊 `luogusp-logo.png`；中段排單行 `LuoguSP`；右側只保留鏡片 HERO。
  實際定稿主標為 Fira Code Bold 80px、`#eceff4`、字距 9.5px，組閤中心 x=485px；這樣末尾 `SP`
  不壓進右側鏡片主體。
- ★ **單行主標的排版算術（可複核）**：Fira Code 字身寬約 0.6em，`LuoguSP` 七個字元 →
  7 × 0.6 × 80 ≈ 336px，再加字距約 67px，合計約 403px；組閤中心 x=485px 時主體大致落在
  x=284→686，既不擠左側 Logo，也不會蓋住右側 HERO。
- **豎版宣傳圖**：中央偏下疊 Logo（佔畫布寬約 33%，420px），主標排在 Logo 下方；整組中心
  y=68%，與上半部的背景鏡片錯層，避免兩個方形器物正面重疊。
- ★ **這是本批唯一的單語單行。** 中段只有一個詞，字號必須取上限、字距拉到 0.12–0.16em，
  否則左側 Logo 與右側 HERO 之間會空出一大塊 —— 和樞衡兩字主標是同一個問題的同一種解法。
- ★ Logo 是**方形**器物，徽章左側 1/4 那格按**高度**定尺即可（與橫向的樞衡不同）。
- ✅ `BetaPass/std/candidates/_build/build-non-platform-assets.cjs` 已支援 `subtitle` 為空時完全收掉副標行，
  併為 LuoguSP 使用上面的單行版式參數。
- ✅ Fira Code Bold 與 OFL 授權副本已落本目錄 `fonts/`，確定性合成不相依系統字體。

## 5. 自檢

- **色帶恰好九條**，順序與色值逐條對 `LuoguSP/src/core/luogu-difficulty.js` 的 `DIFFICULTY_COLORS`：
  **用取色器實測，不靠眼看**。少一條、多一條、被排成彩虹，任一即判廢。
- **第 9 檔 `#0e1d69` 必須與夜墨底 `#0e1116` 分得開**（加冷白細描邊，或提亮相鄰面）。這兩個色
  差得極近，不處理就是「九條只看得見八條」—— 而那樣的圖第一眼看上去完全正常，正因為如此
  這條要當門來跑，不能靠印象。
- **鏡片之外必須還留著灰條**。整幅都是彩色就丟掉了「只增強、不替換」這層意思，退化成一張色卡。
- **不得出現任何可讀字元**（條目行、預覽面板、邊角一律算），也不得出現偽 UI、瀏覽器窗框、遊標。
- 不得出現拼圖塊、猴子或任何動物吉祥物、放大鏡、齒輪、尖括號程式碼符號、通用科技藍光球。
- **不得出現被增強站台的標誌、字標、吉祥物或可辨認的頁面外觀。**
- `LuoguSP` 大小寫逐字正確（首字母 `L` 與末兩位 `SP` 大寫，其餘小寫），
  不寫成 `LUOGUSP` / `luogusp` / `LuoguSp` / `Luogusp`。
