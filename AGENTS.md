# AGENTS.md — LuoguSP

> 本文件遵循工作区集体准则 [`../AGENTS.md`](../AGENTS.md)。开始工作前先读它，再读本文件与 [README.md](README.md)。

## 项目是什么

LuoguSP 是一个单文件 Tampermonkey 用户脚本，源码和发布入口都是 [`LuoguSP.user.js`](LuoguSP.user.js)。它只匹配 `https://www.luogu.com.cn/*`，以 `@grant none` 在页面上下文运行。

根目录没有包管理、构建或统一测试命令。修改后应在受支持的用户脚本管理器和真实洛谷页面中手动验证受影响功能。

## 发布元数据

- `@version` 是发布版本的唯一机器可读来源；修改它时同步更新 README 的版本徽记。
- `@homepageURL`、`@supportURL`、`@updateURL` 与 `@downloadURL` 均指向本仓库及其 `main` 分支的原始脚本。改动发布位置时必须一起更新。
- 项目采用 [GPL-3.0](LICENSE)；保留 `@license GPL-3.0`、README 许可证徽记和 `LICENSE` 的一致性。
- 外部运行时依赖通过 `@require` 固定：KaTeX、marked、DOMPurify 与 highlight.js。更新任一依赖前，验证脚本仍可在用户脚本管理器中加载。

## 实现约束

- 所有可开关功能必须同时登记在 `FEATURE_LABELS` 与底部 `FEATURES`；不要只加 UI 或只加启动器。
- `SELECTORS` 集中存放易变的页面选择器。洛谷改版时先核查这里和相应页面的 DOM，再扩大修改范围。
- 补显个人简介使用 `marked` 与 DOMPurify；不得移除消毒步骤，也不得让回退渲染器放行未转义 HTML 或不安全 URL。
- 保持 SPA 处理：设置入口、个人简介和题目难度着色依赖 MutationObserver 与 history 路由监听。修改其一时要检查站内导航后的重复挂载、遗留节点和重复事件绑定。
- 仅请求洛谷同源页面/API；保持当前 `@match` 范围，不引入不必要的第三方网络请求或权限。

## 验证重点

- 检查题目难度着色、广告移除、私信 Ctrl+Click 跳转、个人简介补显和设置面板的开关。
- 在至少一次 SPA 路由切换后复查设置入口、简介卡片和监听器没有重复挂载。
- 发布前确认安装链接、自动更新链接和 README 版本徽记都仍与脚本头一致。
