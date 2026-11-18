import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHoverCardFeatures } from "../src/features/hover-card/lazy-feature.js";
import { createHoverCardFeature } from "../src/features/hover-card/feature.js";
import {
  readCsrfToken,
  readPageSubject,
  readViewerUid,
  resolveHoverTarget,
} from "../src/features/hover-card/anchors.js";
import { placeCard } from "../src/features/hover-card/card-view.js";
import { optionalBundleBudgetFailures } from "../scripts/cdn/size-budget.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

// hover 卡是第三個按需塊（21517 B / gzip 8327 B）。啟動包裡只留一枚探針：
// 指針第一次碰到題號或使用者連結才把塊拉下來，絕大多數頁面瀏覽根本不觸發。

const origin = "https://www.luogu.com.cn";
const avatarOrigin = "https://cdn.luogu.com.cn";

function hoverPage(html, path = "/") {
  return new JSDOM(html, { url: origin + path }).window.document;
}

test("题名链接从实际 URL 取得 pid 并保留比赛与语言", () => {
  const page = hoverPage('<a href="P3372?contestId=1&amp;lang=en">题目名称</a>', "/problem/list");
  const anchor = page.querySelector("a");
  assert.deepEqual(resolveHoverTarget(anchor), {
    kind: "problem", key: "problem:P3372", pid: "P3372", anchor,
    href: origin + "/problem/P3372?contestId=1&lang=en",
  });
});

test("站内题库导航、路由后缀及查询片段不得被当成题号", () => {
  const invalidLinks = [
    "/problem/list", "/problem/list?tag=42", "/problem/new",
    "/problem/solution/P1000", "/problem/P1000/elsewhere", "/prefix/problem/P1000",
    "/discuss/123?forum=P1000", "/search?q=/problem/P1000", "#/problem/P1000",
    "/user/123fake", "/user/123/elsewhere", "/prefix/user/123",
    "/search?q=/user/123", "#/user/123",
  ];
  const page = hoverPage(invalidLinks.map(href => '<a data-luogusp-pid="P1000" href="' + href + '">P1000</a>').join(""));
  for (const anchor of page.querySelectorAll("a"))
    assert.equal(resolveHoverTarget(anchor), null, anchor.href);
});

test("只识别使用者资料页及已知的资料页分页", () => {
  const page = hoverPage('<a href="/user/697932">资料</a><a href="/user/697932/practice">练习</a><a href="/user/697932/article/">专栏</a>');
  for (const anchor of page.querySelectorAll("a"))
    assert.deepEqual(resolveHoverTarget(anchor), { kind: "user", key: "user:697932", uid: 697932, anchor });
});

test("原生空链接取可见题号，实际链接仍以 URL 为准", () => {
  const page = hoverPage(
    '<a id="native" data-v-bade3303 data-v-4842157a href="javascript:void 0">P2000 标题</a>' +
    '<a id="unmarked" data-luogusp-pid="P2000" href="#">P2000 标题</a>' +
    '<a id="offsite" data-v-bade3303 data-v-4842157a href="//example.invalid/problem/P2000">P2000 标题</a>' +
    '<a id="linked" data-v-bade3303 data-v-4842157a href="/problem/P3000">P2000 标题</a>',
  );
  assert.equal(resolveHoverTarget(page.getElementById("native")).pid, "P2000");
  assert.equal(resolveHoverTarget(page.getElementById("unmarked")), null);
  assert.equal(resolveHoverTarget(page.getElementById("offsite")), null);
  assert.equal(resolveHoverTarget(page.getElementById("linked")).pid, "P3000");
});

test("独立头像只从洛谷站内或头像 CDN 取 uid", () => {
  const page = hoverPage(
    '<img src="' + avatarOrigin + '/upload/usericon/123.png">' +
    '<img src="/upload/usericon/456.png">' +
    '<img src="https://example.invalid/upload/usericon/789.png">' +
    '<img src="/search?q=/upload/usericon/789.png">' +
    '<img src="/prefix/upload/usericon/789.png">',
  );
  const [cdn, sameOrigin, ...invalid] = page.querySelectorAll("img");
  assert.equal(resolveHoverTarget(cdn).uid, 123);
  assert.equal(resolveHoverTarget(sameOrigin).uid, 456);
  for (const img of invalid) assert.equal(resolveHoverTarget(img), null, img.src);
});

