// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.7
// @description  [Canary] LuoguSP 2.14.0 验收版本
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.7/compat/early-gate.e486514c5aaf7d55.js#sha256=e486514c5aaf7d55837e945515cd8a9ad68def052967aab1966bfd6626d4d352
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.7/compat/runtime.64f19d57664cea05.js#sha256=64f19d57664cea05d8027087b8efbecae04d70ed6be12b7250bd715ba1c9dbb3
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
