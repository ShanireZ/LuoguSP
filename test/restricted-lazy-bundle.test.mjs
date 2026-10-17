import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRestrictedContentFeature } from "../src/features/restricted-content/lazy-feature.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

// 「顯示受限文章與剪貼板」原本是啟動包裡最大的一塊（實測 44506 B，佔 121348 B 的 37%），
// 卻只在洛谷「安全訪問中心」攔截頁上才用得到，把所有人的每次頁面載入都拖慢了。
// 拆分後啟動包 83321 B（預算 120000，餘量 36679），重機械 44291 B / gzip 16236 B 按需拉。

const storage = { get: () => true, set: () => {} };

function pageAdapter({ path = "/article/2l4x53kj", title = "安全访问中心 - 洛谷", target = null } = {}) {
  return {
    path: () => path,
    title: () => title,
    target: () => (target === null ? `https://www.luogu.com/article/2l4x53kj` : target),
  };
}

function harness(options = {}) {
  const calls = { load: 0, mount: 0, dispose: 0, onRoute: 0 };
  const errors = [];
  const inner = {
    id: "restricted-document",
    mount: () => {
      calls.mount += 1;
      return () => void (calls.dispose += 1);
    },
    onRoute: () => void (calls.onRoute += 1),
  };
  const feature = createRestrictedContentFeature({
    storage,
    restrictedLoadingGate: options.gate,
    getPageLifecycle: () => null,
    pageAdapter: pageAdapter(options.page),
    logError: (error) => errors.push(error),
    loadBundle:
      options.loadBundle === null
        ? undefined
        : options.loadBundle ||
          (() => {
            calls.load += 1;
            return Promise.resolve({
              apiVersion: 1,
              createRestrictedContentFeature: () => inner,
            });
          }),
  });
  return { feature, calls, errors };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

test("功能描述符不加载重机械就能给设置页用", () => {
  const { feature, calls } = harness();
  assert.equal(feature.id, "restricted-document");
  assert.equal(feature.key, "showRestrictedContent");
  assert.equal(feature.label, "受限文章与剪贴板解限");
  assert.equal(feature.storageKey, "LuoguSP.showRestrictedContent");
  assert.equal(calls.load, 0);
});

// ★ 這就是本次拆分的全部意義：普通頁面一個位元組都不該拉。
test("不是拦截页时一个字节都不拉", async () => {
  for (const page of [
    { title: "首页 - 洛谷" }, // 標題不匹配
    { path: "/problem/P1001" }, // 路由不匹配
    { target: "https://www.luogu.com/article/别的文章" }, // pre#url 指向別處
  ]) {
    const { feature, calls } = harness({ page });
    const dispose = feature.mount({ isCurrent: () => true });
    await settle();
    assert.equal(calls.load, 0, JSON.stringify(page));
    assert.equal(calls.mount, 0, JSON.stringify(page));
    assert.equal(typeof dispose, "function");
    dispose();
  }
});

test("拦截页才按需加载并把 mount 交给块里的实现", async () => {
  const { feature, calls } = harness();
  const dispose = feature.mount({ isCurrent: () => true });
  assert.equal(typeof dispose, "function", "mount 必须同步返回 disposer");
  await settle();
  assert.equal(calls.load, 1);
  assert.equal(calls.mount, 1);
  dispose();
  assert.equal(calls.dispose, 1);
});

// ★ mount 同步回傳、塊非同步到達 —— 中間被 dispose 了就不許再掛上去。
test("块到达前已被释放则不再挂载", async () => {
  let release = null;
  const { feature, calls } = harness({
    loadBundle: () =>
      new Promise((done) => {
        release = () =>
          done({ apiVersion: 1, createRestrictedContentFeature: () => ({ mount: () => () => {} }) });
      }),
  });
  const dispose = feature.mount({ isCurrent: () => true });
  await settle(); // loadBundle 走在微任務上，等它真的被呼叫
  assert.equal(typeof release, "function");
  dispose();
  release();
  await settle();
  assert.equal(calls.mount, 0);
});

test("块只加载一次，重复 mount 共享同一份", async () => {
  const { feature, calls } = harness();
  feature.mount({ isCurrent: () => true });
  feature.mount({ isCurrent: () => true });
  await settle();
  assert.equal(calls.load, 1);
  assert.equal(calls.mount, 2);
});

test("加载失败只报一次，不反复重试", async () => {
  let attempts = 0;
  const { feature, errors } = harness({
    loadBundle: () => {
      attempts += 1;
      return Promise.reject(new Error("CDN 不可达"));
    },
  });
  feature.mount({ isCurrent: () => true });
  await settle();
  feature.mount({ isCurrent: () => true });
  await settle();
  assert.equal(attempts, 1);
  assert.equal(errors.length, 1);
});

// ★ 沒人串接就等於功能不存在，必須報出來 —— 靜默會把它偽裝成「功能沒做」。
test("加载器没接线时报错，不静默也不抛", async () => {
  const { feature, errors } = harness({ loadBundle: null });
  const dispose = feature.mount({ isCurrent: () => true });
  await settle();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0].message), /未接线/);
  dispose();
});

