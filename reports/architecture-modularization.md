# LuoguSP 源码模块化报告

日期：2026-07-26

## 结论

LuoguSP 已完成“源码模块化、发布时单文件打包”的架构迁移。开发源码改为
ES Modules，发布入口仍是根目录 `LuoguSP.user.js`，安装地址、metadata、
权限、四个 `@require`、五个设置 key 和用户行为保持不变。

CDN loader 没有进入生产实现；当前仍以单文件 IIFE 作为唯一发布架构。

## 迁移前后

| 指标 | 迁移前 Git blob | 当前 |
|---|---:|---:|
| `LuoguSP.user.js` 字节 | 176,879 | 164,402 |
| gzip 字节 | 51,122 | 40,496 |
| 发布文件行数 | 4,632 | 4,029 |
| `createLuoguSPApp` 所在文件行数 | 2,760 | 128 |
| Node 测试 | 65/65 | 65/65 |
| 生产 Node/CJS 导出分支 | 有 | 无 |

发布文件体积变化是 esbuild 的稳定格式化副作用，不是本次迁移的主要目标。
主要收益是源码边界、直接测试和装配复杂度下降。

## 目录边界

- `src/core/`：GET 调度、路由适配、页面生命周期。禁止直接访问
  `window`、`document`、`localStorage`。
- `src/browser/`：跨功能复用的浏览器 DOM helper。
- `src/features/<feature>/`：功能 descriptor、DOM 选择器、观察器状态、
  样式和浏览器适配。
- `src/app/`：统一 descriptor 约束和应用装配。
- `src/entry.js`：浏览器启动与受限页早期 loading gate。
- `src/userscript.meta.js`：userscript metadata 单独来源。
- `LuoguSP.user.js`：自动生成的单一 IIFE 发布产物。

五个可配置功能分别返回同一种 descriptor：

```text
{ id, key, label, storageKey, defaultEnabled, enabled, mount, onRoute? }
```

设置面板直接读取这些 descriptor，不再维护第二份 key/label 注册表。

## 构建和测试

```bash
npm run build
npm run build:check
npm test
npm run check
```

- esbuild 版本通过 `package-lock.json` 精确锁定。
- `build:check` 在内存中重新构建并逐字节比较 `LuoguSP.user.js`。
- 行为测试直接导入 `src` 模块；发布契约测试继续检查最终 userscript。
- `npm run check` 串联可复现构建、质量预算和 65 个测试。

## 质量预算

预算定义在 `config/quality-budget.json`，实测快照位于
`reports/quality-report.json`。

当前主要数据：

- 发布包：164,402 B；gzip 40,496 B。
- Node `vm.Script` 25 次解析中位数：低于 1 ms；只作为趋势数据。
- 真实 Chromium 中四个 `@require` 与 userscript 的同步解析/启动最大值：
  19.2 ms，预算不超过 50 ms；不包含网络下载时间。
- `@require`：4 个，在线实测合计 473,733 B；gzip 143,935 B。
- `createLuoguSPApp`：128 行，预算不超过 300 行。
- 最大功能源码文件：799 行，预算不超过 850 行。
- `core` 浏览器全局引用：0。

“branchPoints”是基于源码 token 的趋势指标，不等同于严格的 AST
cyclomatic complexity；它用于比较同一脚本的后续变化。

## 功能复杂度快照

| 功能目录 | 文件数 | 行数 | 函数指标 | 分支点指标 |
|---|---:|---:|---:|---:|
| chat-shortcut | 1 | 125 | 17 | 38 |
| hidden-intro | 2 | 473 | 70 | 133 |
| ide-batch | 3 | 1,064 | 131 | 277 |
| problem-color | 3 | 517 | 68 | 159 |
| restricted-content | 12 | 1,599 | 205 | 404 |
| settings | 2 | 229 | 24 | 36 |

IDE 和受限内容仍是主要复杂度来源。它们已经脱离装配入口，但后续若继续
优化，应优先按 view、browser driver、document builder 拆分，而不是为了
行数删除行为。

## 保持不变的发布契约

- metadata 版本：2.12.5。
- `@match https://www.luogu.com.cn/*`。
- `@grant none`。
- `@run-at document-start`。
- GitHub homepage/support URL。
- Gitee update/download URL。
- 四个固定版本 `@require`。
- 五个设置 key 与默认开启语义。

## 真实页面验证

本次在未登录的真实 Chromium / `www.luogu.com.cn` 页面，用固定版本的四个
`@require` 加当前构建产物完成了以下检查：

- 首页原生导航中设置入口仅 1 个；设置弹层显示 5 项既定 key，默认均开启。
- P1001 题目页面包屑题号被着为 `rgb(254, 76, 97)`。
- 用户页执行 `/user/3 -> /user/3/activity -> /user/3` 的真实 SPA 往返；
  动态页补显 1 张简介卡，回主页后插件卡清理为 0，原生简介恢复为 1。
- SPA 往返后设置入口仍为 1 个，三份功能样式均未重复。
- LuoguSP 相关 console error/warn 为 0。洛谷自身在未登录会话产生 2 条
  “用户尚未登录”接口错误，已与插件日志区分。
- 同一构建的三次同步解析/启动为 19.2 ms、5.6 ms、5.9 ms。

结构化证据位于 `reports/browser-qa.json`。质量门会比较其中的
`artifactSha256` 与当前 userscript，避免把旧浏览器结果套到新产物。

当前浏览器无法安装 userscript 扩展或在 `document-start` 注入，因此受限页
首帧 loading gate 仍由模块测试覆盖。IDE 批量运行、私信 Ctrl+Click 和受限
文档重建需要登录态或专用路由夹具，本次未登录公开页验证未覆盖；它们仍是
发布前人工回归清单。
