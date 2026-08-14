// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.19
// @description  [Canary] LuoguSP 2.14.0 验收版本（移除私信快捷键、设置重排、卡片按钮与展开）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.19/compat/early-gate.bae80211689b5877.js#sha256=bae80211689b58778a6f05089bc1bc725d360cce01e047090311cb183291368f
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.19/compat/runtime.d7d471cae5f2f6b7.js#sha256=d7d471cae5f2f6b708a58f2010d36e4710ac5260b508d6de2a6d96942512edf2
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