// 載入層必須留在啟動包並同步起手，否則攔截頁會閃一下原始內容。
test("onRoute 同步起加载层，且不为此把块拉下来", async () => {
  let started = 0;
  const { feature, calls } = harness({ gate: { start: () => void (started += 1) } });
  feature.onRoute();
  await settle();
  assert.equal(started, 1);
  assert.equal(calls.load, 0);
  assert.equal(calls.onRoute, 0);
});

test("块加载过之后 onRoute 才转发给它", async () => {
  const { feature, calls } = harness({ gate: { start: () => {} } });
  feature.mount({ isCurrent: () => true });
  await settle();
  feature.onRoute();
  assert.equal(calls.onRoute, 1);
});

// ---- 結構守衛 ----
// 行為測試攔不住「宣告了卻沒人接」：只要有一處串接漏了，功能就靜默消失，
// 而所有行為測試仍然全綠（它們注入的是自己的 loadBundle）。

test("应用根引的是薄壳，不是重机械", () => {
  const app = read("src/app/create-luogusp-app.js");
  assert.match(app, /restricted-content\/lazy-feature\.js/);
  assert.doesNotMatch(
    app,
    /restricted-content\/feature\.js/,
    "应用根一旦直接引重机械，整块又会被打回启动包",
  );
  assert.match(app, /loadBundle: options\.restrictedContentLoadBundle/);
});

test("runtime 入口把加载器接上，并声明块的导出契约", () => {
  const entry = read("src/cdn/runtime-entry.js");
  assert.match(entry, /__LUOGUSP_RESTRICTED_CONTENT_BUNDLE__/);
  assert.match(entry, /restrictedContentLoadBundle:/);
  assert.match(entry, /exports: \["createRestrictedContentFeature"\]/);
});

test("按需块入口导出工厂与 apiVersion", () => {
  const bundle = read("src/cdn/restricted-content-bundle.js");
  assert.match(bundle, /export \{ createRestrictedContentFeature \}/);
  assert.match(bundle, /export const apiVersion = 1/);
});

test("构建脚本把块写进 manifest.optionalBundles 与 files，并注入 define", () => {
  const build = read("scripts/cdn/build.mjs");
  assert.match(build, /entryPoints: \["src\/cdn\/restricted-content-bundle\.js"\]/);
  assert.match(build, /__LUOGUSP_RESTRICTED_CONTENT_BUNDLE__: JSON\.stringify\(/);
  assert.match(build, /\[restrictedContentFile\.path\]: restrictedContentFile/);
  assert.match(build, /restrictedContent: restrictedContentBundle/);
});

// ★ canary.10 真機迴歸：早期載入層在 document-start 就用
// `body>*{visibility:hidden}` 遮住了**所有** /article/*、/paste/* 頁面，
// 舊程式碼由 document-boot 在探測失敗時釋放。薄殼提前 return 卻忘了釋放，
// 結果每一個正常文章/剪貼板頁面都被永久遮成空白。
test("不是拦截页时必须放掉早期加载层，否则正常文章页会一直空白", async () => {
  let released = 0;
  const gate = { start: () => {}, release: () => void (released += 1) };
  const { feature, calls } = harness({ gate, page: { title: "GenGen 洛谷国际 - 洛谷专栏" } });
  const dispose = feature.mount({ isCurrent: () => true });
  await settle();
  assert.equal(released, 1, "探测失败必须 release，页面才看得见");
  assert.equal(calls.load, 0);
  dispose();
});

// ★ canary.10 真機迴歸：`TypeError: Illegal invocation`。
// `{ setTimeout, clearTimeout }` 簡寫會讓 `clock.setTimeout(...)` 以 `this === clock`
// 呼叫原生方法。在使用者指令碼沙箱裡僥倖能過；一旦模組隨按需塊經 blob: 動態 import
// 在**頁面 realm** 執行，原生方法就會拒絕這個 this。
// 行為測試攔不住它（測試都注入自己的時鐘），所以只能結構守衛。
test("源码里不得出现裸引用全局定时器的简写", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.name.endsWith(".js")) {
        const text = read(relative);
        // 只匹配真的賦值 / 屬性位置（`clock = {…}`、`clock: {…}`），
        // 否則會誤報到講這條坑的註解文字上。
        if (/[=:]\s*\{\s*setTimeout\s*,\s*clearTimeout\s*\}/.test(text))
          offenders.push(relative);
      }
    }
  };
  walk("src");
  assert.deepEqual(
    offenders,
    [],
    `这些文件用了简写，在页面 realm 会 Illegal invocation：${offenders.join(", ")}`,
  );
});