test("站点框架里的锚点一律不出卡", () => {
  const page = hoverPage(["top-bar", "lside", "rside", "user-nav"].map(name =>
    '<div class="' + name + '"><a href="/problem/P1001">P1001</a><a href="/user/116524">用户</a>' +
    '<img src="' + avatarOrigin + '/upload/usericon/116524.png"></div>').join("") +
    '<main><a href="/user/116524">用户</a></main>');
  for (const target of page.querySelectorAll("div a, div img")) assert.equal(resolveHoverTarget(target), null);
  assert.equal(resolveHoverTarget(page.querySelector("main a")).uid, 116524);
});

test("页面主体自己不出卡，同页别的目标照出", () => {
  const profile = hoverPage(
    '<img src="' + avatarOrigin + '/upload/usericon/116524.png">' +
    '<a id="current" href="/user/116524">用户</a><a id="other" href="/user/123">其他用户</a>' +
    '<a id="problem" href="/problem/P1000">题目</a>', "/user/116524/practice",
  );
  assert.equal(resolveHoverTarget(profile.querySelector("img")), null);
  assert.equal(resolveHoverTarget(profile.getElementById("current")), null);
  assert.equal(resolveHoverTarget(profile.getElementById("other")).uid, 123);
  assert.equal(resolveHoverTarget(profile.getElementById("problem")).pid, "P1000");

  const problems = hoverPage(
    '<a id="current" href="/problem/P1001">本题</a><a id="other" href="/problem/P1002">推荐题目</a>', "/problem/P1001",
  );
  assert.equal(resolveHoverTarget(problems.getElementById("current")), null);
  assert.equal(resolveHoverTarget(problems.getElementById("other")).pid, "P1002");
});

test("页面主体解析只认真正的 uid / pid", () => {
  assert.deepEqual(readPageSubject("/problem/P1001"), { kind: "problem", pid: "P1001" });
  assert.deepEqual(readPageSubject("/user/1313427"), { kind: "user", uid: 1313427 });
  assert.deepEqual(readPageSubject("/user/1313427/practice"), { kind: "user", uid: 1313427 });
  for (const path of [
    "/problem/list", "/problem/list?tag=42", "/problem/solution/P1000", "/problem/new",
    "/user/setting", "/user/notification", "/", "", null,
  ]) assert.equal(readPageSubject(path), null, String(path));
});

test("题号格 .pid[title] 保留原始 title，旁边题名连结仍出卡", () => {
  const page = hoverPage('<div class="pid" title="P1000">P1000</div><a href="/problem/P1000">题目名称</a>');
  const cell = page.querySelector(".pid");
  assert.equal(resolveHoverTarget(cell), null);
  assert.equal(cell.title, "P1000");
  assert.equal(resolveHoverTarget(page.querySelector("a")).pid, "P1000");
});

test("私信页按行用洛谷头像辨识没有链接的联络人名称", () => {
  const row = '<div><span>用户名称</span><img src="' + avatarOrigin + '/upload/usericon/2020479.png"></div>';
  const chat = hoverPage(row, "/chat");
  const name = chat.querySelector("span");
  assert.equal(resolveHoverTarget(name).uid, 2020479);
  chat.querySelector("img").src = "https://example.invalid/upload/usericon/2020479.png";
  assert.equal(resolveHoverTarget(name), null);
  for (const path of ["/discuss", "/article/xxx", "/"])
    assert.equal(resolveHoverTarget(hoverPage(row, path).querySelector("span")), null, path);
});

test("读不到登录态就当匿名", () => {
  const doc = {
    getElementById: () => ({ textContent: JSON.stringify({ user: { uid: 1313427 } }) }),
    querySelector: () => ({ getAttribute: () => "tok" }),
  };
  assert.equal(readViewerUid(doc, {}), 1313427);
  assert.equal(readCsrfToken(doc), "tok");
  // lentille 形狀漂移 → 退回舊版 _feInjection → 都沒有就是匿名。
  const broken = { getElementById: () => ({ textContent: "{{" }), querySelector: () => null };
  assert.equal(readViewerUid(broken, { _feInjection: { currentUser: { uid: 7 } } }), 7);
  assert.equal(readViewerUid(broken, {}), null);
  assert.equal(readCsrfToken(broken), null);
});

