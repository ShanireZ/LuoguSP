# IDE 一键测试样例 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在洛谷题目页 IDE 模式(#ide)新增「一键测试样例」:逐组驱动题面样例的原生「运行」按钮,结果以 TAB 化的手风琴样例面板呈现。

**Architecture:** 单文件油猴脚本 [LuoguSP.user.js](../../LuoguSP.user.js) 内新增一个功能区段。驱动层 = 程序化点击原生样例运行按钮;结果层 = 输出面板 DOM 锚点(胶囊 存在→消失→重现)+ 内联配色复制;UI 层 = 克隆原生控件的按钮 + 注入 TAB 容器与样例面板。事实来源:[侦察实录](../specs/2026-07-22-ide-mode-recon-notes.md)、[设计文档](../specs/2026-07-22-ide-batch-sample-test-design.md)。

**Tech Stack:** 原生 DOM API、MutationObserver、现有 watchUrlChange/injectStyle/makeCopyButton 基建;无新依赖。

## Global Constraints

- 新功能必须同时登记 `FEATURE_LABELS` 与底部 `FEATURES`(AGENTS.md 铁律)。
- 新页面选择器一律进 `SELECTORS`。
- 仅同源请求;不改 `@match`;不新增 `@require`/权限。
- 所有异常走 `console.error("LuoguSP …")`,不阻断洛谷原生功能。
- 语法验证命令:`node --check LuoguSP.user.js`(本仓库无测试框架;真机验证按 AGENTS.md)。
- 每个 Task 结束提交一次;commit message 中文,格式仿仓库现有历史。
- 判定/配色以侦察实录为准,禁止凭记忆改锚点。

## 真机注入验证法(Task 1/4/5 使用)

登录态 Chrome 打开 `https://www.luogu.com.cn/problem/P1001`,进入 IDE 模式(点「进入 IDE 模式」,URL 变 `#ide`)。把整份 `LuoguSP.user.js` 文本作为 JS 在页面上下文执行(等效 @grant none 的 document-end 注入;`@require` 的 KaTeX/marked 缺席只影响简介功能,与本功能无关)。观察控制台无 `LuoguSP` 前缀报错。

---

### Task 1: 登记、选择器与按钮挂载骨架

**Files:**
- Modify: `LuoguSP.user.js`(SELECTORS ~L48;FEATURE_LABELS ~L59;文件尾 FEATURES ~L1011;新区段插在「题目难度着色」区段之后、「启动」区段之前)

**Interfaces:**
- Produces: `SELECTORS.ideToolbar/.ideToolbarText/.ideToolbarActions/.ideRunResult/.ideTextarea/.ideSampleBlock/.cmContent/.lentilleContext`;`ideToolbarByTitle(title)`;`watchIdeBatch()`(FEATURES 启动器);`ensureIdeBatchUI()`;`startIdeBatch()`(本 Task 内为占位,Task 3 实装)。

- [ ] **Step 1: SELECTORS 增补**

在 `SELECTORS` 对象的 `voidAnchor` 行后追加:

```js
    // —— IDE 模式(2026-07 columba 前端;侦察实录 docs/superpowers/specs/2026-07-22-ide-mode-recon-notes.md)——
    ideToolbar: ".ide-toolbar", // IDE 三个分区(代码/输入/输出)各一条工具栏
    ideToolbarText: ".title .text", // 工具栏标题文字(代码/输入/输出)
    ideToolbarActions: ".actions", // 工具栏右侧按钮容器
    ideRunResult: ".run-result", // 输出工具栏里的 时间+内存 / RE 原因
    ideTextarea: "textarea.ide-textarea", // 输入/输出面板的文本域
    ideSampleBlock: ".io-sample-block", // 题面样例块(输入 #N / 输出 #N 各一块)
    cmContent: ".cm-content", // CodeMirror 6 内容层
    lentilleContext: "script#lentille-context", // 新版页面数据(JSON,含 problem.samples)
```

- [ ] **Step 2: FEATURE_LABELS 登记**

```js
    [`${STORAGE_PREFIX}ideBatchSampleTest`, "IDE 一键测试样例"],
```

- [ ] **Step 3: 新区段骨架**

在「启动」区段前插入:

```js
  // ============================================================
  // IDE 一键测试样例
  // 洛谷新版题目页(columba)IDE 模式(#ide)下,逐组驱动题面样例的原生「运行」,
  // 结果从输出面板 DOM 捕获(结果经页面常驻 WS 推送,网络层拿不到——勿改走拦截)。
  // 锚点与配色的事实来源:docs/superpowers/specs/2026-07-22-ide-mode-recon-notes.md
  // ============================================================
  function ideToolbarByTitle(title) {
    for (const tb of document.querySelectorAll(SELECTORS.ideToolbar)) {
      const t = tb.querySelector(SELECTORS.ideToolbarText);
      if (t && t.textContent.trim() === title) return tb;
    }
    return null;
  }

  const IDE_BATCH = {
    running: false, // 批测进行中(防重入)
    stopReq: false, // 「停止」请求:当前组跑完即停
    driving: false, // 程序化点击原生按钮的瞬间为 true(区分用户手点)
    activeTab: "custom", // custom=原生输入输出 / samples=样例面板
    tabBar: null,
    panel: null,
    ioLayout: null, // 原生 输入|输出 水平分栏(tab 切换时显隐)
    rowsEl: null,
    summaryEl: null,
    stopBtn: null,
    results: null, // 本轮各组结果(过期标注用)
    stale: false,
    inputSnapshot: null, // 批测前用户自定义输入快照
  };

  function ideModeActive() {
    return location.hash === "#ide" && !!document.querySelector(SELECTORS.ideToolbar);
  }

  function startIdeBatch() {
    console.log("LuoguSP ide batch: TODO(Task 3)");
  }

  function mountIdeButton() {
    const tb = ideToolbarByTitle("代码");
    if (!tb) return;
    const actions = tb.querySelector(SELECTORS.ideToolbarActions);
    if (!actions || actions.querySelector(".luogusp-ide-batch-btn")) return;
    const selfTest = [...actions.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "自测",
    );
    if (!selfTest) return;
    // 克隆原生「自测」按钮继承洛谷样式(含 data-v 作用域),只换文字
    const btn = selfTest.cloneNode(true);
    btn.textContent = "一键测试样例";
    btn.classList.add("luogusp-ide-batch-btn");
    btn.disabled = false;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startIdeBatch();
    });
    actions.insertBefore(btn, selfTest);
  }

  function ensureIdeBatchUI() {
    if (!ideModeActive()) {
      unmountIdeBatchUI();
      return;
    }
    mountIdeButton();
  }

  function unmountIdeBatchUI() {
    if (IDE_BATCH.running) IDE_BATCH.stopReq = true; // 退出 IDE/换题:请求停止
    IDE_BATCH.activeTab = "custom"; // 复位,防再次进入时默认落在空面板
    IDE_BATCH.tabBar = IDE_BATCH.panel = IDE_BATCH.ioLayout = null;
    IDE_BATCH.rowsEl = IDE_BATCH.summaryEl = IDE_BATCH.stopBtn = null;
  }

  // SPA:进出 IDE 模式/换题时补挂与清理(rAF 节流,同既有 watchSettingButton 模式)
  function watchIdeBatch() {
    let scheduled = false;
    const tick = () => {
      scheduled = false;
      try {
        ensureIdeBatchUI();
      } catch (e) {
        console.error("LuoguSP ide batch:", e);
      }
    };
    const queue = () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(tick);
      }
    };
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
    watchUrlChange(queue);
    ensureIdeBatchUI();
  }
```

- [ ] **Step 4: FEATURES 注册**

`FEATURES` 数组 `showIntro` 条目后追加:

```js
    { key: `${STORAGE_PREFIX}ideBatchSampleTest`, run: watchIdeBatch },
```

- [ ] **Step 5: 语法验证**

Run: `node --check LuoguSP.user.js`
Expected: 无输出(exit 0)

- [ ] **Step 6: 真机注入验证**

按「真机注入验证法」注入,进入 IDE 模式后:代码工具栏「自测」左侧出现「一键测试样例」按钮,样式与「自测」一致;点击后控制台打出 `LuoguSP ide batch: TODO(Task 3)`;退出 IDE 模式按钮随原生工具栏消失;重新进入再次出现且不重复。

- [ ] **Step 7: Commit**

```bash
git add LuoguSP.user.js
git commit -m "IDE 一键测试样例:登记开关与按钮挂载骨架"
```

---

### Task 2: 样例源、TAB 容器与面板骨架

**Files:**
- Modify: `LuoguSP.user.js`(Task 1 新区段内追加;injectStyle 的 style.textContent 模板尾部追加 CSS)

**Interfaces:**
- Consumes: `IDE_BATCH`、`ideToolbarByTitle`、`SELECTORS.*`、既有 `limiter.fetchText`、`makeCopyButton`。
- Produces: `getIdeSamples() → Promise<[[in,out],…]|null>`;`sampleRunButtons() → HTMLElement[]`(第 N 个=第 N 组);`mountIdeTabs()`;`switchIdeTab(tab)`;`renderIdeRows(samples)`;`expandIdeRow(i)`;`ideRowParts(i) → {row,pill,meta,detail}`;`readIdeCode() → string`。

- [ ] **Step 1: 样例源与代码读取**

```js
  function lentilleProblem() {
    try {
      const el = document.querySelector(SELECTORS.lentilleContext);
      if (!el) return null;
      const json = JSON.parse(el.textContent);
      return (json && json.data && json.data.problem) || null;
    } catch (e) {
      return null;
    }
  }
  function currentPid() {
    const m = location.pathname.match(/^\/problem\/([A-Za-z0-9_]+)/);
    return m ? m[1] : "";
  }
  async function getIdeSamples() {
    const pid = currentPid();
    if (!pid) return null;
    const p = lentilleProblem();
    if (p && p.pid === pid && Array.isArray(p.samples)) return p.samples;
    // SPA 换题后 lentille-context 可能滞留旧题 → 同源接口兜底
    try {
      const text = await limiter.fetchText(`/problem/${pid}?_contentOnly=1`);
      const json = JSON.parse(text);
      const prob =
        (json.currentData && json.currentData.problem) ||
        (json.data && json.data.problem);
      if (prob && Array.isArray(prob.samples)) return prob.samples;
    } catch (e) {
      console.error("LuoguSP ide samples:", e);
    }
    return null;
  }
  function sampleRunButtons() {
    // 「输入 #N」「输出 #N」各一块都带「运行」;只取输入块的,按 DOM 序=样例序
    const btns = [];
    for (const block of document.querySelectorAll(SELECTORS.ideSampleBlock)) {
      if (!/^(输入|Input)/i.test((block.textContent || "").trim())) continue;
      const run = [...block.querySelectorAll("a, button")].find(
        (b) => (b.textContent || "").trim() === "运行",
      );
      if (run) btns.push(run);
    }
    return btns;
  }
  function readIdeCode() {
    const content = document.querySelector(SELECTORS.cmContent);
    if (!content) return "";
    // 洛谷构建把 CM6 的 cmView 命名为 cmTile;拿不到就退化为可见文本(空代码检测够用)
    const view = content.cmTile && content.cmTile.view;
    if (view && view.state && view.state.doc) return view.state.doc.toString();
    return content.textContent || "";
  }
```

