import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRestrictedContentFeature } from "../src/features/restricted-content/lazy-feature.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

// 「显示受限文章与剪贴板」原本是启动包里最大的一块（实测 44506 B，占 121348 B 的 37%），
// 却只在洛谷「安全访问中心」拦截页上才用得到，把所有人的每次页面加载都拖慢了。
// 拆分后启动包 83321 B（预算 120000，余量 36679），重机械 44291 B / gzip 16236 B 按需拉。

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
  assert.equal(feature.label, "显示受限文章与剪贴板");
  assert.equal(feature.storageKey, "LuoguSP.showRestrictedContent");
  assert.equal(calls.load, 0);
});

// ★ 这就是本次拆分的全部意义：普通页面一个字节都不该拉。
test("不是拦截页时一个字节都不拉", async () => {
  for (const page of [
    { title: "首页 - 洛谷" }, // 标题不匹配
    { path: "/problem/P1001" }, // 路由不匹配
    { target: "https://www.luogu.com/article/别的文章" }, // pre#url 指向别处
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

// ★ mount 同步返回、块异步到达 —— 中间被 dispose 了就不许再挂上去。
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
  await settle(); // loadBundle 走在微任务上，等它真的被调用
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

// ★ 没人接线就等于功能不存在，必须报出来 —— 静默会把它伪装成「功能没做」。
test("加载器没接线时报错，不静默也不抛", async () => {
  const { feature, errors } = harness({ loadBundle: null });
  const dispose = feature.mount({ isCurrent: () => true });
  await settle();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0].message), /未接线/);
  dispose();
});

// 加载层必须留在启动包并同步起手，否则拦截页会闪一下原始内容。
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

// ---- 结构守卫 ----
// 行为测试拦不住「声明了却没人接」：只要有一处接线漏了，功能就静默消失，
// 而所有行为测试仍然全绿（它们注入的是自己的 loadBundle）。

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
