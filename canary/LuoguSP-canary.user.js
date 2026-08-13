// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.10
// @description  [Canary] LuoguSP 2.14.0 验收版本（启动包减肥：受限内容改按需加载）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.10/compat/early-gate.1a11aa2c69af8300.js#sha256=1a11aa2c69af83008fa27ff395ec0a8e05dde59852bbdd6bc1b1d6cfdd102286
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.10/compat/runtime.b493f4c30dc43773.js#sha256=b493f4c30dc437732f1b5dbbb4f7239765b0924cb4c7de08729623e0f42a4ae3
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