- [ ] **Step 2: TAB 容器**

```js
  function mountIdeTabs() {
    if (IDE_BATCH.tabBar && document.contains(IDE_BATCH.tabBar)) return;
    const inputTb = ideToolbarByTitle("输入");
    if (!inputTb) return;
    const ioLayout = inputTb.closest(".panel-layout"); // 底部 输入|输出 水平分栏
    const host = ioLayout && ioLayout.parentElement;
    if (!host) return;
    host.querySelectorAll(".luogusp-ide-tabbar, .luogusp-ide-panel").forEach((e) => e.remove());
    const tabBar = document.createElement("div");
    tabBar.className = "luogusp-ide-tabbar";
    tabBar.innerHTML =
      '<span class="luogusp-ide-tab" data-tab="custom">自定义测试</span>' +
      '<span class="luogusp-ide-tab" data-tab="samples">样例测试</span>';
    tabBar.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) switchIdeTab(t.dataset.tab);
    });
    const panel = document.createElement("div");
    panel.className = "luogusp-ide-panel";
    panel.innerHTML =
      '<div class="luogusp-ide-head">' +
      '<span class="luogusp-ide-title">样例测试</span>' +
      '<span class="luogusp-ide-summary">尚未运行</span>' +
      '<span class="luogusp-ide-headbtns"></span>' +
      "</div>" +
      '<div class="luogusp-ide-rows"></div>';
    // 停止/重新测试:同样克隆原生「自测」继承样式
    const tpl = [...document.querySelectorAll(`${SELECTORS.ideToolbar} button`)].find(
      (b) => (b.textContent || "").trim() === "自测" || b.classList.contains("luogusp-ide-batch-btn"),
    );
    const headBtns = panel.querySelector(".luogusp-ide-headbtns");
    const mkBtn = (text, cls, onClick) => {
      const b = tpl ? tpl.cloneNode(true) : document.createElement("button");
      b.textContent = text;
      b.className = (tpl ? tpl.className : "") + " " + cls;
      b.classList.remove("luogusp-ide-batch-btn");
      b.disabled = false;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      headBtns.appendChild(b);
      return b;
    };
    IDE_BATCH.stopBtn = mkBtn("停止", "luogusp-ide-stop", () => {
      IDE_BATCH.stopReq = true;
    });
    IDE_BATCH.stopBtn.style.display = "none";
    mkBtn("重新测试", "luogusp-ide-rerun", () => startIdeBatch());
    host.insertBefore(tabBar, ioLayout);
    host.appendChild(panel);
    IDE_BATCH.tabBar = tabBar;
    IDE_BATCH.panel = panel;
    IDE_BATCH.ioLayout = ioLayout;
    IDE_BATCH.rowsEl = panel.querySelector(".luogusp-ide-rows");
    IDE_BATCH.summaryEl = panel.querySelector(".luogusp-ide-summary");
    syncIdeTabVisibility();
  }
  function switchIdeTab(tab) {
    IDE_BATCH.activeTab = tab;
    syncIdeTabVisibility();
  }
  function syncIdeTabVisibility() {
    const { tabBar, panel, ioLayout } = IDE_BATCH;
    if (!tabBar || !document.contains(tabBar) || !panel || !ioLayout) return;
    const samples = IDE_BATCH.activeTab === "samples";
    ioLayout.style.display = samples ? "none" : "";
    panel.style.display = samples ? "" : "none";
    tabBar.querySelectorAll(".luogusp-ide-tab").forEach((t) => {
      t.classList.toggle("on", (t.dataset.tab === "samples") === samples);
    });
  }
```

并把 `ensureIdeBatchUI` 中 `mountIdeButton();` 一行改为:

```js
    mountIdeButton();
    mountIdeTabs();
    syncIdeTabVisibility();
```

- [ ] **Step 3: 样例行渲染与手风琴**

