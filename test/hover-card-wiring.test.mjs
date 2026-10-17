import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHoverCardFeatures } from "../src/features/hover-card/lazy-feature.js";
import {
  readCsrfToken,
  readPageSubject,
  readViewerUid,
  resolveHoverTarget,
  resolveProblemAnchor,
  resolveUserAnchor,
} from "../src/features/hover-card/anchors.js";
import { placeCard } from "../src/features/hover-card/card-view.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

// hover 卡是第三個按需塊（21517 B / gzip 8327 B）。啟動包裡只留一枚探針：
// 指針第一次碰到題號或使用者連結才把塊拉下來，絕大多數頁面瀏覽根本不觸發。

// ---- 錨點識別（最小 DOM 替身，只實作 closest / getAttribute / tagName）----
function node({ tag = "A", href = null, src = null, parent = null, chrome = null, title = null, cls = null, children = [] } = {}) {
  const self = {
    tagName: tag,
    getAttribute: (name) =>
      name === "href" ? href : name === "src" ? src : name === "title" ? title : null,
    parentElement: parent,
    // 只實作測試用得到的那點查詢：按 usericon 找後代頭像。
    querySelectorAll: (selector) =>
      selector.includes("usericon")
        ? children.filter((c) => (c.getAttribute("src") || "").includes("/upload/usericon/"))
        : [],
    // 站台框架標記：".top-bar" / ".lside" / ".rside" 之一，模擬真機上的祖先容器。
    chrome,
  };
  self.closest = (selector) => {
    let cursor = self;
    while (cursor) {
      const h = cursor.getAttribute("href");
      const s = cursor.getAttribute("src");
      if (cursor.chrome && selector.includes(cursor.chrome)) return cursor;
      if (selector.includes('/problem/') && h && h.includes("/problem/")) return cursor;
      if (selector.includes('/user/') && h && h.includes("/user/")) return cursor;
      if (selector === "img" && cursor.tagName === "IMG") return cursor;
      if (selector.includes("usericon") && s && s.includes("/upload/usericon/")) return cursor;
      if (selector.includes(".pid[title]") && cursor.getAttribute("title")) return cursor;
      cursor = cursor.parentElement;
    }
    return null;
  };
  self.dataset = {};
  return self;
}

// problem-color 的解析器才是唯一權威（它檢核 pid 含字母+數字、路徑恰好是 /problem/{id}、
// 錨點文字真的顯示該 pid）。這裡只認它的結果。
const identityOf = (pid) => ({ resolve: () => (pid ? { pid } : null) });

test("题号锚点解析出 pid", () => {
  const hit = resolveProblemAnchor(node({ href: "/problem/P3372" }), identityOf("P3372"));
  assert.equal(hit.kind, "problem");
  assert.equal(hit.pid, "P3372");
  assert.equal(hit.key, "problem:P3372");
  assert.equal(resolveProblemAnchor(node({ href: "/user/1" }), identityOf("P3372")), null);
  assert.equal(resolveProblemAnchor(null, identityOf("P3372")), null);
});

// ★ canary.14 過度修復：我把判據全交給 problem-color 的解析器，而它額外要求
// 「錨點文字真的顯示該 pid」—— 那是為**著色**設計的。題庫列表裡題目連結的文字是**題名**，
// 於是題庫裡的題目反而不彈卡了。href 的 path 恰好是 /problem/{pid} 就該彈。
test("题库列表里按题名链接的行也要弹卡", () => {
  const row = node({ href: "/problem/P3372" });
  const hit = resolveProblemAnchor(row, identityOf(null));
  assert.equal(hit && hit.pid, "P3372", "解析器认不出时应当退回 href 的 path");
});

