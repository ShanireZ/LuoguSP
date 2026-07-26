// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.13.2
// @description  LuoguSP：题号显示难度颜色 / 私信 Ctrl+Click 打开用户个人页 / 个人页显示个人介绍 / IDE 模式一键测试所有样例 / 显示受限文章与剪贴板
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL   https://github.com/ShanireZ/LuoguSP
// @supportURL    https://github.com/ShanireZ/LuoguSP/issues
// @updateURL     https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @downloadURL   https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @grant        none
// @require      https://spcdn.betaoi.cn/releases/2.13.2/compat/early-gate.1c89b2903d361d85.js#sha256=1c89b2903d361d85619681922299914b7ea6822b7c952a72608043c27b741f4c
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js
// @require      https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js
// @require      https://spcdn.betaoi.cn/releases/2.13.2/compat/runtime.61241a62869decdd.js#sha256=61241a62869decdd318ecc634671c71496604f3becbdf86ece8a19f6eb350621
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
