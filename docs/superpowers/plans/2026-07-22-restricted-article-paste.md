# 受限文章/剪贴板就地显示 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 国内站 `/article|/paste` 的「安全访问中心」拦截页就地接管,以 1:1 仿国际站布局渲染保存站存档内容(每访问必申请更新,只读互动区,文章带评论)。

**Architecture:** [LuoguSP.user.js](../../LuoguSP.user.js) 新增一个功能区段:拦截页检测(`pre#url`+标题双锚点)→ 保存站 API(api.luogu.me,CORS 开、匿名)取数 → 整页 DOM 重写(自带样式集,markdown 走现有 `renderMarkdown` 链路)→ 未收录发保存工作流轮询、已收录后台保鲜。事实来源:[设计文档](../specs/2026-07-22-restricted-article-paste-design.md)、[保存站侦察实录](../specs/2026-07-22-saver-api-recon-notes.md)。

**Tech Stack:** 原生 DOM/fetch;复用 renderMarkdown/highlightCodeBlocks/enhanceCodeBlocks/makeCopyButton/injectStyle 基建;无新依赖、@grant none 不变。

## Global Constraints

- 新功能登记 `FEATURE_LABELS` + `FEATURES`;新选择器进 `SELECTORS`(AGENTS.md 铁律)。
- 仅新增外联域 `api.luogu.me`;**能正常渲染的文章/剪贴板一律不接管**(锚点不匹配即退出)。
- 互动数一律显示 `-` 且不可点;评论只读。
- 语法验证:`node --check LuoguSP.user.js`;真机验证按注入法。
- 每 Task 一提交,commit message 中文。

---

### Task 1: 登记、检测与保存站 API 封装

**Files:**
- Modify: `LuoguSP.user.js`(SELECTORS/FEATURE_LABELS/新区段骨架/FEATURES)

**Interfaces:**
- Produces: `SELECTORS.restrictedUrlPre/.restrictedGoButton`;`restrictedPageInfo() → {type:'article'|'paste',id,origUrl}|null`;`saverGet(path)`/`saverPost(path,body) → Promise<{code,message,data}>`;`watchRestrictedPage()`(启动器);`rstRun()`(本 Task 打日志占位,Task 3 实装)。

- [ ] **Step 1: SELECTORS 增补**(`lentilleContext` 行后)

```js
    restrictedUrlPre: "pre#url", // 安全访问中心拦截页里的目标链接文本
    restrictedGoButton: "button#go", // 拦截页「继续访问」按钮
```

- [ ] **Step 2: FEATURE_LABELS 登记**(`ideBatchSampleTest` 行后)

```js
    [`${STORAGE_PREFIX}showRestrictedContent`, "受限文章/剪贴板就地显示"],
```

- [ ] **Step 3: 新区段骨架**(插在「IDE 一键测试样例」区段之后、「启动」区段之前)

```js
  // ============================================================
  // 受限文章/剪贴板就地显示
  // 国内站访问非本人/未审核的 /article、/paste 会落在「安全访问中心」拦截页
  // （独立静态页、零全站样式）。本功能就地接管整页，数据来自洛谷保存站
  // （api.luogu.me，CORS 开放、匿名），markdown 走脚本自有渲染链路。
  // 事实来源：docs/superpowers/specs/2026-07-22-saver-api-recon-notes.md
  // ============================================================
  const SAVER_API = "https://api.luogu.me";
  async function saverGet(path) {
    const res = await fetch(SAVER_API + path);
    return res.json(); // 统一壳 {code,message,data}；业务码 404=未收录
  }
  async function saverPost(path, body) {
    const res = await fetch(SAVER_API + path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  // 拦截页判定：URL 形态 + 标题 + pre#url 内容三重锚点；不满足=正常页面，绝不接管
  function restrictedPageInfo() {
    const m = location.pathname.match(/^\/(article|paste)\/([A-Za-z0-9]+)\/?$/);
    if (!m) return null;
    if (document.title.indexOf("安全访问中心") === -1) return null;
    const pre = document.querySelector(SELECTORS.restrictedUrlPre);
    const target = pre ? (pre.textContent || "").trim() : "";
    if (target.indexOf(`/${m[1]}/${m[2]}`) === -1) return null;
    return {
      type: m[1],
      id: m[2],
      origUrl: target || `https://www.luogu.com/${m[1]}/${m[2]}`,
    };
  }

  async function rstRun() {
    const info = restrictedPageInfo();
    if (!info) return;
    console.log("LuoguSP restricted: TODO(Task 3)", info);
  }

  function watchRestrictedPage() {
    // 拦截页是独立静态页，无 SPA，一次性执行即可
    rstRun().catch((e) => console.error("LuoguSP restricted:", e));
  }