// ★ canary.13 真機迴歸：題庫導覽（/problem/list）與 TAG 膠囊
// （/problem/list?tag=N）都被松正則當成了 pid=`list`，於是到處彈卡。
test("题库导航与 TAG 胶囊不得被当成题号", () => {
  // path 恰好是 /problem/list（query 不參與），而 `list` 不含數字 → 出局。
  for (const href of ["/problem/list", "/problem/list?tag=42", "/problem/new", "/problem/solution/P1000"])
    assert.equal(resolveProblemAnchor(node({ href }), identityOf(null)), null, href);
  // 解析器就算被餵了這些路徑段也要擋住。
  for (const fake of ["list", "solution", "new"])
    assert.equal(resolveProblemAnchor(node({ href: "/problem/list" }), identityOf(fake)), null, fake);
  // 帶 query 的真題號仍然要認（比賽內跳轉會帶 contestId）。
  const hit = resolveProblemAnchor(node({ href: "/problem/P1000?contestId=1" }), identityOf(null));
  assert.equal(hit && hit.pid, "P1000");
});

test("用户名链接解析出 uid", () => {
  const hit = resolveUserAnchor(node({ href: "/user/697932" }));
  assert.equal(hit.uid, 697932);
  assert.equal(hit.key, "user:697932");
});

// ★ owner 要求：使用者名和頭像都要出卡。頭像常常不在 <a> 裡（列表項自己處理點擊），
// 所以要能從頭像 URL 裡的 uid 備援。
test("头像也能出卡：从 usericon URL 取 uid", () => {
  const avatar = node({
    tag: "IMG",
    src: "https://cdn.luogu.com.cn/upload/usericon/1313427.png",
  });
  const hit = resolveUserAnchor(avatar);
  assert.equal(hit.kind, "user");
  assert.equal(hit.uid, 1313427);
});

test("用户优先于题号，避免讨论区行内误判", () => {
  const row = node({ href: "/problem/P1000" });
  const name = node({ href: "/user/1", parent: row });
  assert.equal(resolveHoverTarget(name, null).kind, "user");
});

// ★★ owner 2026-08-14 報的誤彈，三條裡有兩條落在站台框架上。真機 DOM 實測：
//   頂欄 `div.top-bar` 裡同時裝著**左上角題號**（麵包屑）和**我自己的頭像**；
//   「個人中心」選單在 `div.user-nav.rside`，它是 **.top-bar 的兄弟節點**，
//   只排除 .top-bar 會整個漏掉 —— 這條是本輪最容易寫漏的。
test("站点框架里的锚点一律不出卡", () => {
  // ★ `.user-nav` 是真機掃出來補上的：**首頁是舊版頁**，它的使用者選單是
  //   `nav.user-nav`，根本不在 `.top-bar` 裡 —— 只按新版 DOM 寫判據會漏掉一整類頁面。
  for (const chrome of [".top-bar", ".lside", ".rside", ".user-nav"]) {
    const bar = node({ tag: "DIV", chrome });
    const pid = node({ href: "/problem/P1001", parent: bar });
    const me = node({ href: "/user/116524", parent: bar });
    const avatar = node({
      tag: "IMG",
      src: "https://cdn.luogu.com.cn/upload/usericon/116524.png",
      parent: bar,
    });
    for (const target of [pid, me, avatar])
      assert.equal(resolveHoverTarget(target, null, null), null, chrome);
  }
  // 反過來：正文裡同樣的連結照常出卡，別把排除寫成全域。
  assert.equal(resolveHoverTarget(node({ href: "/user/116524" }), null, null).kind, "user");
});

// ★ owner：頁面自己講的那個人 / 那道題不出卡（個人頁的大頭像、題目頁指回本題的連結），
// 但「推薦題目」是別的 pid，必須照常出卡。
test("页面主体自己不出卡，同页别的目标照出", () => {
  const onUser = readPageSubject("/user/116524/practice");
  assert.equal(resolveHoverTarget(node({ href: "/user/116524" }), null, onUser), null);
  assert.equal(
    resolveHoverTarget(
      node({ tag: "IMG", src: "https://cdn.luogu.com.cn/upload/usericon/116524.png" }),
      null,
      onUser,
    ),
    null,
  );
  assert.equal(resolveHoverTarget(node({ href: "/user/697932" }), null, onUser).uid, 697932);
  // 主體是使用者時不該誤傷題號。
  assert.equal(
    resolveHoverTarget(node({ href: "/problem/P1001" }), null, onUser).pid,
    "P1001",
  );

  const onProblem = readPageSubject("/problem/P1001");
  assert.equal(resolveHoverTarget(node({ href: "/problem/P1001" }), null, onProblem), null);
  assert.equal(
    resolveHoverTarget(node({ href: "/problem/P1002" }), null, onProblem).pid,
    "P1002",
    "推荐题目必须留着",
  );
});

