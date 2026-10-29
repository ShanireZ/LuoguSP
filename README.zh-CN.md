# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.14.6](https://img.shields.io/badge/version-2.14.6-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文(TW)](README.zh-TW.md) | [日本語](README.ja.md)

用于增强洛谷题目页面、个人主页、IDE 模式、文章和剪贴板的 Tampermonkey 用户脚本。

仓库：[GitHub](https://github.com/ShanireZ/LuoguSP) · [CNB 镜像](https://cnb.cool/Round1/LuoguSP)。

## 功能

- **题目难度着色**：在支持的页面按洛谷难度给题号着色，保留提交列表的原生颜色。
- **题目悬浮预览**：在题目链接旁展示标题、难度、通过／提交次数、限制、可折叠标签和个人状态。
- **用户悬浮预览**：扩展用户名／头像卡片，展示简介、奖项及可用的关注、私信、文章、举报、拉黑操作。
- **个人介绍**：展示个人主页省略的介绍内容。
- **受限文章与剪贴板**：通过 [Luogu Saver](https://www.luogu.me/) 读取存档内容，并提供支持的文章刷新与交互。
- **IDE 样例批量测试**：运行全部样例，检查结果、耗时、内存和输出差异。
- **页内设置**：通过导航栏设置入口启用或关闭功能。

着色跟随首次渲染、分页和客户端导航。已有原生数据在下一次绘制前应用；缺少数据时，挂载后等待 300 ms，再使用缓存或现有请求队列。练习页只处理尝试过的题目，保留已通过列表。首次可见效果还受用户脚本注入时机影响。

难度缓存五分钟后过期，不因查询延长寿命，最多保留 1,000 个已查询条目。悬浮预览有独立的五分钟、60 条缓存。两者均驻留当前标签页内存，跨客户端导航保留，重新加载后清空。过期内容在使用时刷新，不轮询静态页面。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开脚本并确认安装：[CNB Raw](https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js) 或 [GitHub Raw](https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js)。

也可以将完整的 LuoguSP.user.js 源码粘贴到新建用户脚本中，或将下载的文件拖入 Tampermonkey。

## 更新

再次打开任一 Raw 链接并确认更新、使用 Tampermonkey 的更新检查，或用最新完整源码替换已安装脚本。

## 开发

阅读[项目指南](AGENTS.md)与[文档](docs/index.md)。`pnpm check` 检查工作树。本地浏览器夹具 `node scripts/qa/problem-color-local.mjs` 在其输出的地址提供首次绘制着色、分页、导航和请求延迟检查。它不能替代已发布字节的浏览器 QA 或已登录洛谷的实际验证。

## 作者与许可证

由 ShanireZ 维护；realskc 维护了截至 1.8.2 的版本。按 [GNU 通用公共许可证 v3.0](LICENSE) 分发。
