// 真机 QA 用的离线夹具页。
//
// ★★ 为什么是离线夹具而不是打开 www.luogu.com.cn：这道门要回答的是
//    「**这份产物**在浏览器里跑起来会不会炸、启动要多久」，答案必须**可复现**。
//    打真站会把网络抖动、WAF、登录态全搅进来，红了也说不清是谁的错。
//    需要联网才验得了的东西（按需块、保存站、写请求）**明说不在覆盖范围内**，
//    写进报告的 limitations，不假装验过。
//
// ★ 夹具刻意做成**旧版页**的骨架：`nav.lfe-body` 是设置入口三种落点里最简单的一种，
//   足以证明 page-lifecycle 跑通、功能被挂载。
//
// ★ `lentille-context` 里塞了一道题的难度 —— problem-color 的整批收取会直接命中它，
//   于是「题号被染色」这条检查**一个网络请求都不用发**。
const LENTILLE = {
  user: { uid: 1313427, name: "qa" },
  currentData: {},
  data: {
    problems: {
      result: [{ pid: "P1000", difficulty: 1, name: "超级玛丽游戏" }],
    },
  },
};

export const FIXTURE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>LuoguSP QA fixture</title>
<script id="lentille-context" type="application/json">${JSON.stringify(LENTILLE)}</script>
</head>
<body>
  <nav class="lfe-body">
    <ul>
      <li><a href="/"><span class="icon"></span><span class="title">首页</span></a></li>
      <li><a href="/article"><span class="icon"></span><span class="title">文章</span></a></li>
    </ul>
  </nav>
  <main>
    <div class="row">
      <a class="pid-link" href="/problem/P1000">P1000</a>
      <a href="/user/697932">Gcend</a>
      <img src="https://cdn.luogu.com.cn/upload/usericon/697932.png" alt="">
    </div>
  </main>
</body></html>`;