```

- [ ] **Step 4: FEATURES 注册**(`ideBatchSampleTest` 条目后)

```js
    { key: `${STORAGE_PREFIX}showRestrictedContent`, run: watchRestrictedPage },
```

- [ ] **Step 5: 验证与提交**

Run: `node --check LuoguSP.user.js` → exit 0。真机:注入后在 `.cn/paste/w73o7p95` 控制台见 `LuoguSP restricted: TODO(Task 3) {type:'paste',…}`;在正常题目页无输出。

```bash
git add LuoguSP.user.js && git commit -m "受限内容就地显示：登记、拦截页检测与保存站 API 封装"
```

---

### Task 2: 接管渲染(样式集+文章/剪贴板页面构建)

**Files:**
- Modify: `LuoguSP.user.js`(同区段追加)

**Interfaces:**
- Consumes: Task 1 全部;既有 `renderMarkdown/highlightCodeBlocks/enhanceCodeBlocks`。
- Produces: `injectRstStyle()`;`rstUserColor(color)`;`rstCategoryText(c)`;`rstFmtTime(iso|unixSec)`;`rstBuildPage(info,data) → void`(整页重写);`rstSetStatus(text)`;`rstRenderMd(container,md)`;`rstBuildFailure(info,reason)`;`rstBuildLoading(info)`。

- [ ] **Step 1: 样式注入函数**

```js
  function injectRstStyle() {
    if (document.getElementById("luogusp-rst-style")) return;
    const style = document.createElement("style");
    style.id = "luogusp-rst-style";
    style.textContent = `
			body.luogusp-rst{margin:0;background:#f4f5f8;color:#333;font:14px/1.7 "Helvetica Neue",Helvetica,"PingFang SC","Microsoft YaHei",Arial,sans-serif;}
			.luogusp-rst a{color:#0e90d2;text-decoration:none;}
			.luogusp-rst-topbar{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:0 24px;height:50px;display:flex;align-items:center;gap:12px;}
			.luogusp-rst-topbar .crumb{color:#999;}
			.luogusp-rst-topbar .right{margin-left:auto;font-size:13px;}
			.luogusp-rst-wrap{max-width:820px;margin:0 auto;padding:24px 16px 60px;}
			.luogusp-rst-banner h1{margin:0 0 12px;font-size:26px;font-weight:600;color:#222;}
			.luogusp-rst-meta{display:flex;align-items:center;gap:18px;flex-wrap:wrap;color:#999;font-size:13px;margin-bottom:18px;}
			.luogusp-rst-meta .who{display:flex;align-items:center;gap:8px;}
			.luogusp-rst-meta img{width:28px;height:28px;border-radius:50%;}
			.luogusp-rst-meta .uname{font-weight:600;}
			.luogusp-rst-tag{display:inline-block;background:#eef7fd;color:#0e90d2;border-radius:3px;padding:0 8px;margin-right:6px;font-size:12px;}
			.luogusp-rst-card{background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:24px 28px;margin-bottom:16px;overflow-wrap:break-word;}
			.luogusp-rst-md h1,.luogusp-rst-md h2{border-bottom:1px solid #eee;padding-bottom:.3em;margin:1.2em 0 .7em;font-weight:600;}
			.luogusp-rst-md h1{font-size:1.6em;}.luogusp-rst-md h2{font-size:1.35em;}
			.luogusp-rst-md h3{font-size:1.15em;margin:1em 0 .5em;}
			.luogusp-rst-md p{margin:.6em 0;}
			.luogusp-rst-md blockquote{margin:.8em 0;padding:2px 12px;border-left:4px solid #dfe2e5;color:#666;background:#fafbfc;}
			.luogusp-rst-md table{border-collapse:collapse;margin:.8em 0;}
			.luogusp-rst-md th,.luogusp-rst-md td{border:1px solid #dfe2e5;padding:4px 12px;}
			.luogusp-rst-md code{background:#f2f3f5;border-radius:3px;padding:.1em .35em;font-family:"Fira Code","Fira Mono",Menlo,Consolas,monospace;font-size:.92em;}
			.luogusp-rst-md pre code{background:transparent;padding:0;}
			.luogusp-rst-md img{max-width:100%;}
			.luogusp-rst-caption{color:#999;font-size:12px;margin:6px 2px 14px;display:flex;gap:16px;}
			.luogusp-rst-actions{display:flex;gap:26px;padding:6px 2px 2px;color:#bbb;}
			.luogusp-rst-actions .act{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:12px;cursor:not-allowed;}
			.luogusp-rst-actions svg{width:22px;height:22px;fill:currentColor;}
			.luogusp-rst-toc{position:fixed;top:80px;right:calc(50% - 410px - 260px);width:220px;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:12px 0;font-size:13px;max-height:70vh;overflow:auto;}
			@media (max-width:1350px){.luogusp-rst-toc{display:none;}}
			.luogusp-rst-toc a{display:block;padding:3px 16px;color:#555;border-left:2px solid transparent;}
			.luogusp-rst-toc a:hover{color:#0e90d2;}
			.luogusp-rst-toc a[data-lv="2"]{padding-left:30px;}
			.luogusp-rst-toc a[data-lv="3"]{padding-left:44px;}
			.luogusp-rst-status{font-size:12px;color:#999;margin:0 0 10px;}
			.luogusp-rst-status.ok{color:#52c41a;}
			.luogusp-rst-comment-row{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid #f0f0f0;}
			.luogusp-rst-comment-row img{width:36px;height:36px;border-radius:50%;}
			.luogusp-rst-comment-row .chead{font-size:13px;color:#999;display:flex;gap:10px;align-items:baseline;}
			.luogusp-rst-comment-row .cbody{margin-top:2px;}
			.luogusp-rst-comment-row .cbody p{margin:.2em 0;}
			.luogusp-rst-note{color:#999;font-size:12px;text-align:center;margin-top:28px;}
			.luogusp-rst-skel{height:16px;border-radius:3px;background:linear-gradient(90deg,#eee 25%,#f6f6f6 50%,#eee 75%);background-size:200% 100%;animation:luogusp-rst-sh 1.2s infinite;margin:12px 0;}
			@keyframes luogusp-rst-sh{to{background-position:-200% 0;}}
		`;
    (document.head || document.documentElement).appendChild(style);
  }
