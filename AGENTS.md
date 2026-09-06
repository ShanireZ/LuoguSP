# AGENTS.md — LuoguSP

> 继承 [`../AGENTS.md`](../AGENTS.md) 与 [`../Docs/dev_guide.md`](../Docs/dev_guide.md)；勿假定自动加载。

LuoguSP 是洛谷浏览器用户脚本。源码在 `src/`，`LuoguSP.user.js` 是可复现 loader 产物，`cdn/releases/<version>/` 是不可变 CDN 发布。使用说明见 [`README.md`](README.md)，不在此复述。

## 命令与验收

从仓库根运行；Node/pnpm 要求与包管理版本以 `package.json` 为准，唯一 lockfile 是 `pnpm-lock.yaml`。命令定义与两套 CI 对齐；下表不是已通过记录。

| 何时 | 命令 / 前置 | 能证明什么 / 边界 |
|---|---|---|
| 准备依赖 | `pnpm install --frozen-lockfile`；运行时匹配 | 锁文件与 package 一致；不等于行为验收 |
| 普通源码/合同变更 | `pnpm check`；依赖已装 | baseline:check、可复现构建检查、质量预算、Node 全套测试；不含已发布产物的浏览器 QA |
| Baseline 诊断 | `pnpm baseline:check` | 查询边界与全部 esbuild 浏览器产物固定 target 消费点；已含于 check |
| 查看发布计划 | `pnpm release -- --plan --version <version>` | 查看计划，不改生产；不是发布或 QA 通过 |
| 已授权发布 | `pnpm release -- --version <version>`；全局 wrangler 已准备/登录 | 构建、部署不可变 CDN 并同步版本文件，然后停在真实浏览器 QA；会外部写入，publish 仅兼容别名 |
| 发布后注入准备 | `pnpm qa:prepare` | 获取当前 promoted 的依赖并在系统临时目录生成注入物；非离线检查 |
| 发布后、提交/推送前 | `pnpm qa:browser`；Chrome/Edge 或 Playwright Chromium 可用 | 测两条 @require 实际指向的 promoted 字节，写 reports/browser-qa.json；离线 fixture 不证明真实洛谷 DOM/线上全链路 |

验收须区分工作树 check、发布字节 QA、手工线上洛谷行为与自定义源验证，逐项报告命令/结果/未覆盖项。qa:browser 应在 release 后跑，不能用工作树测试替代；优先系统 Chrome/Edge，缺失才回退 bundled Chromium。

## 发布、数据与安全合同

- 不编辑或覆盖 `cdn/releases/` 既有目录/哈希文件。`@require #sha256=` 钉住字节，发布路径不可变。
- `wrangler` 为全局 CLI，不由 npx 临时锁版；`scripts/cdn/publish.mjs` 先测全局版本，低于 `config/cdn.json` 的 `cli.wrangler.minimum` 即停。降低这个已验证下限须重验真实发布。
- 发布脚本负责同步 `src/userscript.meta.js`、`LuoguSP.user.js`、package/lockfile、README 版本 badge、CDN manifest、release reports，不手工维护第二套版本源。pnpm 版本只取 packageManager，由 pnpm 自身硬校验；GitHub/CNB CI 均 frozen install + check。
- QA stamp 使用 `scripts/artifact-behaviour-hash.mjs`：仅豁免 @description 一行，所有其他 metadata/body 都计入 behaviour hash；单改 description 不使真实 QA 失效。
- 获批修复/增量验证后聚焦 commit 本地 main；agent 不 push，owner 批量推进 GitHub，CNB 按工作区同步入口执行。推送/同步后核两端分支头与 CI；延后推送不弱化本地门禁。
- 项目 release 指不可变 CDN 部署；没有明确要求不创建 GitHub/CNB Release 对象。
- token、请求头、cookie、浏览器 storage 不得出现在日志或入库 QA 产物。临时注入/浏览器产物放仓外，约定的 reports/browser-qa.json 由 QA 脚本生成；保留无关用户修改。

## 外部接口与兼容

- Baseline：`runtime: browser-tool`、`featureTarget: newly`；生产语法固定在 `baseline-targets.mjs` 的获准 Widely 边界。六字段/工具快照在 `baseline.config.json`，不复制第二份声明；Baseline 不补 Web API polyfill，也不替代真实洛谷页面验收。
- 洛谷 DOM 与嵌入 payload 是会变动的外部接口：先 shape check，失败关闭；每次兼容修复增加回归 fixture。
- `/user/{uid}/practice` 只给“尝试过的题目”着色。“已通过的题目”已有难度分组，不重染色、不抓取、不批量缓存。
- Issue tracker：本仓 GitHub Issues；triage、domain、OKF 沿用 [`docs/agents/index.md`](docs/agents/index.md)。