test("页面主体解析只认真正的 uid / pid", () => {
  assert.deepEqual(readPageSubject("/problem/P1001"), { kind: "problem", pid: "P1001" });
  assert.deepEqual(readPageSubject("/user/1313427"), { kind: "user", uid: 1313427 });
  assert.deepEqual(readPageSubject("/user/1313427/practice"), { kind: "user", uid: 1313427 });
  // 這些路徑段不是 pid，沒有主體 —— 否則會把一整類頁面的卡全關掉。
  for (const path of [
    "/problem/list",
    "/problem/list?tag=42",
    "/problem/solution/P1000",
    "/problem/new",
    "/user/setting",
    "/user/notification",
    "/",
    "",
    null,
  ])
    assert.equal(readPageSubject(path), null, String(path));
});

// ★★★ owner 2026-08-14 第五輪：題庫裡懸停題號不該出卡，而且它「和難度著色衝突」。
//    同一個根因：題庫每行的題號是 `div.pid[title="P1000"]`，而 problem-color
//    正是靠這個 title 認題；我們為了滅原生浮泡會把 title 摘掉，著色當場失效。
//    所以 `.pid[title]` 整個從錨點判據裡拿掉。
test("题号格 .pid[title] 不再出卡（题库的着色靠那个 title）", () => {
  const cell = node({ tag: "DIV", title: "P1000", cls: "pid" });
  assert.equal(resolveProblemAnchor(cell, identityOf("P1000")), null);
  assert.equal(resolveHoverTarget(cell, identityOf("P1000"), null), null);
  // 反證：同一行的**題名連結**必須照常出卡（canary.14 專門修過這條）。
  assert.equal(
    resolveHoverTarget(node({ href: "/problem/P1000" }), identityOf(null), null).pid,
    "P1000",
  );
});

