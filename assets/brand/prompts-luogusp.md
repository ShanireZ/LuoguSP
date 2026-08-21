# LuoguSP（`luogusp`）— 提示词

> ★ **本项目不是 BetaPass 平台**，只借用 `BetaPass/std/` 的制作标准（五件套、画幅、安全区、
> 「先图后字」的合成纪律）。资产**不进** `BetaPass/src/web/assets/platform/`，也不登记它的
> `manifest.json`；`validate.cjs` 那条「正好 25 张」的硬断言与本项目无关。
>
> | 落位 | 路径 |
> | --- | --- |
> | BetaPass 镜像 | `BetaPass/std/brand/luogusp/` |
> | 项目完整副本 | `LuoguSP/assets/brand/` |
> | 脚本 | `BetaPass/std/candidates/_build/`（只存 BetaPass） |
>
> 正文一律写工作区相对路径、不用 Markdown 相对链接 —— 两份副本要能逐字节相同。
>
> ★★ **本项目是公开发布物**（GitHub 与 CNB 双仓、CDN 分发、GPL-3.0），与暂不公开的枢衡不同：
> 这套视觉一落地就是对外的。因此它有一条别的项目没有的硬约束 —— **它是第三方站点的第三方插件**，
> 画面里不得出现被增强站点的标志、字标、吉祥物或可辨认的页面外观。`LuoguSP` 是**自己的**牌子，
> 不是那个站点的子品牌。九档难度色的复用口径见「视觉方向 · 商标边界」。
>
> ★ 全文十六进制**一律小写**，正是为了让九档色能与 `LuoguSP/src/core/luogu-difficulty.js` 的
> `DIFFICULTY_COLORS` 逐字相等 —— 改成大写「统一风格」会让 grep 对不上。

## 项目档案

| 项 | 值 |
| --- | --- |
| code / 显示名 | `luogusp` / LuoguSP |
| 定位 | 面向洛谷的 Tampermonkey 用户脚本：题号染难度色、题目与用户悬停预览卡、个人介绍显形、受限文章与剪贴板解限、IDE 模式一键测全样例 |
| 最终文字 | ★ **单语单行主标 `LuoguSP`，没有副标**（照 `horus` 先例） |
| 字体 | 拉丁 **Fira Code Bold**（OFL）· 当前字体与授权副本在本目录 `fonts/` |
| 色板 | 夜墨 `#0e1116` · 石板 `#161b22` · 冷钢灰蓝 `#7c8899` · 暖白 `#eceff4` · 界面蓝 `#3498db` · 九档难度色（唯一彩色源） |
| 视觉方向 | **增强镜片覆在朴素灰条目上，镜片下的条目按九档难度色被点亮** |

### 为什么没有中文主标（我拍的，owner 可否决）

项目自称只有一种形态：`LuoguSP/src/userscript.meta.js` 的 `@name` 是 `LuoguSP`，README 标题是
`LuoguSP`，导航栏那一项叫「插件设置」—— 那是功能名不是产品名。**编一个中文名是产品决策，
不是设计决策**，所以这里照 `horus`（单行 `HORUS`）的先例走单语单行。

owner 若要两行，两条现成的路：

- 加一行描述性副标 `USERSCRIPT`（全大写、宽字距、`#7c8899`），不算新造品牌；
- 或者定一个中文名 —— 那要 owner 自己拍，我不代拍。

### 九档难度色（唯一权威）

取自 `LuoguSP/src/core/luogu-difficulty.js` 的 `DIFFICULTY_COLORS`，那是全仓**唯一**一份色表 ——
它存在的理由正是此前两处各存一份、且两份同时是错的（第 5 / 8 档填成了 Tailwind 的值）。
**顺序不可改、色值不可近似**：

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

第 1 档是「暂无评定」，第 9 档是最难的一档；这是一道**难度阶梯**，不是彩虹。

## 视觉方向

这个插件不生产内容，它**就地把已经在那儿的东西点亮**：题号本来是黑字，它染成难度色；
个人介绍本来没被渲染，它显出来；文章本来被拦，它取回来；样例本来要一组组手点，它一次跑完。
所以主体不是一件器物，而是**一层关系** —— **一片增强镜片压在一叠朴素灰条目上，被镜片盖到的
那几条当场吃上难度色**；镜片之外的条目仍然是灰的，那是「原页面还在，没有被替换」。

★ 灰条用 `#bfbfbf` —— 它正好就是第 1 档「暂无评定」的颜色。**未被增强 ＝ 暂无评定**，
这不是凑出来的巧合，是同一套色表本来的含义。

