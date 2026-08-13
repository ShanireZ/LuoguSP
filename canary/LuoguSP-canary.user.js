// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.9
// @description  [Canary] LuoguSP 2.14.0 验收版本（受限文章实时计数 + 真实发表时间）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.9/compat/early-gate.135fa6444b26b642.js#sha256=135fa6444b26b642c2762c5d0eafeb0204de8069a4dc8b0ac6766c25e9b0f2c9
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.9/compat/runtime.d5ab9fcbc91d985b.js#sha256=d5ab9fcbc91d985b6836a576ba889d4871852dcda02b69a9b27f131d4fb71b02
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
