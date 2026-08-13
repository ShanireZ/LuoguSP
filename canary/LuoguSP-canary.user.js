// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.12
// @description  [Canary] LuoguSP 2.14.0 验收版本（加载层转圈定位修复）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.12/compat/early-gate.6d6ef40aa4623cb4.js#sha256=6d6ef40aa4623cb41c3c1da1cd54755371810feeddc51cf7cddf8804f7b48a6b
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.12/compat/runtime.5bedaf950ad0eef0.js#sha256=5bedaf950ad0eef03572e6ee1c47a550659d47ffba2d93b1b3f7e2e00e1dd2fc
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
