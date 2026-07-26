// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.13.1
// @description  LuoguSP：题号显示难度颜色 / 私信 Ctrl+Click 打开用户个人页 / 个人页显示个人介绍 / IDE 模式一键测试所有样例 / 显示受限文章与剪贴板
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL   https://github.com/ShanireZ/LuoguSP
// @supportURL    https://github.com/ShanireZ/LuoguSP/issues
// @updateURL     https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @downloadURL   https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @grant        none
// @require      https://spcdn.betaoi.cn/releases/2.13.0/compat/early-gate.3bf86a7d0658cf9c.js#sha256=3bf86a7d0658cf9cabbb789f96f19720663dfb32fce963e85a7a97f50e9b4f8e
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js
// @require      https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js
// @require      https://spcdn.betaoi.cn/releases/2.13.0/compat/runtime.dad6604731c7e837.js#sha256=dad6604731c7e837d932527d78c4f13aa5cfe85d60adbb29ff6ea76d570988e0
// @run-at       document-start
// ==/UserScript==
(() => {
  var i = globalThis.__LUOGUSP_CDN_RUNTIME__;
  (!i || i.apiVersion !== 1) &&
    console.error(
      "LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.",
    );
})();