★ **九色只允许出现在色阶那一处。** 画面其余部分严格是夜墨 / 石板 / 冷钢灰蓝 / 暖白的单色世界，
边缘光与点睛只用界面蓝 `#3498db`（取证自插件自己的按钮与链接色，见 `LuoguSP/src/features/`
下悬停卡的样式；它同时也是第 7 档 `blue-3`）。放开这一条，九色立刻退化成 AI 彩虹渐变 ——
那是这批图里最容易掉进去的坑，因为九个颜色摆在一起本来就长得像渐变。

★ **`puzzle piece` 必须写进 Avoid**：拼图块是浏览器扩展的通用陈词，生成模型看到
"browser extension / userscript" 几乎一定会塞一块进来 —— 它对应枢衡那边的螃蟹。同理要挡住
猴子与猿（用户脚本管理器的名字里带 monkey）、放大镜、齿轮、尖括号代码符号、带三个圆点的浏览器窗框。

★ **背景里的条目行必须是抽象色条，不得出现任何可读字符。** 这一条比另外四个项目都吃紧 ——
画的本来就是一叠文字列表，模型会本能地往里写字。出现可读字母、数字或伪 UI 即判废。

### 商标边界

九档色值是被增强站点的设计令牌，我们复用它是因为**这个产品的工作本身就是把那九个颜色渲染出来**；
色值不是标志。但画面里不得出现那个站点的标志、字标、吉祥物、导航条或任何可辨认的页面外观，
条目行一律是抽象色块。★ **对外发布前 owner 需再确认一次这条口径。**

## 1. Logo 原生生成（随后抠图）

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

抠图后入库 `LuoguSP/assets/brand/luogusp-logo.png`。

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

入库 `LuoguSP/assets/brand/luogusp-badge-bg.webp`。

## 3. 竖版背景原生生成（4:5）

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

入库 `LuoguSP/assets/brand/luogusp-stage-bg.webp`。

## 4. 后期合成

- **徽章**：左侧 1/4 叠 `luogusp-logo.png`；中段排单行 `LuoguSP`；右侧只保留镜片 HERO。
  实际定稿主标为 Fira Code Bold 80px、`#eceff4`、字距 9.5px，组合中心 x=485px；这样末尾 `SP`
  不压进右侧镜片主体。
- ★ **单行主标的排版算术（可复核）**：Fira Code 字身宽约 0.6em，`LuoguSP` 七个字符 →
  7 × 0.6 × 80 ≈ 336px，再加字距约 67px，合计约 403px；组合中心 x=485px 时主体大致落在
  x=284→686，既不挤左侧 Logo，也不会盖住右侧 HERO。
- **竖版宣传图**：中央偏下叠 Logo（占画布宽约 33%，420px），主标排在 Logo 下方；整组中心
  y=68%，与上半部的背景镜片错层，避免两个方形器物正面重叠。
- ★ **这是本批唯一的单语单行。** 中段只有一个词，字号必须取上限、字距拉到 0.12–0.16em，
  否则左侧 Logo 与右侧 HERO 之间会空出一大块 —— 和枢衡两字主标是同一个问题的同一种解法。
- ★ Logo 是**方形**器物，徽章左侧 1/4 那格按**高度**定尺即可（与横向的枢衡不同）。
- ✅ `BetaPass/std/candidates/_build/build-non-platform-assets.cjs` 已支持 `subtitle` 为空时完全收掉副标行，
  并为 LuoguSP 使用上面的单行版式参数。
- ✅ Fira Code Bold 与 OFL 授权副本已落本目录 `fonts/`，确定性合成不依赖系统字体。

## 5. 自检

- **色带恰好九条**，顺序与色值逐条对 `LuoguSP/src/core/luogu-difficulty.js` 的 `DIFFICULTY_COLORS`：
  **用取色器实测，不靠眼看**。少一条、多一条、被排成彩虹，任一即判废。
- **第 9 档 `#0e1d69` 必须与夜墨底 `#0e1116` 分得开**（加冷白细描边，或提亮相邻面）。这两个色
  差得极近，不处理就是「九条只看得见八条」—— 而那样的图第一眼看上去完全正常，正因为如此
  这条要当门来跑，不能靠印象。
- **镜片之外必须还留着灰条**。整幅都是彩色就丢掉了「只增强、不替换」这层意思，退化成一张色卡。
- **不得出现任何可读字符**（条目行、预览面板、边角一律算），也不得出现伪 UI、浏览器窗框、光标。
- 不得出现拼图块、猴子或任何动物吉祥物、放大镜、齿轮、尖括号代码符号、通用科技蓝光球。
- **不得出现被增强站点的标志、字标、吉祥物或可辨认的页面外观。**
- `LuoguSP` 大小写逐字正确（首字母 `L` 与末两位 `SP` 大写，其余小写），
  不写成 `LUOGUSP` / `luogusp` / `LuoguSp` / `Luogusp`。