```

- [ ] **Step 2: 小工具(名色/分类/时间/状态行/markdown 渲染)**

```js
  // 洛谷用户名色（未知色兜底灰）
  const RST_COLORS = {
    Gray: "#bfbfbf", Blue: "#0e90d2", Green: "#52c41a",
    Orange: "#f39c11", Red: "#fe4c61", Purple: "#9d3dcf", Cheater: "#ad8b00",
  };
  const rstUserColor = (c) => RST_COLORS[c] || RST_COLORS.Gray;
  // 分类枚举：以已收录样本对照国际站实测钉死；未验证值显示「分类 #N」
  const RST_CATEGORIES = { 1: "个人记录", 2: "题解", 3: "科技·工程" };
  const rstCategoryText = (c) => RST_CATEGORIES[c] || `分类 #${c}`;
  function rstFmtTime(v) {
    const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function rstSetStatus(text, ok) {
    const el = document.querySelector(".luogusp-rst-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
  }
  // markdown → 容器（renderMarkdown 已消毒；套 luogusp-intro-card 继承代码块/hljs/复制按钮样式）
  function rstRenderMd(container, md) {
    container.innerHTML = renderMarkdown(String(md || ""));
    highlightCodeBlocks(container);
    enhanceCodeBlocks(container);
  }
  function rstAvatar(uid) {
    return `https://cdn.luogu.com.cn/upload/usericon/${uid}.png`;
  }
```

- [ ] **Step 3: 页面骨架构建(接管/加载/失败三态)**

```js
  const RST_ICONS = {
    up: "M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66-.23-.45-.52-.86-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84C7 18.95 8.05 20 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z",
    star: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
    down: "M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.45.52.86.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34C17 5.05 15.95 4 14.66 4H6.56c-.71 0-1.36.37-1.73.97l-2.66 6.15z",
  };
  function rstShell(info, bodyHtml) {
    document.title =
      (info.type === "article" ? "文章" : "云剪贴板") + " - 洛谷";
    document.documentElement.scrollTop = 0;
    document.body.className = "luogusp-rst";
    document.body.innerHTML = `
			<div class="luogusp-rst-topbar">
				<a href="/">洛谷</a><span class="crumb">/</span>
				<span>${info.type === "article" ? "专栏" : "云剪贴板"}</span>
				<span class="right"><a href="${info.origUrl}" rel="noopener noreferrer">国际站原文</a></span>
			</div>
			<div class="luogusp-rst-wrap">${bodyHtml}</div>`;
  }
  function rstBuildLoading(info) {
    rstShell(
      info,
      `<div class="luogusp-rst-card"><p class="luogusp-rst-status">该内容尚未被保存站收录，已自动发起收录，请稍候…</p>
			<div class="luogusp-rst-skel" style="width:60%"></div><div class="luogusp-rst-skel"></div>
			<div class="luogusp-rst-skel"></div><div class="luogusp-rst-skel" style="width:80%"></div></div>`,
    );
  }
  function rstBuildFailure(info, reason) {
    rstShell(
      info,
      `<div class="luogusp-rst-card"><h1 style="font-size:20px;margin:0 0 10px;">未能获取内容</h1>
			<p>${reason}</p>
			<p>可能原因：内容未公开、未通过审核，或保存站暂时不可用。</p>
			<p><a href="${info.origUrl}" rel="noopener noreferrer">前往国际站查看原文 →</a></p>
			<p class="luogusp-rst-note">此页面由 LuoguSP 生成 · 数据来源：洛谷保存站</p></div>`,
    );
  }
  function rstActionsHtml(isArticle) {
    if (!isArticle) return "";
    return `<div class="luogusp-rst-actions">
			<span class="act" title="点赞（仅国际站可用）"><svg viewBox="0 0 24 24"><path d="${RST_ICONS.up}"/></svg>-</span>
			<span class="act" title="收藏（仅国际站可用）"><svg viewBox="0 0 24 24"><path d="${RST_ICONS.star}"/></svg>-</span>
			<span class="act" title="不推荐（仅国际站可用）"><svg viewBox="0 0 24 24"><path d="${RST_ICONS.down}"/></svg>-</span>
		</div>`;
  }
  function rstBuildPage(info, data) {
    const isArticle = info.type === "article";
    const author = data.author || {};
    const metaBits = [];
    if (data.createdAt) metaBits.push(`发布于 ${rstFmtTime(data.createdAt)}`);
    if (isArticle && data.category != null)
      metaBits.push(rstCategoryText(data.category));
    rstShell(
      info,
      `<div class="luogusp-rst-banner">
				<h1></h1>
				<div class="luogusp-rst-meta">
					<span class="who"><img alt=""><span class="uname"></span></span>
					${metaBits.map((b) => `<span>${b}</span>`).join("")}
					<span class="tags"></span>
				</div>
			</div>
			<p class="luogusp-rst-status"></p>
			<div class="luogusp-rst-card luogusp-intro-card">
				<div class="luogusp-rst-md lfe-marked"></div>
				<div class="luogusp-rst-caption">
					<span>存档更新于 ${rstFmtTime(data.updatedAt)}</span>
					<span><a class="luogusp-rst-refresh" href="javascript:void 0">申请更新</a></span>
				</div>
				${rstActionsHtml(isArticle)}
			</div>
			${isArticle ? '<div class="luogusp-rst-card luogusp-rst-comments"><h3 style="margin:0 0 6px;">评论区 <a class="luogusp-rst-crefresh" style="font-size:12px;font-weight:400;" href="javascript:void 0">更新评论</a></h3><div class="luogusp-rst-clist"><p class="luogusp-rst-note">评论加载中…</p></div></div>' : ""}
			<p class="luogusp-rst-note">内容来自洛谷保存站存档，互动功能仅国际站可用 · <a href="${info.origUrl}" rel="noopener noreferrer">查看国际站原文</a></p>`,
    );
    // 文本一律走 textContent，杜绝二次注入
    document.querySelector(".luogusp-rst-banner h1").textContent = isArticle
      ? data.title || "(无标题)"
      : `云剪贴板 ${data.id}`;
    const img = document.querySelector(".luogusp-rst-meta img");
    img.src = rstAvatar(data.authorId || (author.id || 0));
    const uname = document.querySelector(".luogusp-rst-meta .uname");
    uname.textContent = author.name || `用户 ${data.authorId || "?"}`;
    uname.style.color = rstUserColor(author.color);
    const tagWrap = document.querySelector(".luogusp-rst-meta .tags");
    (isArticle && Array.isArray(data.tags) ? data.tags : []).forEach((t) => {
      const s = document.createElement("span");
      s.className = "luogusp-rst-tag";
      s.textContent = t;
      tagWrap.appendChild(s);
    });
    rstRenderMd(document.querySelector(".luogusp-rst-md"), data.content);
    if (isArticle) rstBuildToc();
    const refresh = document.querySelector(".luogusp-rst-refresh");
    if (refresh)
      refresh.addEventListener("click", () => rstManualRefresh(info));
  }
  function rstBuildToc() {
    const md = document.querySelector(".luogusp-rst-md");
    const heads = [...md.querySelectorAll("h1, h2, h3")];
    if (heads.length < 2) return;
    const toc = document.createElement("div");
    toc.className = "luogusp-rst-toc";
    heads.forEach((h, i) => {
      h.id = `luogusp-toc-${i}`;
      const a = document.createElement("a");
      a.dataset.lv = h.tagName[1];
      a.textContent = h.textContent;
      a.href = `#luogusp-toc-${i}`;
      toc.appendChild(a);
    });
    document.body.appendChild(toc);
  }
```

- [ ] **Step 4: 验证与提交**

`node --check` 过;真机注入后临时调用 `rstBuildPage({type:'paste',id:'w73o7p95',origUrl:'…'}, 查询到的 data)` 目视布局。

```bash
git add LuoguSP.user.js && git commit -m "受限内容就地显示：接管渲染（样式集+文章/剪贴板页面构建）"
```

---

### Task 3: 数据流(收录/保鲜/失败路径,替换占位 rstRun)

**Files:**
- Modify: `LuoguSP.user.js`(替换 Task 1 的 `rstRun` 占位;追加辅助)

**Interfaces:**
- Consumes: Task 1/2 全部;`sleep`(IDE 区段已定义)。
- Produces: `rstRun()` 完整实现;`rstQuery(info)`;`rstTriggerSave(info)`;`rstManualRefresh(info)`(Task 2 已引用);`rstApplyFresh(info,data)`。

- [ ] **Step 1: 数据流实现**

```js
  function rstQuery(info) {
    return saverGet(`/${info.type}/query/${info.id}`);
  }
  function rstTriggerSave(info) {
    return saverPost(`/workflow/create/template/${info.type}-save-pipeline`, {
      targetId: info.id,
    });
  }
  // 就地刷新正文（保滚动位置，不整页重建）
  function rstApplyFresh(info, data) {
    rstRenderMd(document.querySelector(".luogusp-rst-md"), data.content);
    document.querySelector(".luogusp-rst-toc")?.remove();
    if (info.type === "article") rstBuildToc();
    rstSetStatus(`已更新（存档时间 ${rstFmtTime(data.updatedAt)}）`, true);
  }
  async function rstPollFresh(info, oldHash, times, gapMs) {
    for (let i = 0; i < times; i++) {
      await sleep(gapMs);
      let q;
      try {
        q = await rstQuery(info);
      } catch (e) {
        continue; // 网络抖动，下轮再试
      }
      if (q && q.code === 200 && q.data && q.data.contentHash !== oldHash)
        return q.data;
    }
    return null;
  }
  async function rstManualRefresh(info) {
    rstSetStatus("正在申请保存站更新…");
    try {
      await rstTriggerSave(info);
      const cur = await rstQuery(info);
      const fresh = await rstPollFresh(
        info,
        cur && cur.data ? cur.data.contentHash : "",
        10,
        3000,
      );
      if (fresh) rstApplyFresh(info, fresh);
      else rstSetStatus("存档已是最新（或更新未完成）");
    } catch (e) {
      console.error("LuoguSP restricted refresh:", e);
      rstSetStatus("更新请求失败，请稍后再试");
    }
  }
  async function rstRun() {
    const info = restrictedPageInfo();
    if (!info) return;
    let q;
    try {
      q = await rstQuery(info);
    } catch (e) {
      // 保存站不可达：不动拦截页，仅置顶提示，保留原生跳转能力
      console.error("LuoguSP restricted:", e);
      const tip = document.createElement("p");
      tip.style.cssText =
        "margin:12px auto;max-width:640px;color:#e74c3c;font-size:13px;text-align:center;";
      tip.textContent =
        "LuoguSP：保存站(api.luogu.me)不可达，无法就地显示该内容。";
      document.body.insertBefore(tip, document.body.firstChild);
      return;
    }
    injectRstStyle();
    if (q && q.code === 200 && q.data) {
      rstBuildPage(info, q.data);
      if (info.type === "article") rstLoadComments(info);
      // 每访问必申请更新（owner 拍板）；存档很新鲜（<10 分钟）时跳过，减轻保存站压力
      const ageMs = Date.now() - Date.parse(q.data.updatedAt || 0);
      if (!(ageMs >= 0 && ageMs < 10 * 60 * 1000)) {
        try {
          await rstTriggerSave(info);
          rstSetStatus("已显示存档，正在后台检查更新…");
          const fresh = await rstPollFresh(info, q.data.contentHash, 8, 3000);
          if (fresh) rstApplyFresh(info, fresh);
          else rstSetStatus(`存档更新于 ${rstFmtTime(q.data.updatedAt)}，已是最新`);
        } catch (e) {
          console.error("LuoguSP restricted freshen:", e);
          rstSetStatus("后台更新请求失败（不影响当前存档显示）");
        }
      }
      return;
    }
    // 未收录：发起保存并等待入库
    rstBuildLoading(info);
    try {
      await rstTriggerSave(info);
    } catch (e) {
      console.error("LuoguSP restricted save:", e);
      return rstBuildFailure(info, "向保存站发起收录请求失败。");
    }
    for (let i = 0; i < 15; i++) {
      await sleep(3000);
      let poll;
      try {
        poll = await rstQuery(info);
      } catch (e) {
        continue;
      }
      if (poll && poll.code === 200 && poll.data) {
        rstBuildPage(info, poll.data);
        if (info.type === "article") rstLoadComments(info);
        rstSetStatus("已完成首次收录", true);
        return;
      }
    }
    rstBuildFailure(info, "保存站在限定时间内未能完成收录。");
  }
```

- [ ] **Step 2: 验证与提交**

`node --check` 过;真机:`.cn/paste/w73o7p95`(已收录)注入 → 秒渲染+状态行走「后台检查更新→已是最新」;`.cn/article/8ue6cccv`(未公开)→ 加载骨架→45s 后失败页。

```bash
git add LuoguSP.user.js && git commit -m "受限内容就地显示：数据流（收录等待/后台保鲜/失败路径）"
```

---

### Task 4: 只读评论区

**Files:**
- Modify: `LuoguSP.user.js`(同区段追加)

**Interfaces:**
- Consumes: Task 1~3;`renderMarkdown`。
- Produces: `rstLoadComments(info)`(Task 3 已引用);`rstRenderComments(list)`。

- [ ] **Step 1: 实现**

```js
  function rstRenderComments(comments) {
    const wrap = document.querySelector(".luogusp-rst-clist");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!comments || !comments.length) {
      wrap.innerHTML = '<p class="luogusp-rst-note">暂无评论存档</p>';
      return;
    }
    for (const c of comments) {
      const a = c.author || {};
      const row = document.createElement("div");
      row.className = "luogusp-rst-comment-row";
      const img = document.createElement("img");
      img.src = rstAvatar(a.id || 0);
      img.alt = "";
      const main = document.createElement("div");
      const head = document.createElement("div");
      head.className = "chead";
      const name = document.createElement("span");
      name.textContent = a.name || "?";
      name.style.color = rstUserColor(a.color);
      name.style.fontWeight = "600";
      const time = document.createElement("span");
      time.textContent = rstFmtTime(Number(c.time));
      head.append(name, time);
      const body = document.createElement("div");
      body.className = "cbody luogusp-intro-card";
      body.innerHTML = renderMarkdown(String(c.content || ""));
      main.append(head, body);
      row.append(img, main);
      wrap.appendChild(row);
    }
  }
  async function rstLoadComments(info) {
    const wrap = document.querySelector(".luogusp-rst-clist");
    if (!wrap) return;
    try {
      const q = await saverGet(`/article/comments/${info.id}`);
      rstRenderComments(q && q.data ? q.data.comments : null);
    } catch (e) {
      console.error("LuoguSP restricted comments:", e);
      wrap.innerHTML = '<p class="luogusp-rst-note">评论加载失败</p>';
    }
    const btn = document.querySelector(".luogusp-rst-crefresh");
    if (btn && !btn.__luoguspBound) {
      btn.__luoguspBound = true;
      btn.addEventListener("click", async () => {
        btn.textContent = "更新中…";
        try {
          await saverPost(`/article/comments/${info.id}/refresh`);
          await sleep(4000);
          const q = await saverGet(`/article/comments/${info.id}`);
          rstRenderComments(q && q.data ? q.data.comments : null);
          btn.textContent = "更新评论";
        } catch (e) {
          console.error("LuoguSP restricted comment refresh:", e);
          btn.textContent = "更新失败，点击重试";
        }
      });
    }
  }
```

- [ ] **Step 2: 验证与提交**

`node --check` 过;真机:找一篇已收录且有评论的受限文章验证列表与「更新评论」。

```bash
git add LuoguSP.user.js && git commit -m "受限内容就地显示：只读评论区与评论更新"
```

---

### Task 5: 真机全场景验证与修复

- [ ] 已收录公开剪贴板(w73o7p95):秒渲染、正文/作者/时间正确、保鲜流状态文案正确。
- [ ] 未收录公开对象(新建一个公开剪贴板):骨架→收录→渲染全流程。
- [ ] 未公开文章(8ue6cccv):骨架→超时→失败页(原文链接可用)。
- [ ] 可正常访问的文章/剪贴板 + 题目页:锚点不匹配,零接管、零报错。
- [ ] 设置面板关闭本功能:拦截页保持原样。
- [ ] 存量功能回归(题号着色/设置入口/IDE 一键测试)。
- [ ] 分类映射:用已收录样本比对国际站,钉死 RST_CATEGORIES 已知项。
- [ ] 修复逐类提交:`git commit -m "受限内容就地显示：真机验证修复（<问题>）"`

---

### Task 6: 版本与文档

**Files:** `LuoguSP.user.js:4-5`、`README.md`、`AGENTS.md`

- [ ] `@version` → 2.10.0;`@description` 追加「受限文章/剪贴板就地显示」。
- [ ] README:徽记 2.10.0;功能列表追加(说明数据来自洛谷保存站、互动仅国际站);「兼容性与维护」提及 api.luogu.me 依赖。
- [ ] AGENTS.md:「仅请求洛谷同源」修订为「同源为主;唯一显式例外 api.luogu.me(保存站)」;验证重点追加本功能。
- [ ] `node --check` 过后提交:`git commit -m "更新版本号至 2.10.0，登记保存站依赖与文档同步"`
