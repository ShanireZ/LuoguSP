// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.18
// @description  [Canary] LuoguSP 2.14.0 验收版本（用户卡布局收口：统计排合并、uid 上行、关系与注册于移除）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.18/compat/early-gate.edddae1ce3504a29.js#sha256=edddae1ce3504a29609c62b46ce021fe4ec3db21940348fd1ab63366717a1595
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.18/compat/runtime.15b55fc0cd7a5682.js#sha256=15b55fc0cd7a5682fd3f1c008358897610b83b0279dcccb3493e9c2220b7707a
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
