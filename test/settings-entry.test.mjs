import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createSettingsFeature } from "../src/features/settings/feature.js";

// Luogu's left navigation renders in three shapes. The columba sidebar keeps its
// `sidebar` class only while it is pinned open; narrowing the viewport collapses
// it to `nav.lside.drawer`, which used to lose the entry entirely.
const NAV_SHAPES = [
  ["旧版竖排栏", "lfe-body", "插件设置"],
  ["columba 侧栏（钉住）", "sidebar lside bar hide nav-scrollbar", "插件设置"],
  ["columba 侧栏（抽屉）", "lside drawer hide nav-scrollbar", "插件设置"],
];

function installDom(navClass) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <nav class="${navClass}">
         <ul>
           <li><a href="/"><span class="icon"><svg viewBox="0 0 1 1"></svg></span><span class="title">首页</span></a></li>
           <li><a href="/article"><span class="icon"><svg viewBox="0 0 1 1"></svg></span><span class="title">文章</span></a></li>
         </ul>
       </nav>
     </body></html>`,
    { pretendToBeVisual: true, url: "https://www.luogu.com.cn/user/2" },
  );
  const names = [
    "window",
    "document",
    "MutationObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "Node",
  ];
  const previous = new Map(names.map((name) => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = dom.window[name];
  return () => {
    dom.window.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  };
}

function mountSettings() {
  const storage = { get: () => true, set: () => {}, has: () => true };
  const feature = createSettingsFeature({
    storage,
    configurableFeatures: [
      { storageKey: "LuoguSP.showIntro", label: "个人页显示个人介绍" },
    ],
  });
  return feature.mount({ isCurrent: () => true });
}

for (const [label, navClass, expectedText] of NAV_SHAPES) {
  test(`settings entry mounts into the ${label}`, () => {
    const restore = installDom(navClass);
    try {
      const dispose = mountSettings();
      const entries = document.querySelectorAll(".luogusp-setting-entry");

      assert.equal(entries.length, 1);
      assert.equal(
        entries[0].textContent.replace(/\s+/g, ""),
        expectedText,
      );
      assert.equal(entries[0].hasAttribute("href"), false);
      assert.equal(entries[0].getAttribute("role"), "button");
      assert.ok(entries[0].querySelector("svg"));

      dispose();
      assert.equal(
        document.querySelectorAll(".luogusp-setting-entry").length,
        0,
      );
    } finally {
      restore();
    }
  });
}

test("settings entry is not duplicated when the nav mutates", () => {
  const restore = installDom("lside drawer hide nav-scrollbar");
  try {
    const dispose = mountSettings();
    document.querySelector("nav ul").append(document.createElement("li"));
    assert.equal(
      document.querySelectorAll(".luogusp-setting-entry").length,
      1,
    );
    dispose();
  } finally {
    restore();
  }
});

test("settings entry stays out of pages with no recognisable navigation", () => {
  const restore = installDom("some-other-nav");
  try {
    const dispose = mountSettings();
    assert.equal(
      document.querySelectorAll(".luogusp-setting-entry").length,
      0,
    );
    dispose();
  } finally {
    restore();
  }
});

// owner 要求：保存后的刷新提示要在屏幕正中。浏览器原生 confirm() 在 Chrome/Edge
// 一律贴视口顶部且样式不可控，所以换成页内对话框，复用设置面板同一套
// #luogusp-settings 遮罩 + 居中面板作用域。
test("保存后的刷新提示是页内居中对话框，不是原生 confirm", () => {
  const source = readFileSync(
    new URL("../src/features/settings/feature.js", import.meta.url),
    "utf8",
  );
  // 先剥注释再匹配：讲这条坑的注释里本来就会出现反例字面量，
  // 不剥就会像定时器那条守卫一样误报到自己身上。
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // 只剥行首注释：剥任意 // 会把 URL 里的 // 当注释起点，把要查的代码一起删掉。
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "");
  assert.doesNotMatch(
    code,
    /\bconfirm\(/,
    "原生确认框会贴在视口顶部，owner 明确要求居中",
  );
  assert.match(source, /function askRefresh\(/);
  assert.match(source, /role="alertdialog"/);
  // 复用同一个 id 才能吃到 .luogusp-panel 的 translate(-50%,-50%) 居中规则。
  assert.match(source, /overlay\.id = "luogusp-settings"[\s\S]*luogusp-confirm/);
  const style = readFileSync(
    new URL("../src/features/settings/style.js", import.meta.url),
    "utf8",
  );
  assert.match(style, /luogusp-panel\{position:absolute;top:50%;left:50%;transform:translate\(-50%,-50%\)/);
  assert.match(style, /luogusp-confirm/);
});

// ★★ 设置面板与保存后的「是否立即刷新」确认框**共用 `#luogusp-settings` 这个 id**
//    （CSS 作用域全挂在它上面）。此前只有设置面板登记了关闭回调，确认框没有，
//    于是路由切换时它会连同那个 document 级 keydown 监听（Enter = location.reload()）
//    一起留在页面上；而它顶着的 id 又会把 openSettings 的防重入判据挡下 ——
//    重挂之后齿轮点了没反应。2026-08-15 在 jsdom 里逐步复现过。
test("路由切换时刷新确认框跟着收走，齿轮不会变成哑巴", () => {
  const restore = installDom("lfe-body");
  try {
    let dispose = mountSettings();
    const click = (node) =>
      node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const gear = () => document.querySelector(".luogusp-setting-entry");

    click(gear());
    assert.ok(document.querySelector(".luogusp-list"), "设置面板没打开");
    click(document.querySelector('[data-act="save"]'));
    assert.ok(document.querySelector(".luogusp-confirm"), "确认框没出现");

    // page-lifecycle 在每次路由切换时都会 dispose 再 remount。
    dispose();
    assert.equal(
      document.getElementById("luogusp-settings"),
      null,
      "确认框必须随功能一起收走",
    );

    dispose = mountSettings();
    click(gear());
    assert.ok(
      document.querySelector(".luogusp-list"),
      "重挂之后齿轮必须还能打开设置面板",
    );
    dispose();
    assert.equal(document.getElementById("luogusp-settings"), null);
  } finally {
    restore();
  }
});

// ★ 卸载只能是「收起」。替用户按下「立即刷新」是我们无权做的事，
// 而 jsdom 的 location.reload 不可重定义，只能盯住登记进去的那个回调本身。
test("卸载确认框走的是「不刷新」那一支", () => {
  const source = readFileSync(
    new URL("../src/features/settings/feature.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const dismiss = \(\) => finish\(false\);\s+openOverlays\.add\(dismiss\);/,
    "登记给卸载用的必须是 finish(false)",
  );
});
