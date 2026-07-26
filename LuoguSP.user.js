// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.13.4
// @description  LuoguSP：题号显示难度颜色 / 私信 Ctrl+Click 打开用户个人页 / 个人页显示个人介绍 / IDE 模式一键测试所有样例 / 显示受限文章与剪贴板
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL   https://github.com/ShanireZ/LuoguSP
// @supportURL    https://github.com/ShanireZ/LuoguSP/issues
// @updateURL     https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @downloadURL   https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @grant        none
// @require      https://spcdn.betaoi.cc/releases/2.13.4/compat/early-gate.a0878787fac36ed8.js#sha256=a0878787fac36ed8d3d8ede32ee3251a401d1766adc25e164c3637108eae1342
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js
// @require      https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js
// @require      https://spcdn.betaoi.cc/releases/2.13.4/compat/runtime.079aea3485210c27.js#sha256=079aea3485210c27cd42c06390fcc264adcadb4214cdbff60ac9d0cea25eff54
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
