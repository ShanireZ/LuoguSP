# Luogu Saver API 與文章交互資料調查

> 調查時間：2026-08-12（Asia/Shanghai）  
> 原始碼基線：`laikit-dev/luogu-saver` `master` 提交  
> [`898f230b31db6f817d9d0bbcfcc848505eca759c`](https://github.com/laikit-dev/luogu-saver/commit/898f230b31db6f817d9d0bbcfcc848505eca759c)

## 結論

1. `https://api.luogu.me` 就是 Luogu Saver 當前公開的後端 API，現有
   LuoguSP 使用的 `/article/query/:id`、`/paste/query/:id`、
   `/article/comments/:id` 都來自該儲存庫的 Koa 路由，不是另一套即時洛谷代理。
2. 保存站文章查詢包含 `upvote` 和 `favorCount`，但它們是最近一次成功存檔時
   寫入資料庫的公共計數快照，不是請求時的即時資料。
3. 保存站不保存、也不回傳訪問者的 `favored`、`voted`、`canReply`、`canEdit`。
   這四個欄位不能由 `api.luogu.me` 建構，必須優先使用當前瀏覽器中同源洛谷文章
   上下文；獲取不到時應按未知/不可交互降級，不應用 `false` 偽造狀態。
4. 保存站評論是存檔退回，不是即時評論：伺服器端從
   `https://www.luogu.com/article/{lid}/replies` 分頁抓取，預設六小時過期。
   過期的 GET 會非同步派發刷新，但本次回應仍回傳舊評論列表。
5. 保存站沒有雲剪貼簿評論、點贊、收藏模型或路由。剪貼簿退回頁應繼續唯讀，
   不應繪製文章的交互按鈕。

## API 資料形狀

### `GET /article/query/:id`

路由讀取保存站的 `Article` 資料庫實體，伺服器端繪製 Markdown 後以
`{ code, message, data }` 包裝回傳。關鍵形狀為：

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

一手證據：

- [article router，查詢並回傳實體](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/article.router.ts#L50-L62)
- [Article 實體的 `upvote` / `favorCount`](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/entities/article.ts#L43-L50)
- [當前前端定義的保存站 Article 回應欄位](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/frontend/src/types/article.d.ts#L3-L25)
- [2026-08-12 實測樣本回應](https://api.luogu.me/article/query/ci3c3mr1)

實測樣本的 `data` 共有 `id/title/content/authorId/category/upvote/favorCount/...`
等欄位，不存在 `favored`、`voted`、`canReply`、`canEdit`。

### `GET /paste/query/:id`

剪貼簿查詢同樣回傳保存站資料庫實體：

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

該實體只有內容、作者、刪除與時間等存檔欄位，沒有任何交互欄位或評論關係。

一手證據：

- [paste router](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/paste.router.ts#L9-L27)
- [Paste 資料庫實體](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/entities/paste.ts#L21-L57)
- [前端 Paste 類型](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/frontend/src/types/paste.d.ts#L3-L13)
- [2026-08-12 實測樣本回應](https://api.luogu.me/paste/query/40hfk7qm)

實測樣本的 `data` 只有
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

`commentsStale=true` 時，路由會後台派發一個評論刷新任務，然後立即回傳當前資料庫
中的列表。因此這個 GET 不保證回傳刷新後的內容，並且在過期情況下存在
後台副作用。

一手證據：

- [評論查詢、過期派發和回應映射](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/article.router.ts#L117-L154)
- [六小時 TTL 和 200 頁上限](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/shared/comment.ts#L10-L16)
- [2026-08-12 實測樣本：85 條評論，`commentsStale=false`](https://api.luogu.me/article/comments/ci3c3mr1)

## 資料從哪裡來

### 文章和計數

`article-save-pipeline` 的抓取任務從
`https://www.luogu.com/article/{id}` 讀取 `resp.data.article`，再將文章內容、
`upvote`、`favorCount` 寫入保存站資料庫。

洛谷源回應的類型其實包含外層 `favored`、`voted`、`canReply`、`canEdit`，
但保存任務只取 `resp.data.article`；隨後的資料庫實體和寫入映射也都沒有這些
個人狀態/權限欄位。

一手證據：

- [洛谷 `ArticleData` 源類型包含四個交互欄位](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/types/luogu-api.d.ts#L626-L632)
- [存檔任務只取 `resp.data.article`](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/workers/handlers/task/save/article.handler.ts#L16-L30)
- [存檔寫入映射只保留公共計數](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/services/article.service.ts#L328-L345)

抓取工具可選接受 Cookie，但文章、剪貼簿和評論 handler 呼叫時都沒有傳第三個
Cookie 參數。這些任務是保存站伺服器的匿名抓取，不具有 LuoguSP 訪問者的洛谷
工作階段；網路失敗或 429 時還可以由保存站伺服器改用 Tor。

- [抓取工具的可選 Cookie 與 Tor 退回](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/utils/fetch.ts#L146-L210)

### 評論

`save:comments` 任務按 `after={lastCommentId}` 從
`https://www.luogu.com/article/{lid}/replies?sort=&after=...` 抓取 `replySlice`，
去重後用一個交易整體替換已存評論並更新 `commentsFetchedAt`。

- [洛谷評論分頁抓取與存檔](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/workers/handlers/task/save/comments.handler.ts#L43-L100)
- [評論的整體替換交易](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/services/comment.service.ts#L35-L67)

<a id="剪貼板"></a>

### 剪貼簿

`paste-save-pipeline` 從 `https://www.luogu.com/paste/{id}` 讀取
`resp.currentData.paste`，只保存剪貼簿 ID、內容和作者，沒有評論抓取分支。

- [剪貼簿抓取 handler](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/workers/handlers/task/save/paste.handler.ts#L16-L30)
- [剪貼簿儲存映射](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/services/paste.service.ts#L45-L76)

## Refresh API 語義

<a id="文章剪貼板收錄與更新"></a>

### 文章/剪貼簿收錄與更新

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

成功回應的 `data` 是工作流描述符，包含 `workflowId`、`taskIds`、
`reportTaskIds`、`trackTaskIds`；它表示任務已建立，不表示存檔立即完成。
可通過 `GET /workflow/query/:workflowId` 查詢工作流狀態。

`article-save-pipeline` 是公開範本，支援 `forceUpdate=true`，並會同時建立文章與評論任務。
預設 `forceUpdate=false` 時，如果標題和內容雜湊未變，保存層會直接跳過更新；
這意味著“只有點贊/收藏計數改變”不會刷新存檔計數。要刷新計數必須顯式傳
`forceUpdate: true`。

`paste-save-pipeline` 當前範本不會把 `forceUpdate` 傳給任務；剪貼簿本身也沒有
本需求所需的交互計數。

一手證據：

- [公開工作流範本權限與 article `forceUpdate`](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/lib/workflow-templates.ts#L43-L85)
- [paste 範本不傳 `forceUpdate`](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/lib/workflow-templates.ts#L178-L205)
- [雜湊未變時的跳過條件](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/services/helpers/hashed-content.helper.ts#L72-L84)
- [工作流建立與查詢路由](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/workflow.router.ts#L27-L59)
- [工作流回應形狀](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/frontend/src/api/workflow.ts#L4-L41)

### 評論手動刷新

```http
POST /article/comments/:id/refresh
```

成功時回傳：

```json
{
  "code": 200,
  "message": "Success",
  "data": { "taskId": "..." }
}
```

這個 POST 只向保存站佇列派發刷新任務，不回傳新評論。用戶端需在任務完成後
重新 GET，並仍以 `commentsStale/commentsFetchedAt` 判斷新鮮度。

- [評論 refresh 路由與 `{ taskId }` 回應](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/article.router.ts#L156-L175)

## 對 LuoguSP 2.14.0-canary 的直接建議

1. 評論讀取順序應是洛谷同源 `/article/{id}/replies` 優先，失敗才讀
   `api.luogu.me/article/comments/{id}`。保存站退回應保留並傳遞
   `commentsStale/commentsFetchedAt`，不應標記為“即時”。
2. 文章數值的降級來源可以是保存站 `upvote/favorCount`，但它們只能當作
   存檔快照。`favored/voted/canReply/canEdit` 必須來自當前瀏覽器的洛谷文章
   上下文，保存站無法補齊。
3. 點贊、收藏和發表評論必須呼叫瀏覽器中的洛谷同源寫入介面。
   `api.luogu.me` 的 POST 是“更新保存站存檔”，不是“以當前洛谷帳號互動”，
   不能代替洛谷寫入。
4. 如果 LuoguSP 的“手動更新文章存檔”還要更新公共點贊/收藏計數，
   article workflow 請求應顯式傳入 `forceUpdate: true`；否則文章內容不變時計數也
   不會寫入資料庫。
5. 剪貼簿保持唯讀，介面不顯示點贊、收藏、評論輸入框或可點擊的交互計數。

## 補充調查（2026-08-12 夜）：洛谷側唯讀介面與官方寫契約

### 受限文章沒有可用的官方唯讀狀態介面

對受限文章 `2l4x53kj` 實測，三種讀法都被「安全訪問中心」攔截頁替換
（HTTP 200、`text/html`、2680 位元組，標題 `安全访问中心 - 洛谷`）：

| 請求 | 結果 |
|---|---|
| `GET /article/2l4x53kj` | 攔截頁 |
| `GET /article/2l4x53kj` + `x-luogu-type: content-only` | 攔截頁 |
| `GET /article/2l4x53kj?_contentOnly=1` | 攔截頁 |

結論：受限文章不存在可帶當前 `.cn` 登入態讀回 `favored` / `voted` 的同源唯讀介面。
`favored` / `voted` 只能來自官方寫回應，並按帳號隔離本機持久化。

### 官方 article.show 的互動寫契約

原始碼基線：columba `20260730-2078`，
`https://fecdn.luogu.com.cn/columba/columba~0bd2df6a7ee2b996.js`（`article.show` 頁面元件）。

```js
// 收藏：回應體不參與狀態，用戶端自行推導
await post({ name: "article.favor", params: { lid }, query: favored ? { remove: 1 } : {} });
data.favored = !favored;
data.article.favorCount = data.article.favorCount + (favored ? -1 : 1);

// 點贊：回應體是權威
const vote = data.article.voted === intent ? 0 : intent;
const { data: body } = await post({ name: "article.vote", params: { lid }, query: { vote } });
data.article.upvote = body.upvotes;
data.article.voted = body.voted;
```

要點：

1. 撤回點贊發 `?vote=0`，取消收藏發 `?remove=1`；兩者都由**當前顯示的個人狀態**決定，
   所以個人狀態一旦丟失就無法撤回。
2. 點贊回應體形狀是 `{ upvotes, voted }`（`post` 是 axios 執行個體，`.data` 即 HTTP 回應體）。
3. 狀態容器是 `lentille current data`，即 `lentille-context` 的 `data`；元件直接改它。
4. 官方前端用 axios，預設 `adapter: ["xhr","http","fetch"]` →
   **這些寫請求實際走 XMLHttpRequest**。要觀察寫回應必須掛在 XHR 層，只掛 fetch 收不到。
5. CSRF 由官方 `useAxiosDefaults` 從文件裡的 `meta[name=csrf-token]` 讀取並設為
   `X-CSRF-TOKEN` 請求頭；同源 XHR 自帶 Cookie。LuoguSP 重建文件時寫入的是活取的真實 CSRF。

## 調查限制

- 本調查只呼叫了公開 GET 介面。為保持唯讀，未向保存站提交任何 workflow
  或 comments refresh POST。
- 實測回應是 2026-08-12 的瞬時樣本；穩定實作依據以上述固定提交的路由、
  實體和 handler 原始碼為準。
