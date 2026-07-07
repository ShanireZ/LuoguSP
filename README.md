# LuoguSP

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg)](https://www.tampermonkey.net/)
[![Version](https://img.shields.io/badge/version-2.8.2-2f80ed.svg)](LuoguSP.user.js)

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
- 屏蔽广告：自动移除洛谷页面中的广告区域。
- 私信快捷跳转：在私信界面对用户名或头像使用 Ctrl+Click 打开用户主页。
- 显示个人简介：在境内站用户主页补充显示隐藏的个人简介。
- 原生风格渲染：个人简介支持 Markdown、表格、任务列表、KaTeX 公式、代码语法高亮和代码块复制按钮。
- 页面内设置：在洛谷导航中加入插件设置入口，可开关各项功能。
- SPA 兼容：洛谷站内路由切换后会自动补充入口和个人简介。

## 作者

- ShanireZ
- realskc (Until 1.8.2)

## 许可证

本项目以 GPL-3.0-or-later 协议发布。详见 [LICENSE](LICENSE)。
