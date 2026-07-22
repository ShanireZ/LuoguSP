# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.9.0](https://img.shields.io/badge/version-2.9.0-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

LuoguSP 是面向洛谷的浏览器用户脚本，用于补充和改善常用页面体验。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或兼容的用户脚本管理器。
2. 下载 [LuoguSP.user.js](https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js)，然后在油猴管理面板中拖放脚本文件。
3. 也可以在油猴管理面板中新建脚本，复制 `LuoguSP.user.js` 的完整代码，粘贴后保存。

## 更新

- 自动更新：在油猴管理面板进入 LuoguSP 脚本，通过设置页面检查并执行更新。
- 手动更新：重新获取最新版 `LuoguSP.user.js`，按安装方式覆盖保存。

## 功能

- 题目难度着色：在题目链接、记录列表、练习页等位置显示对应难度颜色。
- 私信快捷跳转：在私信界面对用户名或头像使用 Ctrl+Click 打开用户主页。
- 显示个人简介：在用户主页补充显示隐藏的个人简介。
- 原生风格渲染：个人简介支持 Markdown、表格、任务列表、KaTeX 公式、代码语法高亮和代码块复制按钮。
- IDE 一键测试样例：题目页 IDE 模式下，「自测」左侧新增按钮，一键逐组运行全部输入输出样例；「自定义测试 | 样例测试」标签页切换，逐组展示 AC/WA/CE/TLE/RE 状态（配色同洛谷原生）、用时内存与逐行 diff 高亮，支持停止、重新测试与结果过期提示。
- 页面内设置：在洛谷导航中加入插件设置入口，可开关各项功能。
- SPA 兼容：洛谷站内路由切换后会自动补充入口和个人简介。

## 兼容性与维护

- 脚本仅匹配 `https://www.luogu.com.cn/*`，在页面加载完成后运行。
- 洛谷的前端 DOM 和接口可能变化。涉及页面选择器或用户资料接口的修改，应在真实洛谷页面中逐项验证。
- 脚本为单文件项目，没有构建步骤；发布版本时须同步 `LuoguSP.user.js` 的 `@version` 与本 README 的版本徽记。

## 作者

- ShanireZ
- realskc (Until 1.8.2)

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE) 发布。
