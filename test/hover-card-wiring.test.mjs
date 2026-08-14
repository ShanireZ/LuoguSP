import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHoverCardFeature } from "../src/features/hover-card/lazy-feature.js";
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

// hover 卡是第三个按需块（21517 B / gzip 8327 B）。启动包里只留一枚探针：
// 指针第一次碰到题号或用户链接才把块拉下来，绝大多数页面浏览根本不触发。

// ---- 锚点识别（最小 DOM 替身，只实现 closest / getAttribute / tagName）----
function node({ tag = "A", href = null, src = null, parent = null, chrome = null } = {}) {
  const self = {
    tagName: tag,
    getAttribute: (name) => (name === "href" ? href : name === "src" ? src : null),
    parentElement: parent,
    // 站点框架标记：".top-bar" / ".lside" / ".rside" 之一，模拟真机上的祖先容器。
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
      cursor = cursor.parentElement;
    }
    return null;
  };
  self.dataset = {};
  return self;
}

// problem-color 的解析器才是唯一权威（它校验 pid 含字母+数字、路径恰好是 /problem/{id}、
// 锚点文本真的显示该 pid）。这里只认它的结果。
const identityOf = (pid) => ({ resolve: () => (pid ? { pid } : null) });

test("题号锚点解析出 pid", () => {
  const hit = resolveProblemAnchor(node({ href: "/problem/P3372" }), identityOf("P3372"));
  assert.equal(hit.kind, "problem");
  assert.equal(hit.pid, "P3372");
  assert.equal(hit.key, "problem:P3372");
  assert.equal(resolveProblemAnchor(node({ href: "/user/1" }), identityOf("P3372")), null);
  assert.equal(resolveProblemAnchor(null, identityOf("P3372")), null);
});

// ★ canary.14 过度修复：我把判据全交给 problem-color 的解析器，而它额外要求
// 「锚点文本真的显示该 pid」—— 那是为**着色**设计的。题库列表里题目链接的文本是**题名**，
// 于是题库里的题目反而不弹卡了。href 的 path 恰好是 /problem/{pid} 就该弹。
test("题库列表里按题名链接的行也要弹卡", () => {
  const row = node({ href: "/problem/P3372" });
  const hit = resolveProblemAnchor(row, identityOf(null));
  assert.equal(hit && hit.pid, "P3372", "解析器认不出时应当退回 href 的 path");
});

// ★ canary.13 真机回归：题库导航（/problem/list）与 TAG 胶囊
// （/problem/list?tag=N）都被松正则当成了 pid=`list`，于是到处弹卡。
test("题库导航与 TAG 胶囊不得被当成题号", () => {
  // path 恰好是 /problem/list（query 不参与），而 `list` 不含数字 → 出局。
  for (const href of ["/problem/list", "/problem/list?tag=42", "/problem/new", "/problem/solution/P1000"])
    assert.equal(resolveProblemAnchor(node({ href }), identityOf(null)), null, href);
  // 解析器就算被喂了这些路径段也要挡住。
  for (const fake of ["list", "solution", "new"])
    assert.equal(resolveProblemAnchor(node({ href: "/problem/list" }), identityOf(fake)), null, fake);
  // 带 query 的真题号仍然要认（比赛内跳转会带 contestId）。
  const hit = resolveProblemAnchor(node({ href: "/problem/P1000?contestId=1" }), identityOf(null));
  assert.equal(hit && hit.pid, "P1000");
});

test("用户名链接解析出 uid", () => {
  const hit = resolveUserAnchor(node({ href: "/user/697932" }));
  assert.equal(hit.uid, 697932);
  assert.equal(hit.key, "user:697932");
});

// ★ owner 要求：用户名和头像都要出卡。头像常常不在 <a> 里（列表项自己处理点击），
// 所以要能从头像 URL 里的 uid 兜底。
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

// ★★ owner 2026-08-14 报的误弹，三条里有两条落在站点框架上。真机 DOM 实测：
//   顶栏 `div.top-bar` 里同时装着**左上角题号**（面包屑）和**我自己的头像**；
//   「个人中心」菜单在 `div.user-nav.rside`，它是 **.top-bar 的兄弟节点**，
//   只排除 .top-bar 会整个漏掉 —— 这条是本轮最容易写漏的。
test("站点框架里的锚点一律不出卡", () => {
  // ★ `.user-nav` 是真机扫出来补上的：**首页是旧版页**，它的用户菜单是
  //   `nav.user-nav`，根本不在 `.top-bar` 里 —— 只按新版 DOM 写判据会漏掉一整类页面。
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
  // 反过来：正文里同样的链接照常出卡，别把排除写成全局。
  assert.equal(resolveHoverTarget(node({ href: "/user/116524" }), null, null).kind, "user");
});

// ★ owner：页面自己讲的那个人 / 那道题不出卡（个人页的大头像、题目页指回本题的链接），
// 但「推荐题目」是别的 pid，必须照常出卡。
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
  // 主体是用户时不该误伤题号。
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
  // 这些路径段不是 pid，没有主体 —— 否则会把一整类页面的卡全关掉。
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