// ---- 定位 ----
test("卡片撞到视口右边和下边会翻回来", () => {
  const card = { offsetWidth: 320, offsetHeight: 200, style: {} };
  const placed = placeCard(card, { left: 1100, right: 1180, top: 700, bottom: 720 }, { width: 1280, height: 800 });
  assert.ok(placed.left + 320 <= 1280 - 4, "右边不许超出视口");
  assert.ok(placed.top >= 4, "上边不许超出视口");
  assert.ok(placed.top < 700, "下方放不下就翻到上方");
});

// ---- 薄殼行為 ----
const storage = { get: () => true, set: () => {} };

function shellHarness(options = {}) {
  const listeners = new Map();
  const calls = { load: 0, mount: 0, dispose: 0 };
  const errors = [];
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {},
    getElementById: () => null,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const features = createHoverCardFeatures({
    storage,
    logError: (error) => errors.push(error),
    loadBundle:
      options.loadBundle === null
        ? undefined
        : options.loadBundle ||
          (() => {
            calls.load += 1;
            return Promise.resolve({
              apiVersion: 1,
              createHoverCardFeature: () => ({
                mount: (mountOptions) => {
                  calls.mount += 1;
                  calls.mountOptions = mountOptions;
                  return () => void (calls.dispose += 1);
                },
              }),
            });
          }),
  });
  return {
    feature: features.problem,
    features,
    calls,
    errors,
    fire: (target, point = { clientX: 12, clientY: 34 }) => {
      const probe = listeners.get("mouseover");
      if (probe) probe({ target, ...point });
    },
    fireShortcut: (target) => {
      let prevented = false;
      listeners.get("keydown")?.({
        target, altKey: true, key: "ArrowDown", preventDefault: () => { prevented = true; },
      });
      return prevented;
    },
    hasProbe: () => listeners.has("mouseover"),
    restore: () => {
      globalThis.document = originalDocument;
    },
  };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

const candidate = () => hoverPage('<a href="/problem/P1000">题目名称</a>').querySelector("a");

test("描述符不加载块就能给设置页用", () => {
  const h = shellHarness();
  try {
    // ★ owner 第四輪：一個開關拆成兩個，標籤也改了。
    assert.equal(h.feature.key, "showProblemHoverCards");
    assert.equal(h.feature.label, "题目悬停显示预览卡");
    assert.equal(h.features.user.key, "showUserHoverCards");
    assert.equal(h.features.user.label, "用户名/头像悬停显示预览卡");
    assert.equal(h.calls.load, 0);
  } finally {
    h.restore();
  }
});

test("私信页直接悬停联络人名称可加载预览", async () => {
  const h = shellHarness();
  try {
    h.features.user.mount();
    const chat = hoverPage('<div><span>联络人</span><img src="' + avatarOrigin + '/upload/usericon/123.png"></div>', "/chat");
    h.fire(chat.querySelector("span"));
    await settle();
    assert.equal(h.calls.load, 1, "裸 span 也必须能把块拉下来");
    assert.equal(h.calls.mount, 1);
  } finally {
    h.restore();
  }
});

// 反過來：這一頁壓根沒有可預覽的東西，就一個位元組都不拉 —— 按需載入的意義還在。
test("仅指向站外的目标不加载预览块也不拦快捷键", async () => {
  const h = shellHarness();
  try {
    h.feature.mount();
    const anchor = hoverPage('<a href="//example.invalid/problem/P1000">外部题目</a>').querySelector("a");
    h.fire(anchor);
    assert.equal(h.fireShortcut(anchor), false);
    await settle();
    assert.equal(h.calls.load, 0);
    assert.equal(h.calls.mount, 0);
    assert.equal(h.hasProbe(), true, "探针要留着，内容是后到的");
  } finally {
    h.restore();
  }
});

// ★ 每頁頂欄都有我自己的頭像。拿它當依據就等於「所有頁面都載入」，
//   所以整頁只有框架裡的候選時同樣不拉。
test("整页只有站点框架里的候选也不拉块", async () => {
  const h = shellHarness();
  try {
    h.feature.mount();
    const page = hoverPage('<div class="top-bar"><a href="/problem/P1000">题目</a></div>');
    h.fire(page.querySelector("a"));
    await settle();
    assert.equal(h.calls.load, 0);
  } finally {
    h.restore();
  }
});

test("碰到候选锚点才拉块，并且只拉一次", async () => {
  const h = shellHarness();
  try {
    h.feature.mount();
    const hit = candidate();
    h.fire(hit);
    await settle();
    assert.equal(h.calls.load, 1);
    assert.equal(h.calls.mount, 1);
    h.fire(hit);
    await settle();
    assert.equal(h.calls.load, 1, "探针接管后应当已被摘掉");
  } finally {
    h.restore();
  }
});

// ★★ 塊接不到「把它拉下來的那一次」mouseover，所以薄殼必須把**指針座標**交過去，
//    由塊自己解析並立刻開卡。合成事件那條路已經廢棄：跨 realm 造事件脆，
//    而且合成事件還要再等 300ms 停留，體感仍然是「第一次懸停不彈」。
test("挂载时把指针坐标交给块", async () => {
  const h = shellHarness();
  try {
    h.feature.mount();
    h.fire(candidate(), { clientX: 210, clientY: 87 });
    await settle();
    assert.deepEqual(h.calls.mountOptions, { replayAt: { x: 210, y: 87 } });
  } finally {
    h.restore();
  }
});

test("块到达前已被释放则不再挂载", async () => {
  let release = null;
  const h = shellHarness({
    loadBundle: () =>
      new Promise((done) => {
        release = () =>
          done({ apiVersion: 1, createHoverCardFeature: () => ({ mount: () => () => {} }) });
      }),
  });
  try {
    const dispose = h.feature.mount();
    h.fire(candidate());
    await settle();
    dispose();
    release();
    await settle();
    assert.equal(h.calls.mount, 0);
  } finally {
    h.restore();
  }
});

test("加载器没接线时报错，不静默也不抛", async () => {
  const h = shellHarness({ loadBundle: null });
  try {
    h.feature.mount();
    h.fire(candidate());
    await settle();
    assert.equal(h.errors.length, 1);
    assert.match(String(h.errors[0].message), /未接线/);
  } finally {
    h.restore();
  }
});

// ★★★ owner 報了兩輪「第一次懸停不彈卡」。用**真 DOM** 端到端驗：薄殼把指針座標
//    交給塊，塊自己解析並**立刻**開卡 —— 不再補發合成事件（跨 realm 造事件脆，
//    而且合成事件仍要再等 300ms 停留，體感還是不彈）。
test("块接管时拿到的是指针坐标，不是补发的事件", async () => {
  const dom = new JSDOM(
    `<!doctype html><body><a id="pid" href="/problem/P1000">P1000</a></body>`,
    { url: "https://www.luogu.com.cn/" },
  );
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const anchor = dom.window.document.getElementById("pid");
  dom.window.document.elementFromPoint = () => anchor;
  const seen = [];
  let mountedWith = null;
  try {
    const features = createHoverCardFeatures({
      storage,
      loadBundle: () =>
        Promise.resolve({
          apiVersion: 1,
          createHoverCardFeature: () => ({
            mount: (options) => {
              mountedWith = options;
              const onOver = (event) => seen.push(event.target.id);
              dom.window.document.addEventListener("mouseover", onOver, true);
              return () =>
                dom.window.document.removeEventListener("mouseover", onOver, true);
            },
          }),
        }),
    });
    features.problem.mount();
    anchor.dispatchEvent(
      new dom.window.MouseEvent("mouseover", { bubbles: true, clientX: 40, clientY: 60 }),
    );
    await settle();
    await settle();
    assert.deepEqual(mountedWith, { replayAt: { x: 40, y: 60 } });
    // 反證：不該再有合成事件打到委託監聽上。
    assert.deepEqual(seen, [], "已经不走补发事件那条路了");
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
});

// ★ 補發要按**指針當前落點**取元素，不是當初那個 target：塊下載要幾百毫秒，
//   這中間指針很可能已經挪到別處了。挪到不是候選錨點的地方就什麼都不補。
test("块到达时指针已经离开候选锚点，就不补发", async () => {
  const dom = new JSDOM(
    `<!doctype html><body><a id="pid" href="/problem/P1000">P1000</a><p id="plain">x</p></body>`,
    { url: "https://www.luogu.com.cn/" },
  );
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const anchor = dom.window.document.getElementById("pid");
  // 指針已經移到普通段落上了。
  dom.window.document.elementFromPoint = () => dom.window.document.getElementById("plain");
  const seen = [];
  try {
    const features = createHoverCardFeatures({
      storage,
      loadBundle: () =>
        Promise.resolve({
          apiVersion: 1,
          createHoverCardFeature: () => ({
            mount: () => {
              const onOver = (event) => seen.push(event.target.id);
              dom.window.document.addEventListener("mouseover", onOver, true);
              return () =>
                dom.window.document.removeEventListener("mouseover", onOver, true);
            },
          }),
        }),
    });
    features.problem.mount();
    anchor.dispatchEvent(
      new dom.window.MouseEvent("mouseover", { bubbles: true, clientX: 1, clientY: 2 }),
    );
    await settle();
    await settle();
    assert.deepEqual(seen, [], "指针已经不在锚点上就不该凭空弹一张卡");
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
});

// ---- 結構守衛 ----
// 行為測試攔不住「宣告了卻沒人接」：測試注入的是自己的 loadBundle，
// 真實串接只要漏一處，功能就靜默消失而測試全綠。

test("应用根注册薄壳并接上加载器与同源 fetch", () => {
  const app = read("src/app/create-luogusp-app.js");
  assert.match(app, /hover-card\/lazy-feature\.js/);
  assert.doesNotMatch(app, /hover-card\/feature\.js/, "应用根直接引重机械会把块打回启动包");
  assert.match(app, /loadBundle: options\.hoverCardLoadBundle/);
  assert.match(app, /fetchPage: options\.hoverCardFetchPage/);
  // ★ owner 第四輪：拆成兩個開關，兩個都必須進 configurableFeatures，
  //   而且這個陣列的順序就是設定面板裡的順序。
  assert.match(app, /hoverCardFeatures\.problem,/);
  assert.match(app, /hoverCardFeatures\.user,/);
  const order = app
    .slice(app.indexOf("const configurableFeatures"), app.indexOf("const settingsFeature"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(",") && !line.includes("("))
    .map((line) => line.slice(0, -1));
  assert.deepEqual(order, [
    "problemColorFeature",
    "hoverCardFeatures.problem",
    "hoverCardFeatures.user",
    "hiddenIntroFeature",
    "restrictedContentFeature",
    "ideBatchFeature",
  ]);
});

test("runtime 入口接上加载器、声明导出契约、并给同源 fetch", () => {
  const entry = read("src/cdn/runtime-entry.js");
  assert.match(entry, /__LUOGUSP_HOVER_CARD_BUNDLE__/);
  assert.match(entry, /exports: \["createHoverCardFeature"\]/);
  assert.match(entry, /hoverCardLoadBundle:/);
  assert.match(entry, /hoverCardFetchPage:/);
  assert.match(entry, /credentials: "same-origin"/);
});

test("构建脚本把 hover 块写进 manifest 与 files，并注入 define", () => {
  const build = read("scripts/cdn/build.mjs");
  assert.match(build, /entryPoints: \["src\/cdn\/hover-card-bundle\.js"\]/);
  assert.match(build, /__LUOGUSP_HOVER_CARD_BUNDLE__: JSON\.stringify\(hoverCardBundle\)/);
  assert.match(build, /\[hoverCardFile\.path\]: hoverCardFile/);
  assert.match(build, /hoverCard: hoverCardBundle/);
});

// ★★ owner 2026-08-14 第四輪：滾輪捲動時指針還在卡裡，卡片卻消失了 —— 根因是
//    捲動處理器無條件 dismiss。卡片自己是可滾的（內容超高走 overflow:auto），
//    在卡裡滾本來就不該關它。這條是**行為守衛攔不住**的串接（捲動發生在真實瀏覽器裡），
//    所以用結構守衛盯住那兩個判據都在。
test("滚动时指针若还在卡片里就不许关卡", () => {
  const feature = read("src/features/hover-card/feature.js");
  assert.match(feature, /pointerInsideCard/, "必须有「指针是否在卡内」的判据");
  assert.match(feature, /elementFromPoint/, "滚动事件不带坐标，只能用最后落点去问");
  const handler = feature.slice(feature.indexOf("const onScroll"), feature.indexOf("const onKey"));
  assert.match(handler, /pointerInsideCard\(\)/, "onScroll 必须先问一句再决定关不关");
  assert.match(handler, /intent\.dismiss\(\)/);
});

test("a displayed user preview releases native ownership when disabled or disposed", async () => {
  const dom = new JSDOM('<a href="/user/123">User</a><div class="dropdown"><div class="float-card">Native</div></div>', { url: origin });
  const { document, MouseEvent, KeyboardEvent } = dom.window;
  const saved = { document: globalThis.document, window: globalThis.window, location: globalThis.location };
  Object.assign(globalThis, { document, window: dom.window, location: dom.window.location });
  const trigger = document.querySelector("a");
  const native = document.querySelector(".float-card");
  const nativeDisplay = () => dom.window.getComputedStyle(native).display;
  document.elementFromPoint = () => trigger;
  try {
    const features = createHoverCardFeatures({ storage, loadBundle: async () => ({ createHoverCardFeature }),
      fetchPage: async (url) => url === `${origin}/api/user/info/123`
        ? { ok: true, status: 200, redirected: false, url,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ user: { uid: 123, name: "Preview" } }) }
        : { ok: false, status: 403, json: async () => ({}) },
    });
    const stopProblem = features.problem.mount();
    const stopUser = features.user.mount();
    assert.notEqual(nativeDisplay(), "none");
    trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await settle();
    assert.equal(nativeDisplay(), "none");
    stopUser();
    assert.notEqual(nativeDisplay(), "none");
    assert.ok(document.querySelector("#luogusp-hover-card[hidden]"));
    const clearUser = features.user.mount();
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, altKey: true, key: "ArrowDown" }));
    await settle();
    assert.equal(nativeDisplay(), "none");
    stopProblem();
    clearUser();
    assert.notEqual(nativeDisplay(), "none");
    assert.equal(document.getElementById("luogusp-hover-card"), null);
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});

