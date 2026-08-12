# Luogu Saver API 与文章交互数据调查

> 调查时间：2026-08-12（Asia/Shanghai）  
> 源码基线：`laikit-dev/luogu-saver` `master` 提交  
> [`898f230b31db6f817d9d0bbcfcc848505eca759c`](https://github.com/laikit-dev/luogu-saver/commit/898f230b31db6f817d9d0bbcfcc848505eca759c)

## 结论

1. `https://api.luogu.me` 就是 Luogu Saver 当前公开的后端 API，现有
   LuoguSP 使用的 `/article/query/:id`、`/paste/query/:id`、
   `/article/comments/:id` 都来自该仓库的 Koa 路由，不是另一套实时洛谷代理。
2. 保存站文章查询包含 `upvote` 和 `favorCount`，但它们是最近一次成功存档时
   写入数据库的公共计数快照，不是请求时的实时数据。
3. 保存站不保存、也不返回访问者的 `favored`、`voted`、`canReply`、`canEdit`。
   这四个字段不能由 `api.luogu.me` 构造，必须优先使用当前浏览器中同源洛谷文章
   上下文；获取不到时应按未知/不可交互降级，不应用 `false` 伪造状态。
4. 保存站评论是存档回退，不是实时评论：服务端从
   `https://www.luogu.com/article/{lid}/replies` 分页抓取，默认六小时过期。
   过期的 GET 会异步派发刷新，但本次响应仍返回旧评论列表。
5. 保存站没有云剪贴板评论、点赞、收藏模型或路由。剪贴板回退页应继续只读，
   不应渲染文章的交互按钮。

## API 数据形状

### `GET /article/query/:id`

路由读取保存站的 `Article` 数据库实体，服务端渲染 Markdown 后以
`{ code, message, data }` 包装返回。关键形状为：

```json
{
  "code": 200,
  "message": "Success",
  "data": {
    "id": "article-id",
    "title": "...",
    "content": "...",
    "authorId": 123,
    "category": 1,
    "upvote": 0,
    "favorCount": 0,
    "deleted": 0,
    "createdAt": "...",
    "updatedAt": "...",
    "commentsFetchedAt": "...",
    "author": { "id": 123, "name": "..." },
    "renderedContent": "..."
  }
}
```

一手证据：

- [article router，查询并返回实体](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/article.router.ts#L50-L62)
- [Article 实体的 `upvote` / `favorCount`](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/entities/article.ts#L43-L50)
- [当前前端定义的保存站 Article 响应字段](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/frontend/src/types/article.d.ts#L3-L25)
- [2026-08-12 实测样本响应](https://api.luogu.me/article/query/ci3c3mr1)

实测样本的 `data` 共有 `id/title/content/authorId/category/upvote/favorCount/...`
等字段，不存在 `favored`、`voted`、`canReply`、`canEdit`。

### `GET /paste/query/:id`

剪贴板查询同样返回保存站数据库实体：

```json
{
  "code": 200,
  "message": "Success",
  "data": {
    "id": "paste-id",
    "content": "...",
    "authorId": 123,
    "deleted": 0,
    "createdAt": "...",
    "updatedAt": "...",
    "author": { "id": 123, "name": "..." },
    "renderedContent": "..."
  }
}
```

该实体只有内容、作者、删除与时间等存档字段，没有任何交互字段或评论关系。

一手证据：

- [paste router](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/paste.router.ts#L9-L27)
- [Paste 数据库实体](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/entities/paste.ts#L21-L57)
- [前端 Paste 类型](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/frontend/src/types/paste.d.ts#L3-L13)
- [2026-08-12 实测样本响应](https://api.luogu.me/paste/query/40hfk7qm)

实测样本的 `data` 只有
`id/content/authorId/deleted/createdAt/updatedAt/deleteReason/contentHash/author/renderedContent`。

### `GET /article/comments/:id`

```json
{
  "code": 200,
  "message": "Success",
  "data": {
    "comments": [
      {
        "id": "123456",
        "content": "...",
        "time": 1700000000,
        "author": {
          "id": 123,
          "name": "...",
          "color": "...",
          "ccfLevel": 0,
          "xcpcLevel": 0
        }
      }
    ],
    "commentsStale": false,
    "commentsFetchedAt": "..."
  }
}
```

`commentsStale=true` 时，路由会后台派发一个评论刷新任务，然后立即返回当前数据库
中的列表。因此这个 GET 不保证返回刷新后的内容，并且在过期情况下存在
后台副作用。

一手证据：

- [评论查询、过期派发和响应映射](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/article.router.ts#L117-L154)
- [六小时 TTL 和 200 页上限](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/shared/comment.ts#L10-L16)
- [2026-08-12 实测样本：85 条评论，`commentsStale=false`](https://api.luogu.me/article/comments/ci3c3mr1)

## 数据从哪里来

### 文章和计数

`article-save-pipeline` 的抓取任务从
`https://www.luogu.com/article/{id}` 读取 `resp.data.article`，再将文章内容、
`upvote`、`favorCount` 写入保存站数据库。

洛谷源响应的类型其实包含外层 `favored`、`voted`、`canReply`、`canEdit`，
但保存任务只取 `resp.data.article`；随后的数据库实体和写入映射也都没有这些
个人状态/权限字段。

一手证据：

- [洛谷 `ArticleData` 源类型包含四个交互字段](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/types/luogu-api.d.ts#L626-L632)
- [存档任务只取 `resp.data.article`](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/workers/handlers/task/save/article.handler.ts#L16-L30)
- [存档写入映射只保留公共计数](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/services/article.service.ts#L328-L345)

抓取工具可选接受 Cookie，但文章、剪贴板和评论 handler 调用时都没有传第三个
Cookie 参数。这些任务是保存站服务器的匿名抓取，不具有 LuoguSP 访问者的洛谷
会话；网络失败或 429 时还可以由保存站服务器改用 Tor。

- [抓取工具的可选 Cookie 与 Tor 回退](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/utils/fetch.ts#L146-L210)

### 评论

`save:comments` 任务按 `after={lastCommentId}` 从
`https://www.luogu.com/article/{lid}/replies?sort=&after=...` 抓取 `replySlice`，
去重后用一个事务整体替换已存评论并更新 `commentsFetchedAt`。

- [洛谷评论分页抓取与存档](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/workers/handlers/task/save/comments.handler.ts#L43-L100)
- [评论的整体替换事务](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/services/comment.service.ts#L35-L67)

### 剪贴板

`paste-save-pipeline` 从 `https://www.luogu.com/paste/{id}` 读取
`resp.currentData.paste`，只保存剪贴板 ID、内容和作者，没有评论抓取分支。

- [剪贴板抓取 handler](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/workers/handlers/task/save/paste.handler.ts#L16-L30)
- [剪贴板存储映射](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/services/paste.service.ts#L45-L76)

## Refresh API 语义

### 文章/剪贴板收录与更新

```http
POST /workflow/create/template/article-save-pipeline
Content-Type: application/json

{ "targetId": "article-id", "forceUpdate": true }
```

```http
POST /workflow/create/template/paste-save-pipeline
Content-Type: application/json

{ "targetId": "paste-id" }
```

成功响应的 `data` 是工作流描述符，包含 `workflowId`、`taskIds`、
`reportTaskIds`、`trackTaskIds`；它表示任务已创建，不表示存档立即完成。
可通过 `GET /workflow/query/:workflowId` 查询工作流状态。

`article-save-pipeline` 是公开模板，支持 `forceUpdate=true`，并会同时创建文章与评论任务。
默认 `forceUpdate=false` 时，如果标题和内容哈希未变，保存层会直接跳过更新；
这意味着“只有点赞/收藏计数改变”不会刷新存档计数。要刷新计数必须显式传
`forceUpdate: true`。

`paste-save-pipeline` 当前模板不会把 `forceUpdate` 传给任务；剪贴板本身也没有
本需求所需的交互计数。

一手证据：

- [公开工作流模板权限与 article `forceUpdate`](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/lib/workflow-templates.ts#L43-L85)
- [paste 模板不传 `forceUpdate`](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/lib/workflow-templates.ts#L178-L205)
- [哈希未变时的跳过条件](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/services/helpers/hashed-content.helper.ts#L72-L84)
- [工作流创建与查询路由](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/workflow.router.ts#L27-L59)
- [工作流响应形状](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/frontend/src/api/workflow.ts#L4-L41)

### 评论手动刷新

```http
POST /article/comments/:id/refresh
```

成功时返回：

```json
{
  "code": 200,
  "message": "Success",
  "data": { "taskId": "..." }
}
```

这个 POST 只向保存站队列派发刷新任务，不返回新评论。客户端需在任务完成后
重新 GET，并仍以 `commentsStale/commentsFetchedAt` 判断新鲜度。

- [评论 refresh 路由与 `{ taskId }` 响应](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/article.router.ts#L156-L175)

## 对 LuoguSP 2.14.0-canary 的直接建议

1. 评论读取顺序应是洛谷同源 `/article/{id}/replies` 优先，失败才读
   `api.luogu.me/article/comments/{id}`。保存站回退应保留并传递
   `commentsStale/commentsFetchedAt`，不应标记为“实时”。
2. 文章数值的降级来源可以是保存站 `upvote/favorCount`，但它们只能当作
   存档快照。`favored/voted/canReply/canEdit` 必须来自当前浏览器的洛谷文章
   上下文，保存站无法补齐。
3. 点赞、收藏和发表评论必须调用浏览器中的洛谷同源写入接口。
   `api.luogu.me` 的 POST 是“更新保存站存档”，不是“以当前洛谷账号互动”，
   不能代替洛谷写入。
4. 如果 LuoguSP 的“手动更新文章存档”还要更新公共点赞/收藏计数，
   article workflow 请求应显式传入 `forceUpdate: true`；否则文章内容不变时计数也
   不会落库。
5. 剪贴板保持只读，界面不显示点赞、收藏、评论输入框或可点击的交互计数。

## 调查限制

- 本调查只调用了公开 GET 接口。为保持只读，未向保存站提交任何 workflow
  或 comments refresh POST。
- 实测响应是 2026-08-12 的瞬时样本；稳定实现依据以上述固定提交的路由、
  实体和 handler 源码为准。