test("读不到登录态就当匿名", () => {
  const doc = {
    getElementById: () => ({ textContent: JSON.stringify({ user: { uid: 1313427 } }) }),
    querySelector: () => ({ getAttribute: () => "tok" }),
  };
  assert.equal(readViewerUid(doc, {}), 1313427);
  assert.equal(readCsrfToken(doc), "tok");
  // lentille 形状漂移 → 退回旧版 _feInjection → 都没有就是匿名。
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

// ---- 薄壳行为 ----
const storage = { get: () => true, set: () => {} };

function shellHarness(options = {}) {
  const listeners = new Map();
  const calls = { load: 0, mount: 0, dispose: 0 };
  const errors = [];
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {},
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const feature = createHoverCardFeature({
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
                mount: () => {
                  calls.mount += 1;
                  return () => void (calls.dispose += 1);
                },
              }),
            });
          }),
  });
  return {
    feature,
    calls,
    errors,
    fire: (target) => {
      const probe = listeners.get("mouseover");
      if (probe) probe({ target });
    },
    hasProbe: () => listeners.has("mouseover"),
    restore: () => {
      globalThis.document = originalDocument;
    },
  };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

// 候选锚点替身：命中候选选择器，但不在站点框架里。
const candidate = () => ({
  closest: (selector) => (selector.includes("/problem/") ? {} : null),
});
// 顶栏里的锚点替身：两个选择器都命中。
const chromeCandidate = () => ({ closest: () => ({}) });

test("描述符不加载块就能给设置页用", () => {
  const h = shellHarness();
  try {
    assert.equal(h.feature.key, "showHoverCards");
    assert.equal(h.feature.label, "题号与用户悬停预览卡");
    assert.equal(h.calls.load, 0);
  } finally {
    h.restore();
  }
});

// ★ 这就是拆成按需块的意义：指针没碰到候选锚点，一个字节都不拉。
test("指针没碰到候选锚点就不拉块", async () => {
  const h = shellHarness();
  try {
    h.feature.mount();
    h.fire({ closest: () => null });
    await settle();
    assert.equal(h.calls.load, 0);
    assert.equal(h.calls.mount, 0);
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

// ★ 站点框架里的锚点永远不会出卡，连块都不该为它们拉下来。
test("顶栏 / 抽屉里的锚点不触发拉块", async () => {
  const h = shellHarness();
  try {
    h.feature.mount();
    h.fire(chromeCandidate());
    await settle();
    assert.equal(h.calls.load, 0);
    assert.equal(h.hasProbe(), true, "探针不能被框架锚点白白摘掉");
    // 换成正文里的锚点，仍然要拉。
    h.fire(candidate());
    await settle();
    assert.equal(h.calls.load, 1);
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

// ---- 结构守卫 ----
// 行为测试拦不住「声明了却没人接」：测试注入的是自己的 loadBundle，
// 真实接线只要漏一处，功能就静默消失而测试全绿。

test("应用根注册薄壳并接上加载器与同源 fetch", () => {
  const app = read("src/app/create-luogusp-app.js");
  assert.match(app, /hover-card\/lazy-feature\.js/);
  assert.doesNotMatch(app, /hover-card\/feature\.js/, "应用根直接引重机械会把块打回启动包");
  assert.match(app, /loadBundle: options\.hoverCardLoadBundle/);
  assert.match(app, /fetchPage: options\.hoverCardFetchPage/);
  assert.match(app, /hoverCardFeature,/, "功能没进 configurableFeatures 就不会被挂载，也不会出现在设置里");
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

test("预算、质量门与发布校验都认识这个新块", () => {
  const budget = JSON.parse(read("config/quality-budget.json"));
  assert.ok(budget.optionalHoverCard.maxBytes > 0);
  assert.ok(budget.optionalHoverCard.maxGzipBytes > 0);
  assert.match(read("scripts/quality.mjs"), /optionalHoverCard/);
  assert.match(read("scripts/cdn/verify-production.mjs"), /hover card bundle/);
  assert.match(read("scripts/publish-lib.mjs"), /hover card bundle/);
});

// ★ 铁律：一切数据只从 .com.cn 或 api.luogu.me 取，绝不走国际站 www.luogu.com ——
// 普通用户没有代理，访问不到。
test("hover 卡的取数一个字节都不碰国际站", () => {
  for (const file of [
    "src/features/hover-card/sources.js",
    "src/features/hover-card/feature.js",
    "src/features/hover-card/anchors.js",
    "src/features/hover-card/follow-action.js",
  ]) {
    const code = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // ★ 只剥**行首**的 // 注释。用 /\/\/[^\n]*/ 会把 `https://` 里的 // 当成注释起点，
      //   连带把整行删掉 —— 而守卫要找的 URL 正好在那一行，于是门永远红不了。
      //   2026-08-13 就是这么骗过自己一次：破坏落地了，守卫照绿。
      .replace(/^[ \t]*\/\/[^\n]*$/gm, "");
    assert.doesNotMatch(code, /www\.luogu\.com(?!\.cn)/, `${file} 不许出现国际站地址`);
  }
});
