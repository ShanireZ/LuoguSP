import test from "node:test";
import assert from "node:assert/strict";
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