// ★ 卡片永遠不許出視口：高度由 placeCard 釘 max-height，內容再長也只在卡內滾。
test("卡片自身可滚，且高度由定位函数钉住", () => {
  const style = read("src/features/hover-card/style.js");
  assert.match(style, /overflow-y:auto/, "卡片要能自己滚");
  const view = read("src/features/hover-card/card-view.js");
  assert.match(view, /style\.maxHeight/, "定位时必须把可用高度写进 max-height");
});

// ★★★「永遠紅不了的門等於沒有門」。這道門原先只量正式版產物，canary 的可選塊
// 完全不在測量範圍內 —— 2026-08-14 因此把一個超預算 76 B 的塊發了出去，
// 而 `quality budgets passed` 照常列印。守衛盯住「canary 頻道也要被量」。
test("质量门必须把 canary 频道的可选块也量进来", () => {
  const quality = read("scripts/quality.mjs");
  assert.match(quality, /cdn\/channels\/canary\.json/, "不读 canary 频道就等于没量 canary");
  assert.match(quality, /canaryOptionalBundles/);
  assert.match(quality, /optionalBundleBudgetFailures\(report\.canaryOptionalBundles\.bundles/);
  const budget = { optionalHoverCard: { maxBytes: 199, maxGzipBytes: 89 } };
  const bundle = { bytes: 200, gzipBytes: 90 };
  assert.deepEqual(optionalBundleBudgetFailures({ hoverCard: bundle, other: bundle }, budget, true), [
    "canary hoverCard bytes 200 > 199",
    "canary hoverCard gzip bytes 90 > 89",
    "canary bundle other has no budget entry",
  ]);
});

test("预算、质量门与发布校验都认识这个新块", () => {
  const budget = JSON.parse(read("config/quality-budget.json"));
  assert.ok(budget.optionalHoverCard.maxBytes > 0);
  assert.ok(budget.optionalHoverCard.maxGzipBytes > 0);
  assert.match(read("scripts/quality.mjs"), /optionalHoverCard/);
  assert.match(read("scripts/cdn/verify-production.mjs"), /hover card bundle/);
  assert.match(read("scripts/publish-lib.mjs"), /hover card bundle/);
});

// ★ 鐵律：一切資料只從 .com.cn 或 api.luogu.me 取，絕不走國際站 www.luogu.com ——
// 普通使用者沒有代理，訪問不到。
test("hover 卡的取数一个字节都不碰国际站", () => {
  for (const file of [
    "src/features/hover-card/sources.js",
    "src/features/hover-card/feature.js",
    "src/features/hover-card/anchors.js",
    "src/features/hover-card/follow-action.js",
  ]) {
    const code = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // ★ 只剝**行首**的 // 註解。用 /\/\/[^\n]*/ 會把 `https://` 裡的 // 當成註解起點，
      //   連帶把整行刪掉 —— 而守衛要找的 URL 正好在那一行，於是門永遠紅不了。
      //   2026-08-13 就是這麼騙過自己一次：破壞完成實作了，守衛照綠。
      .replace(/^[ \t]*\/\/[^\n]*$/gm, "");
    assert.doesNotMatch(code, /www\.luogu\.com(?!\.cn)/, `${file} 不许出现国际站地址`);
  }
});