```js
  const IDE_PILL_WAIT = "background-color:#bfbfbf;border-color:#b3b3b3;color:#fff;";
  const IDE_PILL_RUN = "background-color:#3498db;border-color:#2f89c5;color:#fff;";
  function renderIdeRows(samples) {
    const rowsEl = IDE_BATCH.rowsEl;
    if (!rowsEl) return;
    rowsEl.innerHTML = samples
      .map(
        (s, i) => `
      <div class="luogusp-ide-row" data-idx="${i}">
        <div class="luogusp-ide-rowhead">
          <span class="luogusp-ide-chev">▶</span>样例 #${i + 1}
          <span class="luogusp-ide-meta"></span>
          <span class="luogusp-ide-pill" style="${IDE_PILL_WAIT}">等待</span>
        </div>
        <div class="luogusp-ide-detail"></div>
      </div>`,
      )
      .join("");
    rowsEl.querySelectorAll(".luogusp-ide-rowhead").forEach((h) => {
      h.addEventListener("click", () => {
        const row = h.parentElement;
        const was = row.classList.contains("open");
        rowsEl.querySelectorAll(".luogusp-ide-row.open").forEach((r) => r.classList.remove("open"));
        if (!was) row.classList.add("open");
      });
    });
  }
  function ideRowParts(i) {
    const row = IDE_BATCH.rowsEl && IDE_BATCH.rowsEl.querySelector(`.luogusp-ide-row[data-idx="${i}"]`);
    if (!row) return null;
    return {
      row,
      pill: row.querySelector(".luogusp-ide-pill"),
      meta: row.querySelector(".luogusp-ide-meta"),
      detail: row.querySelector(".luogusp-ide-detail"),
    };
  }
  function expandIdeRow(i) {
    if (!IDE_BATCH.rowsEl) return;
    IDE_BATCH.rowsEl.querySelectorAll(".luogusp-ide-row.open").forEach((r) => r.classList.remove("open"));
    const p = ideRowParts(i);
    if (p) p.row.classList.add("open");
  }
```

- [ ] **Step 4: CSS 追加**

`injectStyle` 模板字符串尾部(`.luogusp-intro-card .hljs-strong{…}` 行后)追加:

```css
			.luogusp-ide-tabbar{display:flex;gap:20px;padding:0 12px;border-bottom:1px solid #e8e8e8;flex:none;}
			.luogusp-ide-tab{font-size:13px;color:#606266;padding:7px 2px 5px;cursor:pointer;border-bottom:2px solid transparent;}
			.luogusp-ide-tab.on{color:#3498db;border-bottom-color:#3498db;font-weight:500;}
			.luogusp-ide-panel{overflow:auto;flex:1 1 0;min-height:0;padding:8px 12px 12px;font-size:13px;color:#333;}
			.luogusp-ide-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
			.luogusp-ide-title{font-weight:500;}
			.luogusp-ide-summary{font-size:12px;color:#888;}
			.luogusp-ide-headbtns{margin-left:auto;display:flex;gap:6px;}
			.luogusp-ide-row{border:1px solid #e8e8e8;border-radius:6px;margin:0 0 8px;background:#fff;overflow:hidden;}
			.luogusp-ide-rowhead{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;}
			.luogusp-ide-rowhead:hover{background:#f7fbfe;}
			.luogusp-ide-chev{color:#999;width:10px;transition:transform .2s;}
			.luogusp-ide-row.open .luogusp-ide-chev{transform:rotate(90deg);}
			.luogusp-ide-meta{font-size:12px;color:#999;margin-left:auto;}
			.luogusp-ide-pill{font-size:12px;padding:1px 10px;border-radius:10px;border:1px solid transparent;white-space:nowrap;}
			.luogusp-ide-detail{display:none;border-top:1px solid #eee;background:#fcfcfc;padding:10px 12px;}
			.luogusp-ide-row.open .luogusp-ide-detail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
			.luogusp-ide-row.open .luogusp-ide-detail.luogusp-ide-log{display:block;}
			@media (max-width:1500px){.luogusp-ide-row.open .luogusp-ide-detail{grid-template-columns:1fr;}}
			.luogusp-ide-pane h5{margin:0 0 4px;font-size:12px;font-weight:500;color:#888;}
			.luogusp-ide-pane .code-container{margin:0;}
			.luogusp-ide-pane pre{margin:0;border:1px solid #e6e6e6;border-radius:4px;background:#fff;padding:6px 8px;font-size:12px;line-height:1.55;color:#333;overflow-x:auto;min-height:40px;font-family:"Fira Code","Fira Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace;}
			.luogusp-ide-pane .luogusp-ide-diffline{background:#fcebeb;color:#a32d2d;display:block;margin:0 -8px;padding:0 8px;}
			.luogusp-ide-note{font-size:12px;color:#a32d2d;margin:0 0 8px;}
			.luogusp-ide-empty{color:#aaa;font-style:italic;}
			.luogusp-ide-legend{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;padding-top:8px;border-top:1px dashed #eee;font-size:12px;color:#999;}
			.luogusp-ide-panel .code-container:hover>.copy-button{opacity:1;}
			.luogusp-ide-panel .copy-button{position:absolute;top:.3em;right:.3em;padding:.45em;display:flex;align-items:center;justify-content:center;transition:opacity .2s;opacity:0;background:transparent;border:0;border-radius:4px;cursor:pointer;color:#555;}
			.luogusp-ide-panel .copy-button.copied{color:#52c41a;}
			.luogusp-ide-panel .copy-icon{width:1em;height:1em;}
```

- [ ] **Step 5: 语法验证**

