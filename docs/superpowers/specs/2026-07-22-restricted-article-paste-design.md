# LuoguSP 设计文档:受限文章/剪贴板就地显示

- 日期:2026-07-22
- 状态:已获 owner 审核通过(数据源/互动区/触发边界三项均已拍板)
- 分支:`feature/restricted-article-paste`

## 1. 目标

洛谷国内站(www.luogu.com.cn)访问非本人/未审核的专栏文章(`/article/<id>`)与云剪贴板(`/paste/<id>`)时会落在「安全访问中心」拦截页,要求跳转国际站。本功能在拦截页**就地接管整页**,以 1:1 仿国际站的原生观感渲染内容,数据来自洛谷保存站(luogu.me)公开 API。

## 2. 实测事实(2026-07-22 登录态侦察)

- `.cn` 同源数据源已死:paste 路由对任何请求(含 `x-lentille-request` 头)返回拦截页 HTML;article 路由返回 403 AccessDenied JSON。
- 官方国际站 www.luogu.com 无 CORS,`@grant none` 下不可用;文章匿名不可读时(未公开/未过审)会跳 SSO 登录页。
- 保存站 API `https://api.luogu.me`:**CORS 全开、匿名可用**;拦截页 CSP 放行其 fetch(已实测)。
  - `GET /article/query/{id}` → `{code,message,data:{id,title,content,renderedContent,authorId,category,upvote,favorCount,tags,createdAt,updatedAt,viewCount,summary,contentHash,commentsFetchedAt,author:{id,name,color,ccfLevel,xcpcLevel,…}}}`;未收录 `code:404`。
  - `GET /paste/query/{id}` → `data:{id,content,renderedContent,authorId,author,createdAt,updatedAt,contentHash,…}`。
  - `GET /article/comments/{id}` → `data:{comments:[{id,content,time(unix 秒),author:{id,name,color,ccfLevel,xcpcLevel}}],commentsStale,commentsFetchedAt}`。
  - 保存站页面的「立即保存」可匿名创建保存工作流,公开内容秒级入库(实测 paste w73o7p95 成功);未公开内容爬虫 403,永远收不了。
  - 工作流创建的 POST 端点/载荷待实现期从保存站前端抓取一次(补侦察任务)。
- 拦截页是**独立静态页**(非 SPA,无 lentille-context),标题「安全访问中心 - 洛谷」,正文含「即将离开洛谷」与指向 `www.luogu.com/<type>/<id>` 的「继续访问」链接。

## 3. 交互与渲染(定稿)

### 3.1 触发边界

- 仅当 URL 匹配 `/article/<id>` 或 `/paste/<id>` **且**页面为拦截页(标题+「继续访问」链接双锚点)时接管;能正常渲染的文章/剪贴板一律不碰(owner 明确要求)。
- 功能开关:`FEATURE_LABELS` 登记「受限文章/剪贴板就地显示」,关闭时完全不动拦截页。

### 3.2 数据流(每次访问都申请更新,owner 拍板)

1. 查询保存站;已收录 → **立即渲染存档**;同时若 `updatedAt` 距今 >10 分钟,后台发保存工作流,轮询(约 3s×10 次),`contentHash` 变化 → 就地重渲染正文并标注「已更新」。
2. 未收录(404)→ 发保存工作流 + 显示加载骨架,轮询至多 ~45s;成功 → 渲染;超时/失败 → 提示「未能收录(内容可能未公开或未过审)」+ 去国际站原文链接。
3. 文章页并行拉取评论,渲染只读评论区;提供「更新评论」按钮(发评论刷新工作流后轮询重渲染)。
4. 保存站不可达(网络错误)→ 拦截页保持原样 + 顶部插一条错误提示,不破坏原生跳转能力。

### 3.3 页面渲染(1:1 仿国际站)

- **文章页**:标题卡(标题、作者名[按洛谷名色 Gray/Blue/Green/Orange/Red/Purple/Cheater 映射]、发布时间、分类、标签)→ 正文卡 → 右侧 TOC(从渲染后 h1~h6 生成,锚点跳转;窄屏折叠)→ 底部互动条(点赞/收藏/不推荐图标保留,数字一律显示 `-`,置灰不可点,owner 拍板)→ 评论区(只读,头像+名色+相对时间)→ 页脚「内容来自洛谷保存站存档 · 查看国际站原文」。
- **剪贴板页**:信息卡(剪贴板 ID、作者、创建/更新时间)+ 正文卡 + 同款页脚。
- **Markdown 渲染**:一律用脚本现有 `renderMarkdown` 链路(marked+DOMPurify+KaTeX+hljs+复制按钮),不用保存站的 `renderedContent`(owner 指定与个人介绍一致)。
- 头像:`cdn.luogu.com.cn/upload/usericon/{uid}.png`。
- 分类映射(文章 category 整数 → 文案):实现期用已收录文章样本对照国际站页面实测钉死(bq5o089x=科技·工程 可作锚点),未知值显示「分类 #N」兜底。
- 加载骨架:仿原生的灰条占位卡。

## 4. 组件划分

| 单元 | 职责 |
| --- | --- |
| `restrictedPageInfo()` | 判定当前页是否拦截页,解析 `{type:'article'|'paste', id}` |
| `saverApi` | query/comments/工作流创建与轮询的薄封装(fetch,匿名) |
| `renderRestrictedArticle/Paste` | 整页 DOM 重写与 1:1 布局构建(复用 renderMarkdown/highlight/copy 基建) |
| `saverRefresh` | 「每访问必更新」调度:新鲜度判断、工作流触发、轮询、就地重渲染 |
| `watchRestrictedPage` | FEATURES 启动器:开关判断+一次性接管(拦截页为静态页,无需持续观察) |

## 5. 工程约束

- `@grant none`、`@match` 不变;新增外联域仅 `api.luogu.me`。
- **AGENTS.md「仅请求洛谷同源」铁律修订**:放开显式例外 `api.luogu.me`(洛谷保存站,第三方存档服务);README 向用户声明此依赖及数据来源标注。
- 新选择器(拦截页锚点)进 `SELECTORS`;异常走 `console.error("LuoguSP …")`。
- 版本:2.10.0。

## 6. 验证清单

1. 已收录公开剪贴板(w73o7p95):秒渲染 + 后台更新流。
2. 新建未收录公开对象:保存→轮询→渲染全流程。
3. 未公开文章(8ue6cccv):失败提示 + 国际站链接。
4. 可正常访问的文章/剪贴板:不接管、零副作用。
5. 功能开关关闭:拦截页原样;其余功能回归(node --check + 真机)。

## 7. 非目标

- 不做发表评论/真实点赞收藏(纯保存站方案不可能);数字一律 `-`。
- 不做个人主页补显增强(已有 showIntro 功能,另议)。
- 不引入 GM_* 权限或官方国际站通道。
