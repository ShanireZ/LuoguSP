# 洛谷 IDE 模式侦察实录(2026-07-22,登录态实测)

实测环境:www.luogu.com.cn 新版题目页(columba 前端,Vue3 + CodeMirror 6),P1001,登录态。
本文是实现「一键测试样例」的唯一事实来源;与设计文档冲突处以本文为准。

## 1. 页面数据源

- 题目数据在 `<script id="lentille-context" type="application/json">`,JSON 结构:
  - `.data.problem.samples` = `[[输入, 输出], …]`(含末尾 `\n`);
  - `.data.problem.pid / type / limits` 等;`.data.lastCode / lastLanguage`(服务端存的 IDE 草稿);
  - `.user.uid / .user.name`(登录态)。
- 旧脚本用的 `window._feInstance` 在新题目页**不存在**。

## 2. IDE 模式路由与布局

- 进入/退出 = 同页 hash 路由 `#ide`(「进入 IDE 模式」链接 `href="javascript:void 0"`,点击后 URL 变 `…/problem/P1001#ide`)。
- 右侧 IDE 面板结构:

```
.panel-layout.layout-vertical
├─ .panel.panel-a                       ← 代码区
│  ├─ .ide-toolbar
│  │  ├─ .title (icon + text「代码」)
│  │  └─ .actions
│  │     ├─ button.solid.lform-size-small.lcolor-var-grey-4  「自测」 ★新按钮克隆此元素,插在它前面
│  │     ├─ span(空)
│  │     ├─ .combo-wrapper.lang-select  语言选择
│  │     ├─ div(O2 复选框)
│  │     └─ a.title 「提交」
│  └─ .v-codemirror > .cm-editor        ← CodeMirror 6
├─ .panel-divider
└─ .panel.panel-b > .panel-layout.layout-horizontal
   ├─ .panel.panel-a                    ← 输入面板
   │  ├─ .ide-toolbar(title「输入」,.actions 内 a.title.run「运行」)
   │  └─ textarea.ide-textarea.lfe-code
   ├─ .panel-divider
   └─ .panel.panel-b                    ← 输出面板
      ├─ .ide-toolbar(title「输出」,.actions 内为结果胶囊+run-result,平时为空)
      └─ textarea.ide-textarea.lfe-code
```

## 3. 题面样例区(IDE 模式下)

- `.io-sample` 容器内,每个 pre 一个 `.io-sample-block`:「输入 #N」块与「输出 #N」块**各一个**,都带「复制」「运行」两个 a。
- 点第 N 个「输入」块的「运行」= 测第 N 组样例:**原生流程自动把该样例输入填进输入框、提交运行,并在前端本地与期望输出比较**。

## 4. 运行的网络流

- 唯一请求:XHR `POST /api/ide_submit`,JSON 载荷 `{lang:<int>, code:<string>, input:<string>, o2:"true"}`,响应 `{"status":200,"data":{"rid":<数字>}}`。
- **结果不走轮询**:经页面加载时就建立的常驻 WebSocket 推送——document-end 的用户脚本无法可靠抢先包装,**不要走网络层拿结果**。
- 猜测的 `/api/ide_record/<rid>` 等轮询端点未验证成功,不要依赖。

## 5. 结果呈现(可靠捕获点 = 输出面板 DOM)

输出面板 `.ide-toolbar .actions`:
- 第一个 `span` = 状态胶囊,文字 AC/WA/CE/TLE/RE…,颜色为**内联 style**(background-color/border-color/color);
- `span.run-result`:AC/WA 时 = `24ms 788kb`(时间+内存);RE 时 = 错误原因文本(如 `Received signal 11: Segmentation fault…`);CE/TLE 时**不存在**;
- 输出 textarea:AC/WA = 程序 stdout;CE = 编译错误日志;TLE/RE = 空。

### 完成检测锚点(实测时序)

点「运行」后 **300~560ms 内胶囊与 run-result 被移除、输出框清空**;结果到达时重新出现(AC/WA ~1.3s,RE ~2.6s,TLE ~3.3s)。
→ 判定「本次运行完成」= 胶囊经历 **存在→消失→重现**。该信号对「连续两次结果完全相同」的竞态天然免疫。

### 实测原生配色(内联样式抄录;实现时运行时直接复制胶囊样式,此表仅作面板图例静态兜底)

| 状态 | background | border | 文字色 |
| --- | --- | --- | --- |
| AC | rgb(83,196,26) | rgb(80,161,39) | 白 |
| WA | rgb(231,77,60) | rgb(208,69,53) | 白 |
| CE | rgb(250,219,20) | rgb(215,190,28) | 深色 |
| TLE | rgb(5,34,66) | rgb(10,31,54) | 白 |
| RE | rgb(156,61,207) | rgb(138,62,179) | 白 |

MLE/OLE/UKE 未实测;运行时复制策略天然覆盖。

## 6. 判定语义(重要)

- 样例运行的 **AC/WA 由前端本地比较得出**(服务端不接收期望输出;错误输出实测得 WA 胶囊)。
- → 我们驱动原生样例「运行」按钮即可免费获得含 WA 的最终判定与原生配色;脚本自己的比较仅用于**逐行 diff 渲染与交叉校验**。

## 7. 其他实现要点

- CodeMirror 6 的 EditorView 挂在 `.cm-content` 的 DOM 属性 `cmTile.view`(洛谷构建把 cmView 命名为 cmTile);仅在需要读代码(空代码检测)时使用,写操作不需要。
- 代码变更检测(结果过期标注):监听 `.cm-content` 的 DOM `input`/`keydown` 事件即可,勿依赖内部 API。
- 原生样例运行会**改写输入框内容**:批测开始前快照 `textarea.ide-textarea`(输入面板)值,结束后还原(输出框内容属运行结果,不需还原)。
- 每组样例结果实测 1~3.5s;串行 + 组间 ≥500ms 间隔;`/api/ide_submit` 的 XHR 包装仅用于检测提交失败(非 200/429)与关联运行开始,不用于取结果。
- IDE 模式内左上仍有「复制 Markdown/中文/退出 IDE 模式」链接;「进入/退出 IDE 模式」文字可作模式判定辅助,主判定 = `location.hash === '#ide'` 且 `.ide-toolbar` 存在。
