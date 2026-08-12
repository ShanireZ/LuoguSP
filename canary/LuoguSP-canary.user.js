// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.4
// @description  [Canary] LuoguSP 2.14.0 验收版本
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.4/compat/early-gate.389e87346cac26f9.js#sha256=389e87346cac26f9e418404c6cf69564275b5baef5bb58feebc6f640f75c5f0f
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.4/compat/runtime.14ba1934dde58807.js#sha256=14ba1934dde5880797dfadafefb0982367d910561e8cb2c45c479441a350f682
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