Run: `node --check LuoguSP.user.js`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add LuoguSP.user.js
git commit -m "IDE 一键测试样例:样例源、TAB 容器与面板骨架"
```

---

### Task 3: 测试引擎(驱动+锚点+调度)

**Files:**
- Modify: `LuoguSP.user.js`(同区段追加;替换 Task 1 的占位 `startIdeBatch`)

**Interfaces:**
- Consumes: Task 2 全部;`sleep`;`outputParts`。
- Produces: `installIdeSubmitObserver()`;`waitIdeSubmit(ms) → Promise<number|null>`;`outputParts() → {pill,rr,textarea}|null`;`runOneSample(runBtn, abort) → Promise<{verdict,pillStyle?,detail?,output?,note?}>`;`startIdeBatch()`(真实现);`applyIdeResult(i, r, sample)`(Task 4 实装渲染,本 Task 先以最小占位:设 pill 文字与 meta)。

- [ ] **Step 1: XHR 观察器与等待器**

```js
  let ideSubmitWaiter = null;
  function installIdeSubmitObserver() {
    if (XMLHttpRequest.prototype.open.__luoguspIde) return;
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    const open = function (method, url) {
      this.__luoguspIdeSubmit =
        typeof url === "string" && url.indexOf("/api/ide_submit") !== -1;
      return rawOpen.apply(this, arguments);
    };
    const send = function () {
      if (this.__luoguspIdeSubmit)
        this.addEventListener("loadend", () => {
          if (ideSubmitWaiter) {
            const w = ideSubmitWaiter;
            ideSubmitWaiter = null;
            w(this.status);
          }
        });
      return rawSend.apply(this, arguments);
    };
    open.__luoguspIde = true;
    XMLHttpRequest.prototype.open = open;
    XMLHttpRequest.prototype.send = send;
  }
  function waitIdeSubmit(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (ideSubmitWaiter === fn) ideSubmitWaiter = null;
        resolve(null);
      }, ms);
      const fn = (status) => {
        clearTimeout(timer);
        resolve(status);
      };
      ideSubmitWaiter = fn;
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 2: 输出面板读取与锚点等待**

```js
  function outputParts() {
    const tb = ideToolbarByTitle("输出");
    if (!tb) return null;
    const actions = tb.querySelector(SELECTORS.ideToolbarActions);
    const spans = actions ? [...actions.querySelectorAll("span")] : [];
    return {
      pill: spans.find((s) => !s.classList.contains("run-result")) || null,
      rr: actions ? actions.querySelector(SELECTORS.ideRunResult) : null,
      textarea: tb.parentElement
        ? tb.parentElement.querySelector(SELECTORS.ideTextarea)
        : null,
    };
  }
  // 完成锚点:胶囊 存在→消失→重现(实测清空 300~560ms、结果 1~3.5s;详见侦察实录)
  // 注意:此处不看 stopReq——设计口径是「当前组跑完即停」,停止只在组间生效
  async function waitIdePill(present, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const parts = outputParts();
      if (!parts) return null; // IDE 已卸载
      if (!!parts.pill === present) return parts.pill || true;
      await sleep(150);
    }
    return null;
  }
```

- [ ] **Step 3: 单组样例驱动**

```js
  async function runOneSample(runBtn) {
    const before = outputParts();
    if (!before) return { verdict: "UKE", note: "IDE 面板不存在" };
    const hadPill = !!before.pill;
    let submitP = waitIdeSubmit(10000);
    IDE_BATCH.driving = true;
    runBtn.click();
    IDE_BATCH.driving = false;
    let status = await submitP;
    if (status === 429) {
      await sleep(3000); // 限流:等 3s 原地重试一次
      submitP = waitIdeSubmit(10000);
      IDE_BATCH.driving = true;
      runBtn.click();
      IDE_BATCH.driving = false;
      status = await submitP;
    }
    if (status == null || status < 200 || status >= 300)
      return {
        verdict: "UKE",
        note: status == null ? "未观测到提交请求" : `提交失败 HTTP ${status}`,
      };
    if (hadPill && (await waitIdePill(false, 5000)) === null && !IDE_BATCH.stopReq)
      return { verdict: "UKE", note: "旧结果未清空,疑似运行未开始" };
    const pill = await waitIdePill(true, 30000);
    if (!pill || pill === true) return { verdict: "UKE", note: "30s 未返回结果" };
    const parts = outputParts();
    return {
      verdict: (pill.textContent || "").trim() || "UKE",
      pillStyle: pill.getAttribute("style") || "",
      detail: parts.rr ? parts.rr.textContent.trim() : "",
      output: parts.textarea ? parts.textarea.value : "",
    };
  }
```

- [ ] **Step 4: 批测调度(替换占位 startIdeBatch)**

