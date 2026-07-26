# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.13.0](https://img.shields.io/badge/version-2.13.0-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

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
`LuoguSP.user.js` 是由 esbuild 生成的安装与更新入口，请勿直接编辑；
生产功能代码由 metadata 中固定版本且带 SHA-256 的 EdgeOne `@require`
加载。

```bash
npm ci
npm run build
npm test
npm run check
```

- `npm run build`：根据 metadata 自动选择本地完整入口或 CDN 引导入口，
  生成 `LuoguSP.user.js`。
- `npm run build:check`：检查重新构建后发布产物是否完全一致。
- `npm run quality:check`：检查体积、gzip、解析时间、浏览器启动耗时快照、装配入口行数、功能文件规模、`core` 浏览器全局边界和 `@require` 清单。
- `npm run quality:report`：刷新 `reports/quality-report.json`，包括在线测得
  的两个第一方兼容模块与四个第三方 `@require` 资源体积及完整性。
- `npm run qa:prepare`：下载 metadata 中固定版本的六个 `@require`，在
  系统临时目录生成真实页面手工验证用的注入载荷。
- `npm run benchmark:origins`、`npm run analyze:chunks`：刷新 CDN 源站预演和实验性分块分析；它们不会改变生产加载架构。
- `npm run cdn:build -- --version <version>`：生成不可变兼容运行时、ESM canary、逐文件 SHA-256/SRI 和版本 manifest。
- `npm run cdn:publish -- --version <version>`：构建并一键发布到独立的 EdgeOne 与 Cloudflare 项目，然后逐文件校验两个源站。
- `npm run cdn:publish -- --version <version> --skip-build`：重新发布已经生成且不再改写的版本。
- `npm run cdn:stage-userscript -- --version <version>`：生成带 EdgeOne
  SHA-256 `@require` 的小型用户脚本预览到 `dist/staged/`，不修改生产文件。
- `npm run cdn:verify -- --primary <url> --fallback <url>`：单独复核两个源站的内容、MIME、CORS、缓存和哈希。
- `npm run cdn:verify-production -- --version <version>`：只使用配置中的长期自定义域名验证正式资源和暂存用户脚本；临时预览域名、哈希漂移或任一源站不可用都会阻止生产切换。

架构迁移结果与 CDN loader 研究见
[`reports/architecture-modularization.md`](reports/architecture-modularization.md) 和
[`reports/cdn-loader-feasibility.md`](reports/cdn-loader-feasibility.md)。

## CDN 发布架构

第一方 CDN 产物位于 `cdn/releases/<version>/`，所有可执行文件使用内容哈希
命名；`cdn/channels/canary.json` 只负责指向带 SHA-256 的不可变 manifest。
部署配置分别位于 `deploy/edgeone/` 与 `deploy/cloudflare/`，生成的
`dist/cdn/` 不入仓库。

`2.13.0-canary.1` 和正式不可变资源 `2.13.0` 已在独立的 EdgeOne 与
Cloudflare 项目完成双源发布及逐文件一致性校验。生产脚本从境内优先的
`https://spcdn.betaoi.cn` 加载带 SHA-256 的兼容 IIFE；
`https://spcdn.betaoi.cc` 保存完全相同的 Cloudflare 灾备镜像，不会被
同一脚本重复执行。兼容 IIFE 已通过真实洛谷题库页、设置面板和受限文章
还原验证。动态 ESM 因洛谷现行 CSP 的 `connect-src` 不允许页面直接获取
外部 CDN 而保持关闭；生产 metadata 不读取可变 channel，也不包含预览
令牌。

## 作者

- ShanireZ
- realskc（维护至 1.8.2）

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE) 发布。
