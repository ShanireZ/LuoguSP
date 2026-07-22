# AGENTS.md — LuoguSP

> 本文件遵循工作区集体准则 [`../AGENTS.md`](../AGENTS.md)。开始工作前先读它，再读本文件与 [README.md](README.md)。

## 项目是什么

LuoguSP 是一个单文件 Tampermonkey 用户脚本，源码和发布入口都是 [`LuoguSP.user.js`](LuoguSP.user.js)。它只匹配 `https://www.luogu.com.cn/*`，以 `@grant none` 在页面上下文运行。

根目录没有包管理、构建或统一测试命令。修改后应在受支持的用户脚本管理器和真实洛谷页面中手动验证受影响功能。

## 发布元数据

- `@version` 是发布版本的唯一机器可读来源；修改它时同步更新 README 的版本徽记。
- `@homepageURL` 与 `@supportURL` 指向 GitHub 主仓库；`@updateURL` 与 `@downloadURL` 指向 Gitee 镜像的 `main` 原始脚本（境内自动更新可达）。改动发布位置时必须一起更新。
- 双仓发布纪律：Gitee（<https://gitee.com/shanire/LuoguSP>）是 GitHub 的导入镜像，**每次 push GitHub 后必须到 Gitee 网页手动触发同步**，并确认 Gitee raw 的 `@version` 已到位——自动更新源在 Gitee，忘同步则所有用户收不到新版。
- 项目采用 [GPL-3.0](LICENSE)；保留 `@license GPL-3.0`、README 许可证徽记和 `LICENSE` 的一致性。
- 外部运行时依赖通过 `@require` 固定：KaTeX、marked、DOMPurify 与 highlight.js。更新任一依赖前，验证脚本仍可在用户脚本管理器中加载。

## 实现约束

- 所有可开关功能必须同时登记在 `FEATURE_LABELS` 与底部 `FEATURES`；不要只加 UI 或只加启动器。
- `SELECTORS` 集中存放易变的页面选择器。洛谷改版时先核查这里和相应页面的 DOM，再扩大修改范围。
- 补显个人简介使用 `marked` 与 DOMPurify；不得移除消毒步骤，也不得让回退渲染器放行未转义 HTML 或不安全 URL。
- 保持 SPA 处理：设置入口、个人简介和题目难度着色依赖 MutationObserver 与 history 路由监听。修改其一时要检查站内导航后的重复挂载、遗留节点和重复事件绑定。
- 以洛谷同源页面/API 为主；唯一显式例外是 `api.luogu.me`（洛谷保存站，受限文章/剪贴板功能的数据源，CORS 开放、匿名）。保持当前 `@match` 范围与 `@grant none`，不再引入其他第三方请求或权限。
- markdown 渲染容器蹭样式一律挂 `.luogusp-mdstyle`（纯样式作用域）；`.luogusp-intro-card` 是简介补显的所有权标记，其观察器会在非用户主页删除该类节点，其他功能不得复用。

## 验证重点

- 检查题目难度着色、私信 Ctrl+Click 跳转、个人简介补显和设置面板的开关。
- 在至少一次 SPA 路由切换后复查设置入口、简介卡片和监听器没有重复挂载。
- IDE 一键测试样例：多样例题逐组运行与手风琴展开、CE 短路、停止/重新测试、批测后自定义输入还原、SPA 换题后样例兜底取数。引擎的页面 DOM/接口锚点以 `LuoguSP.user.js` 内 IDE 区段的注释为准，改动前先在真实 IDE 页面核对。
- 受限文章/剪贴板就地显示：仅接管「安全访问中心」拦截页（标题+`pre#url` 双锚点），可正常渲染的文章/剪贴板与 403 Error 页一律不动；已收录内容直接渲染存档（更新仅走「申请更新」按钮），未收录发保存工作流轮询、完成后显示，未公开内容走失败提示。页面为原生 1:1 复刻（文章=columba 版式、剪贴板=旧版 lfe 版式），烘焙样式与接口锚点以脚本内区段注释为准。
- 发布前确认安装链接、自动更新链接和 README 版本徽记都仍与脚本头一致。