```js
  function ideBatchHint(msg) {
    const btn = document.querySelector(".luogusp-ide-batch-btn");
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = msg;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = old;
      btn.disabled = IDE_BATCH.running;
    }, 1500);
  }
  async function startIdeBatch() {
    if (IDE_BATCH.running) return;
    mountIdeTabs();
    const samples = await getIdeSamples();
    if (!samples || !samples.length) return ideBatchHint("本题无样例");
    if (!readIdeCode().trim()) return ideBatchHint("代码为空");
    const runBtns = sampleRunButtons();
    if (!runBtns.length) return ideBatchHint("找不到样例运行按钮");
    const n = Math.min(samples.length, runBtns.length);
    if (runBtns.length !== samples.length)
      console.error("LuoguSP ide batch: 样例数与运行按钮数不一致", samples.length, runBtns.length);
    IDE_BATCH.running = true;
    IDE_BATCH.stopReq = false;
    IDE_BATCH.stale = false;
    IDE_BATCH.results = new Array(n).fill(null);
    const inputTa = (() => {
      const tb = ideToolbarByTitle("输入");
      return tb && tb.parentElement
        ? tb.parentElement.querySelector(SELECTORS.ideTextarea)
        : null;
    })();
    IDE_BATCH.inputSnapshot = inputTa ? inputTa.value : null;
    const batchBtn = document.querySelector(".luogusp-ide-batch-btn");
    const selfTest = (() => {
      const tb = ideToolbarByTitle("代码");
      const actions = tb && tb.querySelector(SELECTORS.ideToolbarActions);
      return actions
        ? [...actions.querySelectorAll("button")].find(
            (b) => (b.textContent || "").trim() === "自测",
          )
        : null;
    })();
    if (batchBtn) batchBtn.disabled = true;
    if (selfTest) selfTest.disabled = true; // 批测中禁原生自测防互相干扰
    if (IDE_BATCH.stopBtn) IDE_BATCH.stopBtn.style.display = "";
    switchIdeTab("samples");
    renderIdeRows(samples);
    if (IDE_BATCH.summaryEl) IDE_BATCH.summaryEl.textContent = "测试中…";
    let ceLog = null;
    for (let i = 0; i < n; i++) {
      if (IDE_BATCH.stopReq) break;
      const p = ideRowParts(i);
      if (p) {
        p.pill.setAttribute("style", IDE_PILL_RUN);
        p.pill.textContent = "运行中";
      }
      expandIdeRow(i);
      let r;
      try {
        r = await runOneSample(runBtns[i]);
      } catch (e) {
        console.error("LuoguSP ide batch:", e);
        r = { verdict: "UKE", note: String(e) };
      }
      IDE_BATCH.results[i] = r;
      applyIdeResult(i, r, samples[i]);
      if (r.verdict === "CE") {
        ceLog = r.output || "";
        for (let j = i + 1; j < n; j++) {
          IDE_BATCH.results[j] = { verdict: "CE", output: ceLog, note: "编译错误" };
          applyIdeResult(j, IDE_BATCH.results[j], samples[j]);
        }
        break;
      }
      if (i < n - 1 && !IDE_BATCH.stopReq) await sleep(500); // 组间限速
    }
    if (inputTa && IDE_BATCH.inputSnapshot != null) {
      inputTa.value = IDE_BATCH.inputSnapshot; // 还原用户自定义输入
      inputTa.dispatchEvent(new Event("input", { bubbles: true })); // 同步 Vue 绑定
    }
    IDE_BATCH.running = false;
    if (batchBtn) batchBtn.disabled = false;
    if (selfTest) selfTest.disabled = false;
    if (IDE_BATCH.stopBtn) IDE_BATCH.stopBtn.style.display = "none";
    finishIdeSummary();
  }
```

- [ ] **Step 5: 占位的结果渲染与汇总(Task 4 实装)**

```js
  function applyIdeResult(i, r, sample) {
    const p = ideRowParts(i);
    if (!p) return;
    p.pill.textContent = r.verdict;
    if (r.pillStyle) p.pill.setAttribute("style", r.pillStyle);
    p.meta.textContent = r.detail || r.note || "";
  }
  function finishIdeSummary() {
    if (!IDE_BATCH.summaryEl || !IDE_BATCH.results) return;
    const done = IDE_BATCH.results.filter(Boolean);
    const ac = done.filter((r) => r.verdict === "AC").length;
    IDE_BATCH.summaryEl.textContent = `${ac}/${IDE_BATCH.results.length} 通过`;
  }
```

- [ ] **Step 6: 观察器安装接线**

`watchIdeBatch()` 开头(`let scheduled` 之前)加一行:

```js
    installIdeSubmitObserver();
```

- [ ] **Step 7: 语法验证**

Run: `node --check LuoguSP.user.js`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add LuoguSP.user.js
git commit -m "IDE 一键测试样例:测试引擎(驱动原生运行+胶囊锚点+串行调度)"
```

---

### Task 4: 结果渲染、diff、图例与过期标注

**Files:**
- Modify: `LuoguSP.user.js`(替换 Task 3 的占位 `applyIdeResult`/`finishIdeSummary`;追加 diff/图例/过期逻辑)

**Interfaces:**
- Consumes: Task 2/3 全部;既有 `makeCopyButton`。
- Produces: `normalizeIdeOut(s)`;`applyIdeResult(i,r,sample)`(完整);`finishIdeSummary()`(完整,含自动展开);`markIdeStale()`;图例常量 `IDE_LEGEND`。

- [ ] **Step 1: 判定口径与 diff**

```js
  // 判定口径同洛谷:CRLF 归一、去行尾空格、去末尾空行。仅用于 diff 渲染与交叉校验,
  // 最终判定以原生胶囊为准(AC/WA 由洛谷前端本地比较,侦察实录 §6)。
  function normalizeIdeOut(s) {
    return String(s == null ? "" : s)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/\n+$/, "");
  }
