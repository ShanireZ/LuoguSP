// 真機 QA 用的離線夾具頁。
//
// ★★ 為什麼是離線夾具而不是打開 www.luogu.com.cn：這道門要回答的是
//    「**這份產物**在瀏覽器裡跑起來會不會炸、啟動要多久」，答案必須**可重現**。
//    打真站會把網路抖動、WAF、登入態全攪進來，紅了也說不清是誰的錯。
//    需要聯網才驗得了的東西（按需塊、保存站、寫請求）**明說不在覆蓋範圍內**，
//    寫進報告的 limitations，不假裝驗過。
//
// ★ 每條 <li> 上的 title 是照真站抄的（2026-08-20 在 www.luogu.com.cn 上量的）：
//   浮泡文字掛在 <li> 上而不是 <a> 上，而設定入口是整條 <li> 克隆範本來的 ——
//   夾具不帶 title，這道門就永遠看不見「懸停外掛設定顯示文章廣場」那一類缺陷。
//   末尾那條無圖標的「雲剪貼板」也是真站形狀：它保證範本一定落在「文章廣場」上。
// ★ 夾具刻意做成**舊版頁**的骨架：`nav.lfe-body` 是設定入口三種落點裡最簡單的一種，
//   足以證明 page-lifecycle 跑通、功能被掛載。
//
// ★ `lentille-context` 裡塞了一道題的難度 —— problem-color 的整批收取會直接命中它，
//   於是「題號被染色」這條檢查**一個網路請求都不用發**。
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
      <li title="首页"><a href="/"><span class="icon"></span><span class="title">首页</span></a></li>
      <li title="文章广场"><a href="/article"><span class="icon"></span><span class="title">文章广场</span></a></li>
      <li><a href="/paste"><span class="title minor">云剪贴板</span></a></li>
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
