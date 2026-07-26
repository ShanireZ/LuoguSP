# LuoguSP CDN Loader 可行性与性能预演

日期：2026-07-26

状态：研究完成；本阶段不实施生产 loader。

## 结论

技术上可以把 LuoguSP 拆成一个小 loader 和多个远程 ESM chunk，但当前
不建议替换单文件生产架构。

原因不是分块体积，而是 userscript 的执行模型：

1. 当前四个 `@require` 会在主脚本之前加载。只缩小第一方主脚本并不能
   保证 `document-start` loading gate 更早执行。
2. `@grant none` 关闭 userscript 沙箱，动态 `import()`、模块脚本、
   CSP、CORS 和 `blob:` 回退都需要在洛谷真实页面逐路由验证。
3. 动态 `import()` 没有直接的 SRI 参数；自行 fetch、验 SHA-256、再
   import Blob 又可能受到页面 CSP 限制。
4. 当前单文件安装后由 Tampermonkey 本地持有；远程 loader 会把首次运行
   重新变成网络关键路径。
5. 多 chunk 更新需要版本原子性、失败回退和旧版本保留策略。

建议继续以单文件 IIFE 为生产方案，把 CDN 分块保留为独立实验。

## 预演分块体积

`npm run analyze:chunks` 使用当前源码图执行了“ESM + minify + splitting”
内存构建，没有生成或接入生产 loader。

| 实验入口 | 可达请求数 | 字节 | gzip 字节 |
|---|---:|---:|---:|
| early-gate | 1 | 598 | 342 |
| app-core | 2 | 3,829 | 1,674 |
| settings | 1 | 6,192 | 2,676 |
| problem-color | 2 | 9,740 | 4,224 |
| chat-shortcut | 2 | 2,411 | 1,364 |
| hidden-intro | 3 | 13,273 | 5,422 |
| ide-batch | 3 | 22,420 | 8,294 |
| restricted-content | 2 | 31,247 | 11,338 |

全部实验输出去重后为 86,641 B、gzip 33,280 B、10 个文件。这里不包括
四个第三方 `@require`；它们当前在线实测合计 473,733 B、gzip
143,935 B。

这说明第一方代码具备分块价值，但稳定态节省主要来自“按路由不执行”，
不是来自网络下载：现有单文件由 Tampermonkey 本地存储，通常没有逐页
远程下载成本。

## 当前机器源站预演

`npm run benchmark:origins` 在 Windows / Node 24 / Asia/Shanghai
环境中对远端当前发布文件执行 6 次请求。它只是单机、单网络、单时段预演，
不是全国运营商结论。

| 源站 | 首次请求 | 后续中位数 | 结果 |
|---|---:|---:|---|
| Gitee Raw main | 1,319 ms | 234 ms | 6/6 |
| GitHub Raw main | 1,464 ms | 391 ms | 6/6 |
| jsDelivr GitHub 精确 commit | 2,480 ms | 374 ms | 6/6 |
| jsDelivr GitHub main | 1,070 ms | 376 ms | 6/6 |

原始样本见 `reports/cdn-origin-preflight.json`。一次冷请求的波动明显高于
第一方 chunk 的解析成本，因此 loader 的首要性能风险是网络而不是代码体积。

## CDN 候选

### 1. GitHub + jsDelivr

优点：

- 无需 npm 发布。
- 可直接使用 GitHub release、tag 或 commit。
- 精确版本/commit 按官方策略长期不可变。
- 部署成本最低，适合实验。

要求：

- 只能使用精确 tag 或 commit，禁止 `main`、`latest`、版本范围。
- chunk 文件必须存在于该 Git commit 中。
- loader 与所有 chunk 必须绑定同一 release manifest。
- `@require` 可使用 Tampermonkey SRI；动态 ESM 仍需另做完整性方案。

官方资料：

- <https://github.com/jsdelivr/jsdelivr#github>
- <https://www.tampermonkey.net/documentation.php?locale=en&q=sri>

### 2. Cloudflare Workers / Static Assets