```

- [ ] **Step 2: 完整结果渲染(替换占位 applyIdeResult)**

```js
  function idePane(title, lines, badSet, emptyNote) {
    const pre = document.createElement("pre");
    if (!lines.length || (lines.length === 1 && lines[0] === "")) {
      if (emptyNote) {
        const span = document.createElement("span");
        span.className = "luogusp-ide-empty";
        span.textContent = emptyNote;
        pre.appendChild(span);
      }
    } else {
      lines.forEach((l, k) => {
        const span = document.createElement("span");
        if (badSet && badSet.has(k)) span.className = "luogusp-ide-diffline";
        span.textContent = l;
        pre.appendChild(span);
        if (k < lines.length - 1) pre.appendChild(document.createTextNode("\n"));
      });
    }
    const box = document.createElement("div");
    box.className = "code-container";
    box.append(pre, makeCopyButton(pre));
    const pane = document.createElement("div");
    pane.className = "luogusp-ide-pane";
    const h = document.createElement("h5");
    h.textContent = title;
    pane.append(h, box);
    return pane;
  }
  function applyIdeResult(i, r, sample) {
    const p = ideRowParts(i);
    if (!p) return;
    p.pill.textContent = r.verdict;
    p.pill.setAttribute(
      "style",
      r.pillStyle || "background-color:#3d3d3d;border-color:#333;color:#fff;",
    );
    p.detail.innerHTML = "";
    p.detail.classList.remove("luogusp-ide-log");
    if (r.verdict === "CE") {
      // CE:不显示三栏,直接展示编译日志(输出框捕获;侦察实录 §5)
      p.meta.textContent = "";
      p.detail.classList.add("luogusp-ide-log");
      p.detail.appendChild(idePane("编译信息", String(r.output || "").split("\n"), null, "(无编译输出)"));
      return;
    }
    p.meta.textContent = r.detail || "";
    if (r.note) {
      const note = document.createElement("p");
      note.className = "luogusp-ide-note";
      note.textContent = r.note;
      p.detail.appendChild(note);
      p.detail.classList.add("luogusp-ide-log");
      if (r.output == null) return; // UKE 无产物,只留说明
      p.detail.classList.remove("luogusp-ide-log");
    }
    if (r.verdict === "RE" && r.detail) {
      const note = document.createElement("p");
      note.className = "luogusp-ide-note";
      note.textContent = r.detail; // RE 原因在 run-result 位置(侦察实录 §5)
      p.detail.appendChild(note);
      p.meta.textContent = "";
    }
    const expLines = normalizeIdeOut(sample[1]).split("\n");
    const actLines = normalizeIdeOut(r.output).split("\n");
    const bad = new Set();
    if (r.verdict !== "AC") {
      const m = Math.max(expLines.length, actLines.length);
      for (let k = 0; k < m; k++)
        if ((expLines[k] || "") !== (actLines[k] || "")) bad.add(k);
    }
    p.detail.append(
      idePane("输入", normalizeIdeOut(sample[0]).split("\n"), null, "(空)"),
      idePane("期望输出", expLines, bad, "(空)"),
      idePane("实际输出", actLines, bad, r.verdict === "AC" ? "(空)" : "(未产生输出)"),
    );
  }
```

- [ ] **Step 3: 汇总+自动展开+图例(替换占位 finishIdeSummary,mountIdeTabs 里 panel.innerHTML 尾部加图例容器)**

`mountIdeTabs` 中 panel.innerHTML 的 `'<div class="luogusp-ide-rows"></div>'` 后追加 `'<div class="luogusp-ide-legend"></div>'`,并在 `IDE_BATCH.rowsEl = …` 之后加:

```js
    panel.querySelector(".luogusp-ide-legend").innerHTML =
      "图例:" +
      IDE_LEGEND.map(
        ([t, bg, bd, fg]) =>
          `<span class="luogusp-ide-pill" style="background-color:${bg};border-color:${bd};color:${fg};">${t}</span>`,
      ).join("") +
      '<span style="margin-left:4px;">行内颜色实时取自洛谷原生结果</span>';
```

新增常量与完整汇总:

```js
  // 实测原生内联配色(侦察实录 §5);MLE/OLE/UKE 未实测,行内以运行时复制为准
  const IDE_LEGEND = [
    ["AC", "rgb(83,196,26)", "rgb(80,161,39)", "#fff"],
    ["WA", "rgb(231,77,60)", "rgb(208,69,53)", "#fff"],
    ["TLE", "rgb(5,34,66)", "rgb(10,31,54)", "#fff"],
    ["RE", "rgb(156,61,207)", "rgb(138,62,179)", "#fff"],
    ["CE", "rgb(250,219,20)", "rgb(215,190,28)", "#614700"],
    ["UKE", "#3d3d3d", "#333", "#fff"],
  ];
  function finishIdeSummary() {
    if (!IDE_BATCH.summaryEl || !IDE_BATCH.results) return;
    const rs = IDE_BATCH.results;
    const counts = {};
    let ac = 0, tested = 0;
    rs.forEach((r) => {
      if (!r) return;
      tested++;
      if (r.verdict === "AC") ac++;
      else counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    });
    let text = `${ac}/${rs.length} 通过`;
    for (const k in counts) text += ` · ${counts[k]} ${k}`;
    if (tested < rs.length) {
      text += " · 已停止";
      rs.forEach((r, i) => {
        if (r) return;
        const p = ideRowParts(i);
        if (p) p.pill.textContent = "未测";
      });
    }
    IDE_BATCH.summaryEl.textContent = text;
    const firstBad = rs.findIndex((r) => r && r.verdict !== "AC");
    if (firstBad !== -1) expandIdeRow(firstBad);
    else if (IDE_BATCH.rowsEl)
      IDE_BATCH.rowsEl.querySelectorAll(".luogusp-ide-row.open").forEach((r) => r.classList.remove("open"));
  }
