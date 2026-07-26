# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.12.5](https://img.shields.io/badge/version-2.12.5-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

LuoguSP 是一款面向洛谷的 Tampermonkey 用户脚本，为题号、私信、用户个人页、IDE 模式、受限文章与剪贴板提供实用增强。

项目仓库：[GitHub](https://github.com/ShanireZ/LuoguSP)（主仓库）／[Gitee](https://gitee.com/shanire/LuoguSP)（境内镜像）

## 功能

- **题号显示难度颜色**：在题库、评测记录和练习页面中，为题号显示对应的难度颜色。
- **私信 Ctrl+Click 打开用户个人页**：在私信页面按住 `Ctrl` 点击头像或用户名，直接打开对应用户的个人页。
- **个人页显示个人介绍**：在用户个人页显示原本未渲染的个人介绍，并支持 Markdown、表格、任务列表、KaTeX 公式、代码高亮和代码复制。
- **IDE 模式一键测试所有样例**：在题目页的 IDE 模式下一键运行所有样例，查看每组结果、用时、内存和差异；支持停止、重新测试及结果过期提示。
- **显示受限文章与剪贴板**：遇到「安全访问中心」拦截时，通过[洛谷保存站](https://www.luogu.me/)显示已收录的专栏文章或云剪贴板，并支持申请收录和更新。
- **页面内设置**：从洛谷导航栏进入「插件设置」，按需开启或关闭各项功能。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开脚本 Raw 地址，Tampermonkey 会自动识别脚本，确认安装即可：
   - [Gitee Raw（境内推荐）](https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js)
   - [GitHub Raw](https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js)

也可以使用以下方式安装：

- 复制 `LuoguSP.user.js` 的完整源码，在 Tampermonkey 中新建脚本，粘贴并保存。
- 下载 `LuoguSP.user.js`，将脚本文件拖入 Tampermonkey，确认安装。

## 更新

- 在 Tampermonkey 管理面板中找到 LuoguSP，点击「最后更新时间」检查并安装更新。
- 复制最新版 `LuoguSP.user.js` 源码，替换现有脚本并保存。
- 再次打开任一 Raw 地址，Tampermonkey 会自动识别脚本更新，确认更新即可。

## 开发与构建

源码位于 `src/`，按核心生命周期和功能目录拆分。根目录的
`LuoguSP.user.js` 是由 esbuild 生成的单文件 IIFE 发布产物，请勿直接编辑。

```bash
npm ci
npm run build
npm test
npm run check
```

- `npm run build`：从 `src/entry.js` 生成 `LuoguSP.user.js`。
- `npm run build:check`：检查重新构建后发布产物是否完全一致。
- `npm run quality:check`：检查体积、gzip、解析时间、浏览器启动耗时快照、装配入口行数、功能文件规模、`core` 浏览器全局边界和 `@require` 清单。
- `npm run quality:report`：刷新 `reports/quality-report.json`，包括在线测得的四个 `@require` 资源体积。
- `npm run qa:prepare`：下载 metadata 中固定版本的四个 `@require`，在系统临时目录生成真实页面手工验证用的注入载荷。
- `npm run benchmark:origins`、`npm run analyze:chunks`：刷新 CDN 源站预演和实验性分块分析；它们不会改变生产加载架构。

架构迁移结果与 CDN loader 研究见
[`reports/architecture-modularization.md`](reports/architecture-modularization.md) 和
[`reports/cdn-loader-feasibility.md`](reports/cdn-loader-feasibility.md)。

## 作者

- ShanireZ
- realskc（维护至 1.8.2）

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE) 发布。
