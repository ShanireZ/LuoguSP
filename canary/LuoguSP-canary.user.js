// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.17
// @description  [Canary] LuoguSP 2.14.0 验收版本（用户卡复刻洛谷原生悬停卡 + 扩展）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.17/compat/early-gate.9f1437dfe0ff1d7b.js#sha256=9f1437dfe0ff1d7b142318f3a95ccbaf287c8577544a76e6d5eb8870298e3655
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.17/compat/runtime.b4650764a09dd73c.js#sha256=b4650764a09dd73c773a6e3df79d50e95beb50690c0049294eb279b0fba488a5
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
