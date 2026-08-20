import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createSettingsFeature } from "../src/features/settings/feature.js";

// 夹具照抄真站形状（2026-08-20 在 www.luogu.com.cn 上量的）：新侧栏每一条都是
// `<li title="文章广场"><a>…</a></li>`——浮泡文字在 <li> 上，不在 <a> 上；而末尾的
// 「云剪贴板」一类没有图标（真站是 `<!---->`），所以模板一定落在 /article 那条上。
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
           <li title="首页"><a href="/"><span class="icon"><svg viewBox="0 0 1 1"></svg></span><span class="title">首页</span></a></li>
           <li title="文章广场"><a href="/article" aria-label="文章广场"><span class="icon"><svg viewBox="0 0 1 1"></svg></span><span class="title">文章广场</span></a></li>
           <li><a href="/paste"><!----><span class="title minor">云剪贴板</span></a></li>
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

      // ★ 入口是整条 <li> 克隆来的，模板是「文章广场」：浮泡与读屏名字都必须是自己的，
      //   不能把模板那条的名字一起抄过来（owner 2026-08-20 报的就是这个）。
      const unit = entries[0].closest("li") || entries[0];
      assert.equal(unit.getAttribute("title"), "插件设置");
      assert.equal(entries[0].getAttribute("aria-label"), "插件设置");
      for (const el of [unit, ...unit.querySelectorAll("*")])
        for (const name of ["title", "aria-label", "aria-labelledby"]) {
          const value = el.getAttribute(name);
          assert.ok(
            value === null || value === "插件设置",
            `${el.tagName}[${name}]=${value} 是从模板抄来的名字`,
          );
        }

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
