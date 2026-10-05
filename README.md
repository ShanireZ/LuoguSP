# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.14.6](https://img.shields.io/badge/version-2.14.6-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

LuoguSP 是一款面向洛谷的 Tampermonkey 用户脚本，为题目、个人页、IDE 模式、文章与剪贴板提供实用增强。

项目仓库：[GitHub](https://github.com/ShanireZ/LuoguSP)（主仓库）／[CNB](https://cnb.cool/Round1/LuoguSP)（辅助镜像）

构建采用 Web Platform Baseline 分层策略：Newly 是新能力上限，全部 esbuild 浏览器产物显式冻结到可复现的 Widely 语法目标，并由 `pnpm run baseline:check` 检查核心引擎、下游浏览器和每个构建消费点。Baseline 不提供 Web API polyfill，也不替代真实洛谷页面验收。

## 功能

- **题号显示难度颜色**：在主页、题库、题目详情、题单等位置中，让题号显示对应的难度颜色；评测记录列表保留洛谷原生着色。
- **题目悬停显示预览卡**：鼠标停在题目链接上，就地摊开题名、难度、通过/提交、限制、标签（默认折叠）与我的状态。
- **用户名/头像悬停显示预览卡**：鼠标停在用户名或头像上，复刻并扩展洛谷原生的个人悬停卡——关注/粉丝/等级分/咕值/通过·提交、最近奖项，以及关注、私信、专栏、举报、屏蔽。
- **个人页显示个人介绍**：在用户个人页的主页中，显示原本未渲染的个人介绍。
- **受限文章与剪贴板解限**：遇到「安全访问中心」拦截时，通过[洛谷保存站](https://www.luogu.me/)数据，自动显示该文章或云剪贴板，并支持主动更新、点赞、收藏及评论发送。
- **IDE 模式一键测试所有样例**：在题目页的 IDE 模式下一键运行题目的所有样例，并可查看每组结果、用时、内存和输出差异。
- **页面内设置**：从导航栏进入「插件设置」，可按需开启或关闭各项功能。

题号着色优先使用页面原生难度，支持首屏、翻页与站内跳转：已有数据同步着色，新节点在下一次绘制前补上颜色。插件从 document-start 开始观察页面；实际首次显示仍取决于用户脚本的加载时机。缺失原生数据时，每次挂载等待 300ms 后先查缓存，再按原有队列请求题目数据。个人练习页只处理「尝试过的题目」，不处理「已通过的题目」。

题号难度缓存（包括原生数据与查询结果）有效期为 5 分钟，读取不续期，新收到的数据按新旧顺序覆盖；查询缓存最多 1000 条。悬停卡独立缓存 5 分钟、最多 60 项。缓存都只存在于当前标签页内存，站内跳转保留、刷新清空；过期在下次使用时刷新，不后台轮询已显示的静态页面。

开发验证：`pnpm check` 检查工作树；`node scripts/qa/problem-color-local.mjs` 启动本地浏览器夹具，打开其输出的 URL 查看首帧着色、翻页、跳转和查询延迟结果。该夹具不替代发布后的 `pnpm qa:browser` 或登录态洛谷现场验证。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开脚本 Raw 地址，Tampermonkey 会自动识别脚本，确认安装即可：
   - [CNB Raw（🌟推荐🌟）](https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js)
   - [GitHub Raw](https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js)

也可以使用以下方式安装：

- 复制 `LuoguSP.user.js` 的完整源码，在 Tampermonkey 中新建脚本，粘贴并保存。
- 下载 `LuoguSP.user.js`，将脚本文件拖入 Tampermonkey，确认安装。

## 更新

更新可以用下列方式之一来完成：

- 再次打开任一 Raw 地址，Tampermonkey 会自动识别脚本更新，确认更新即可。（🌟推荐🌟）
- 在 Tampermonkey 管理面板中找到 LuoguSP，点击「最后更新时间」检查并安装更新。
- 复制最新版 `LuoguSP.user.js` 源码，替换现有脚本并保存。

## 作者

- ShanireZ
- realskc（维护至 1.8.2）

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE) 发布。