```

- [ ] **Step 4: 过期标注与手点防护**

```js
  function markIdeStale() {
    if (IDE_BATCH.stale || IDE_BATCH.running || !IDE_BATCH.results) return;
    IDE_BATCH.stale = true;
    if (IDE_BATCH.summaryEl && document.contains(IDE_BATCH.summaryEl))
      IDE_BATCH.summaryEl.textContent += " · 结果可能已过期,建议重新测试";
  }
  function hookIdeStaleAndGuard() {
    // 代码变更 → 过期标注(CM6 是 contenteditable,input/keydown 均会冒泡)
    const stale = (e) => {
      if (e.target && e.target.closest && e.target.closest(SELECTORS.cmContent)) markIdeStale();
    };
    document.addEventListener("input", stale, true);
    document.addEventListener("keydown", stale, true);
    // 批测中拦掉用户手点原生 运行/自测(程序化点击带 driving 标记放行)
    document.addEventListener(
      "click",
      (e) => {
        if (!IDE_BATCH.running || IDE_BATCH.driving) return;
        const t =
          e.target &&
          e.target.closest &&
          e.target.closest(`${SELECTORS.ideSampleBlock} a, ${SELECTORS.ideToolbar} a.run`);
        if (t) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
  }
```

`watchIdeBatch()` 中 `installIdeSubmitObserver();` 后加 `hookIdeStaleAndGuard();`。

- [ ] **Step 5: 语法验证**

Run: `node --check LuoguSP.user.js`
Expected: exit 0

- [ ] **Step 6: 真机注入验证(核心流程)**

P1001 IDE 模式注入后点「一键测试样例」:自动切「样例测试」tab;样例 #1 行出现 运行中→AC(绿胶囊,时间/内存);展开三栏内容正确;「自定义测试」tab 可切回且原生输入框内容未变。

- [ ] **Step 7: Commit**

```bash
git add LuoguSP.user.js
git commit -m "IDE 一键测试样例:结果渲染、diff 高亮、图例与过期标注"
```

---

### Task 5: 真机全场景验证与修复

**Files:**
- Modify: `LuoguSP.user.js`(按验证发现修复)

**Interfaces:** 无新增;本 Task 是验证-修复循环。

- [ ] **Step 1: 多样例题验证**

选一道 ≥2 组样例的题(如 P1093 或题库任意多样例题)进入 IDE 模式注入验证:逐组顺序运行、手风琴跟随、结束停在首个未通过组(或全过全折叠)、汇总计数正确。

- [ ] **Step 2: 异常路径验证**

在 IDE 里临时改代码触发并逐一确认:WA(diff 红行)、CE(黄胶囊+编译日志、后续组连带 CE、批次终止)、TLE(深藏青胶囊、实际输出「未产生输出」)、RE(紫胶囊+原因文本)。验证后恢复原代码。

- [ ] **Step 3: 边界验证**

- 无样例题(如提交答案题 UVA 或交互题):按钮点击提示「本题无样例」。
- 代码为空:提示「代码为空」。
- 批测中:「一键测试样例」与原生「自测」禁用、手点样例「运行」被拦、「停止」生效且剩余组保持「等待」。
- 自定义输入:批测前在输入框填内容,批测后内容还原且「自定义测试」tab 下原生自测仍可用。
- 修改代码后:汇总条出现「结果可能已过期」。

- [ ] **Step 4: SPA 路由验证**

进出 IDE 模式×2、题目 A→B 切换后再进 IDE:按钮/tab 不重复、面板状态不残留、无控制台报错。

- [ ] **Step 5: 存量功能回归**

题号着色、设置面板打开/开关本功能并刷新生效,无报错。

- [ ] **Step 6: 修复提交**

发现的问题逐个修复,每类修复一个 commit:

```bash
git add LuoguSP.user.js
git commit -m "IDE 一键测试样例:真机验证修复(<问题简述>)"
```

---

### Task 6: 版本号与文档同步

**Files:**
- Modify: `LuoguSP.user.js:4`(@version 2.8.5 → 2.9.0)
- Modify: `README.md`(版本徽记 2.8.2 → 2.9.0;功能列表补一条)
- Modify: `AGENTS.md`(如真机验证沉淀出新约束则补充「验证重点」)

- [ ] **Step 1: @version 升 2.9.0**

```
// @version      2.9.0
```

- [ ] **Step 2: README 徽记与功能条目**

徽记行改为 `[![Version: 2.9.0](https://img.shields.io/badge/version-2.9.0-2f80ed.svg?style=flat-square)](LuoguSP.user.js)`;「功能」列表追加:

```markdown
- IDE 一键测试样例:题目页 IDE 模式下一键逐组运行全部输入输出样例,TAB 化面板展示各组 AC/WA/CE/TLE/RE 状态、时间内存与逐行 diff。
```

- [ ] **Step 3: 语法验证**

Run: `node --check LuoguSP.user.js`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add LuoguSP.user.js README.md AGENTS.md
git commit -m "更新版本号至 2.9.0,同步 README 功能列表"
```