Cloudflare Static Assets 可以将 Worker 与静态文件作为一个部署单元，并自动
边缘缓存；生产环境推荐自定义域名，而不是把 `workers.dev` 当关键基础设施。

但真正的中国大陆 Cloudflare China Network 是 Enterprise 的独立订阅，
还要求 ICP 和 JD Cloud 内容审核。普通免费 Worker 不能据此推断为境内
稳定加速方案。

因此它适合已有 Cloudflare Enterprise/备案域名的团队，不适合作为当前
开源 userscript 的默认境内 CDN。

官方资料：

- <https://developers.cloudflare.com/workers/static-assets/>
- <https://developers.cloudflare.com/workers/configuration/routing/>
- <https://developers.cloudflare.com/china-network/get-started/>

### 3. Tencent EdgeOne Pages / Makers

EdgeOne 支持 GitHub 集成、静态资源边缘缓存和部署版本。带 hash 文件默认
可获得一年浏览器缓存；每次新部署会刷新边缘缓存。

大陆或“全球含大陆”稳定自定义域名需要 ICP。官方项目域名/部署域名在大陆
区域存在预览链接时效或 401 规则，所以不能把免费默认域名直接当成长期
userscript CDN。具备备案自定义域名时，它才是值得重点实测的境内候选。

官方资料：

- <https://edgeone.ai/document/159419173750599680>
- <https://edgeone.ai/document/180002216702672896>
- <https://edgeone.ai/document/175201428435140608>

### 4. Gitee Raw

本机预演中后续请求最快，且当前 userscript 更新地址已经使用 Gitee。
但 branch Raw 是可变源站，不提供和精确 commit CDN 相同的不可变缓存语义。
可以作为更新源或灾备候选，不建议直接承担版本化 chunk 的唯一权威源。

## 如果未来继续实验，必须满足的设计

### 原子版本

```text
loader version
  -> immutable manifest
      -> exact chunk URLs
      -> SHA-256 for every chunk
      -> minimum loader API version
```

manifest、loader、chunk 必须在同一 tag/commit 生成。不得让主脚本读取
`main` 分支上的可变 manifest。

### 加载策略

- early gate 必须内联并同步执行。
- app-core、settings、problem-color 可并行预取。
- chat、hidden-intro、IDE、restricted-content 按路由和设置加载。
- restricted-content 的失败必须释放 loading gate 并显示稳定错误页。
- 每个 chunk 都要有超时、取消、路由 generation 检查。

### 安全与失败回退

- 明确选择 `@require + SRI`（可靠但全量前置）还是动态 ESM
  （可懒加载但需 CSP/完整性方案）。
- CDN 故障时不能无限 loading。
- 多 CDN 回退必须验证相同 SHA-256，不能信任“同文件名”。
- 保留至少一个上一版本的不可变 URL。
- 记录 loader/chunk 版本到诊断日志，但不得引入跟踪。

## 后续实验计划

1. 在独立实验分支生成 hash 命名 ESM chunk，不改生产 metadata 和更新 URL。
2. 在本地 HTTP 服务验证 CSP、CORS、动态 import、取消和路由漂移。
3. 仅使用精确 Git commit 的 jsDelivr URL做第一轮远端 canary。
4. 若有备案域名，再部署 EdgeOne 自定义域名做对照；Cloudflare 仅在已有
   China Network 商业条件时进入候选。
5. 在电信、联通、移动网络分别采集冷/热缓存至少 20 次：
   DNS、连接、TTFB、总时间、成功率、cache header。
6. 验证 Tampermonkey、Violentmonkey，以及 Chrome/Firefox。
7. 完成 SRI/哈希校验、超时、回退和旧版本恢复演练。
8. 只有当首屏、失败率和维护成本均优于单文件，才设计 opt-in canary；
   未通过前不修改生产 `LuoguSP.user.js` 架构。

## 当前决策

生产架构：继续使用源码多模块、发布单 IIFE。

实验优先级：jsDelivr 精确 Git commit > 有备案域名的 EdgeOne >
具备 Enterprise China Network 条件的 Cloudflare。

当前不实施 loader，不修改 metadata，不新增运行时 CDN 权限。
