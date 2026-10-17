import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createSettingsFeature } from "../src/features/settings/feature.js";

// 夾具照抄真站形狀（2026-08-20 在 www.luogu.com.cn 上量的）：新側欄每一條都是
// `<li title="文章广场"><a>…</a></li>`——浮泡文字在 <li> 上，不在 <a> 上；而末尾的
// 「雲剪貼板」一類沒有圖標（真站是 `<!---->`），所以範本一定落在 /article 那條上。
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

      // ★ 入口是整條 <li> 克隆來的，範本是「文章廣場」：浮泡與讀屏名字都必須是自己的，
      //   不能把範本那條的名字一起抄過來（owner 2026-08-20 報的就是這個）。
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

// owner 要求：保存後的刷新提示要在螢幕正中。瀏覽器原生 confirm() 在 Chrome/Edge
// 一律貼視口頂部且樣式不可控，所以換成頁內對話框，重複使用設定面板同一套
// #luogusp-settings 遮罩 + 居中面板作用域。
test("保存后的刷新提示是页内居中对话框，不是原生 confirm", () => {
  const source = readFileSync(
    new URL("../src/features/settings/feature.js", import.meta.url),
    "utf8",
  );
  // 先剝註解再匹配：講這條坑的註解裡本來就會出現反例字面值，
  // 不剝就會像定時器那條守衛一樣誤報到自己身上。
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // 只剝行首註解：剝任意 // 會把 URL 裡的 // 當註解起點，把要查的程式碼一起刪掉。
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "");
  assert.doesNotMatch(
    code,
    /\bconfirm\(/,
    "原生确认框会贴在视口顶部，owner 明确要求居中",
  );
  assert.match(source, /function askRefresh\(/);
  assert.match(source, /role="alertdialog"/);
  // 重複使用同一個 id 才能吃到 .luogusp-panel 的 translate(-50%,-50%) 居中規則。
  assert.match(source, /overlay\.id = "luogusp-settings"[\s\S]*luogusp-confirm/);
  const style = readFileSync(
    new URL("../src/features/settings/style.js", import.meta.url),
    "utf8",
  );
  assert.match(style, /luogusp-panel\{position:absolute;top:50%;left:50%;transform:translate\(-50%,-50%\)/);
  assert.match(style, /luogusp-confirm/);
});

// ★★ 設定面板與保存後的「是否立即刷新」確認框**共用 `#luogusp-settings` 這個 id**
//    （CSS 作用域全掛在它上面）。此前只有設定面板登記了關閉回呼，確認框沒有，
//    於是路由切換時它會連同那個 document 級 keydown 監聽（Enter = location.reload()）
//    一起留在頁面上；而它頂著的 id 又會把 openSettings 的防重入判據擋下 ——
//    重掛之後齒輪點了沒反應。2026-08-15 在 jsdom 裡逐步重現過。
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

    // page-lifecycle 在每次路由切換時都會 dispose 再 remount。
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

// ★ 卸載只能是「收起」。替使用者按下「立即刷新」是我們無權做的事，
// 而 jsdom 的 location.reload 不可重定義，只能盯住登記進去的那個回呼本身。
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
