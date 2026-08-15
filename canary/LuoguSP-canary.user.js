// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.3-canary.1
// @description  [Canary] LuoguSP 2.14.3 验收版本（第 1 轮：pid 字符集守卫、IDE 提示文案、XHR 包装契约、实时计数截断上报）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.3-canary.1/compat/early-gate.d5ef166b7da27808.js#sha256=d5ef166b7da27808d2f919a4bb67dcfd38e48fe069e175d9548e77a64dd5986e
// @require      https://luogusp.round1.cc/releases/2.14.3-canary.1/compat/runtime.fb98ad3c63bb5a2a.js#sha256=fb98ad3c63bb5a2a83bddfc419c920e5cc76592627b8a667026b25d0458be7d3
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
