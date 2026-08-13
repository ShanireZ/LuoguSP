// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.8
// @description  [Canary] LuoguSP 2.14.0 验收版本（受限文章实时计数）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.8/compat/early-gate.0879bbef4c464b8b.js#sha256=0879bbef4c464b8b4c59b9aa7e67a021955e44dac3ca9801a2fd3b8bd6f32cac
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.8/compat/runtime.a9557d5c1073ba73.js#sha256=a9557d5c1073ba73d7f6a0c8f90b98d187421817e43209a2374a6ec9a620e860
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
