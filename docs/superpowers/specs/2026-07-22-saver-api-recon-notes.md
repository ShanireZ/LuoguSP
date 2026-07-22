# 保存站 API 与拦截页侦察实录(2026-07-22)

实现「受限文章/剪贴板就地显示」的事实来源;与设计文档冲突处以本文为准。

## 1. 保存站 API(https://api.luogu.me,CORS 全开、匿名)

统一响应壳:`{code, message, data}`;`code` 为业务码(404=未收录,HTTP 恒 200)。

| 用途 | 端点 | 说明 |
| --- | --- | --- |
| 查文章 | `GET /article/query/{id}` | data:{id,title,content,renderedContent,authorId,category,upvote,favorCount,tags,createdAt,updatedAt,viewCount,summary,contentHash,commentsFetchedAt,author:{id,name,color,ccfLevel,xcpcLevel,…}} |
| 查剪贴板 | `GET /paste/query/{id}` | data:{id,content,renderedContent,authorId,author,createdAt,updatedAt,contentHash,deleted,…} |
| 查评论 | `GET /article/comments/{id}` | data:{comments:[{id,content,time(unix 秒),author:{id,name,color,ccfLevel,xcpcLevel}}],commentsStale,commentsFetchedAt} |
| 保存/更新文章 | `POST /workflow/create/template/article-save-pipeline`,JSON `{targetId}` | 匿名可用;返回 data:{workflowId,taskIds:{save,save-comment,summary,censor,…}}(管线自带评论刷新) |
| 保存/更新剪贴板 | `POST /workflow/create/template/paste-save-pipeline`,JSON `{targetId}` | 返回 data:{workflowId,taskIds:{save,censor,update-censor}} |
| 只刷评论 | `POST /article/comments/{id}/refresh`(无 body) | 返回 data:{taskId} |
| 轮询工作流 | `GET /workflow/query/{workflowId}` | data:{workflowId,status:'active'/…,createdAt,updatedAt,tasks:[{taskId,taskName,status,…}],result} |

- 公开内容保存实测秒级完成(paste w73o7p95);**未公开/未过审内容爬虫 403,永收不了**(article 8ue6cccv),表现为工作流失败/查询持续 404。
- 请求头仅需 `content-type: application/json`(POST);无 CSRF/token。

## 2. .cn 安全访问中心拦截页(接管目标)

- 触发:访问非本人/未审核 `/paste/<id>`、`/article/<id>`(对任意请求头都回此页/403,同源数据线死透)。
- 独立静态页,**无 SPA、无 lentille-context、无任何外链样式表**(仅 2 个内联 style)→ 接管页必须自带全部样式(含 markdown 排版样式集)。
- DOM:`body > div > div.card > [p>img(logo), h3(即将离开洛谷), p(提示文案), pre#url(目标 www.luogu.com/<type>/<id> 链接文本), p>a, button#go(继续访问)]`,标题「安全访问中心 - 洛谷」。
- 锚点建议:`pre#url` 存在 + 标题匹配;类型/ID 从 location.pathname 解析并与 `pre#url` 文本交叉验证。

## 3. 国际站文章页骨架(1:1 参照,www.luogu.com/article/*)

```
body > .lfe-body
├─ .top-bar(logo+breadcrumb / user-nav)
├─ nav.sidebar(略,不复刻)
└─ .main-container > main
   ├─ .article-banner.columba-content-wrap.wrapper > .banner-content
   │  ├─ h1.title
   │  └─ .meta > .author(img.avatar + .user) + .metas(发布时间 / 分类)
   ├─ div(正文区)
   │  └─ .article-content.columba-content-wrap.wrapper
   │     ├─ .lfe-marked-wrap > .lfe-marked(渲染后 markdown)
   │     ├─ .update-info.lfe-caption(作者：xxx + time)
   │     └─ .actions.left-mode(.button-2line ×3 = 点赞/收藏/不推荐,svg+span.text)
   └─ .article-comment.columba-content-wrap.wrapper
      ├─ h3.lfe-h3.section-title(评论区)
      ├─ 发表评论卡(l-card + textarea + 登录按钮)
      ├─ .comment-filter-line(N 条评论 + 排序 combo)
      └─ .list > .list-scroll > .list-wrap > .row-wrap > .row(评论条目)
```

- 右侧 TOC 由前端生成(hasDrawer);我们以简化右浮目录卡实现,窄屏隐藏。
- 剪贴板页国际站无独立复杂布局,信息卡+正文卡即可。

## 4. 其他

- 头像:`https://cdn.luogu.com.cn/upload/usericon/{uid}.png`(同源 CDN)。
- 名色映射(洛谷用户色):Gray #bfbfbf / Blue #0e90d2 / Green #52c41a / Orange #f39c11 / Red #fe4c61 / Purple #9d3dcf;未知色兜底 Gray。
- 文章分类枚举:实现期以样本对照钉死(bq5o089x=科技·工程);未知值显示「分类 #N」。
