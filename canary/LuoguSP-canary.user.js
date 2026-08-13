// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.13
// @description  [Canary] LuoguSP 2.14.0 验收版本（新增题号与用户悬停预览卡）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.13/compat/early-gate.7f0fb4d81b7e0d86.js#sha256=7f0fb4d81b7e0d86ef49b634b08ab854e3bc41a2da7976d48e439f8cbf8aba82
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.13/compat/runtime.12927cd38cd7e135.js#sha256=12927cd38cd7e135a17e43540cf68c2e3ff5247be940e9498f40bcec9f8ff285
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
