import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHoverCardFeature } from "../src/features/hover-card/lazy-feature.js";
import {
  readCsrfToken,
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
function node({ tag = "A", href = null, src = null, parent = null } = {}) {
  const self = {
    tagName: tag,
    getAttribute: (name) => (name === "href" ? href : name === "src" ? src : null),
    parentElement: parent,
  };
  self.closest = (selector) => {
    let cursor = self;
    while (cursor) {
      const h = cursor.getAttribute("href");
      const s = cursor.getAttribute("src");
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

test("题号锚点解析出 pid", () => {
  const hit = resolveProblemAnchor(node({ href: "/problem/P3372" }), null);
  assert.equal(hit.kind, "problem");
  assert.equal(hit.pid, "P3372");
  assert.equal(hit.key, "problem:P3372");
  assert.equal(resolveProblemAnchor(node({ href: "/user/1" }), null), null);
  assert.equal(resolveProblemAnchor(null, null), null);
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
  assert.ok(placed.left + 320 <= 1280 - 8, "右边不许超出视口");
  assert.ok(placed.top >= 8, "上边不许超出视口");
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
    restore: () => {
      globalThis.document = originalDocument;
    },
  };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

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
    const hit = { closest: () => ({}) };
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
    h.fire({ closest: () => ({}) });
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
    h.fire({ closest: () => ({}) });
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
