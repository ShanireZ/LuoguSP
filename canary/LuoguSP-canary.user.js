// LuoguSP Canary —— 当前**没有**在跑的 canary。
//
// 2.14.0 已经转正式版（2026-08-14），canary 频道随之指向 2.14.0，
// 上一份 canary（2.14.0-canary.22）的产物已从 CDN 下线，实测 404。
// 装 canary 请等下一轮 —— 那时这个文件会被重新写成一份可安装的用户脚本。
//
// 下一轮怎么写（照抄上一轮的做法）：
//   1. `node scripts/cdn/publish.mjs --version <next>-canary.N`
//   2. 把本文件恢复成完整的 ==UserScript== 头，`@version` 写 <next>-canary.N，
//      两条 `@require` 指向新 release 的 early-gate / runtime，`#sha256=` 从
//      `cdn/releases/<version>/manifest.json` 的 compat 段里抄。
//   3. 远端实测：两条 @require 与各可选块 HTTP 200，且远端字节 == 本地字节 == 钉死的 sha256。
//   ★ 本文件**没有 @updateURL**，油猴不会自动更新，owner 必须覆盖安装。