// ★ owner：私信「最近聯繫」列表裡懸停使用者名沒反應。真機 DOM：整行只有頭像帶 uid，
//   名字是個純 span。所以按行備援 —— 但**只在 /chat 上**，別的頁面同形狀會導致誤彈。
test("私信页按行兜底取头像的 uid，且只在 /chat 生效", () => {
  const avatar = node({
    tag: "IMG",
    src: "https://cdn.luogu.com.cn/upload/usericon/2020479.png",
  });
  const row = node({ tag: "DIV", children: [avatar] });
  const name = node({ tag: "SPAN", parent: row });
  assert.equal(resolveHoverTarget(name, null, null, "/chat").uid, 2020479);
  // 反證：換個頁面就不許備援。
  for (const path of ["/discuss", "/article/xxx", "/", undefined])
    assert.equal(resolveHoverTarget(name, null, null, path), null, String(path));
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
  // ★ 薄殼現在**按頁面**決定加不載入，所以替身要能回答「這一頁上有什麼」。
  //   `pageNodes` 裡每個元素都帶一個 `chrome` 標記（在不在站台框架裡）。
  const pageNodes = options.pageNodes === undefined ? [candidate()] : options.pageNodes;
  globalThis.document = {
    body: {},
    querySelectorAll: () => pageNodes,
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
    hasProbe: () => listeners.has("mouseover"),
    restore: () => {
      globalThis.document = originalDocument;
    },
  };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

// 候選錨點替身：命中候選選擇器，但不在站台框架裡。
const candidate = () => ({
  closest: (selector) => (selector.includes("/problem/") ? {} : null),
});
// 頂欄裡的錨點替身：兩個選擇器都命中。
const chromeCandidate = () => ({ closest: () => ({}) });
// candidate() 的 closest 只對候選選擇器命中、對框架選擇器回傳 null，
// 所以它同時充當「正文裡的候選元素」。

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

// ★★★ owner 報了兩輪「懸停使用者名不彈，蹭一下頭像才彈」。根因不在解析層，在這裡：
//    薄殼看不見的元素，塊**永遠沒機會載入**。私信頁的使用者名就是個裸 span。
//    所以判據從「指針壓在候選上」改成「**這一頁有沒有可預覽的東西**」。
test("指针压在裸元素上也照拉：只要这一页有可预览的东西", async () => {
  const h = shellHarness();
  try {
    h.feature.mount();
    // 私信頁的使用者名替身：什麼選擇器都不匹配。
    h.fire({ closest: () => null });
    await settle();
    assert.equal(h.calls.load, 1, "裸 span 也必须能把块拉下来");
    assert.equal(h.calls.mount, 1);
  } finally {
    h.restore();
  }
});

// 反過來：這一頁壓根沒有可預覽的東西，就一個位元組都不拉 —— 按需載入的意義還在。
test("整页没有可预览的东西就不拉块", async () => {
  const h = shellHarness({ pageNodes: [] });
  try {
    h.feature.mount();
    h.fire({ closest: () => null });
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
  const h = shellHarness({ pageNodes: [chromeCandidate()] });
  try {
    h.feature.mount();
    h.fire(chromeCandidate());
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

// ★★ owner 2026-08-14 第四輪：滾輪捲動時指針還在卡里，卡片卻消失了 —— 根因是
//    捲動處理器無條件 dismiss。卡片自己是可滾的（內容超高走 overflow:auto），
//    在卡里滾本來就不該關它。這條是**行為守衛攔不住**的串接（捲動發生在真實瀏覽器裡），
//    所以用結構守衛盯住那兩個判據都在。
test("滚动时指针若还在卡片里就不许关卡", () => {
  const feature = read("src/features/hover-card/feature.js");
  assert.match(feature, /pointerInsideCard/, "必须有「指针是否在卡内」的判据");
  assert.match(feature, /elementFromPoint/, "滚动事件不带坐标，只能用最后落点去问");
  const handler = feature.slice(feature.indexOf("const onScroll"), feature.indexOf("const onKey"));
  assert.match(handler, /pointerInsideCard\(\)/, "onScroll 必须先问一句再决定关不关");
  assert.match(handler, /intent\.dismiss\(\)/);
});

// ★★ owner 第五輪：文章廣場、討論區、提交記錄、題目頁出題人……原生個人卡到處和
//    我們的卡一起彈。原生那張是 teleport 到 `#app` 的 `div.dropdown`，裡面裝
//    `class="float-card"` 的卡體（`DropdownWrapper` 與 `UserFloatCard` 元件原文）。
//    用 CSS 藏掉，不去掐事件 —— 掐事件會連帶影響那棵子樹上別人的 mouseover。
test("用户卡开着时屏蔽原生个人卡，关掉就还回去", () => {
  const shell = read("src/features/hover-card/lazy-feature.js");
  assert.match(shell, /float-card/, "得按原生卡自己的类名认");
  assert.match(shell, /suppressNativeCard/);
  // 只有使用者卡這一類才屏蔽：題目卡開著不該動原生的個人卡。
  const mountFor = shell.slice(shell.indexOf("const mountFor"), shell.indexOf("return Object.freeze"));
  assert.match(mountFor, /kind === "user"/);
  assert.match(mountFor, /suppressNativeCard\(true\)/);
  assert.match(mountFor, /suppressNativeCard\(false\)/, "关掉开关必须把原生卡还回去");
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
  assert.match(quality, /`canary \$\{name\} bytes/, "超预算必须点名是哪个块");
  // 新增一個塊卻忘了配預算，必須報出來而不是靜默跳過。
  assert.match(quality, /has no budget entry/);
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
