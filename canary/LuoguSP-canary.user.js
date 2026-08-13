// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.14
// @description  [Canary] LuoguSP 2.14.0 验收版本（hover 卡回归修复 + 对齐原生表现）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.14/compat/early-gate.eef33659b904302b.js#sha256=eef33659b904302baa51b60f99cc171f6236f253aa0b3acbb0f869f980acd89d
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.14/compat/runtime.ad944c86e51a3760.js#sha256=ad944c86e51a3760023e91a643743764163494332507b1eecfb8212df806b680
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
