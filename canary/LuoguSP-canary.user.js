// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.22
// @description  [Canary] LuoguSP 2.14.0 验收版本（上下弹窗分界修正、卡内就地确认）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.22/compat/early-gate.0675ee1ad3e6e5f1.js#sha256=0675ee1ad3e6e5f1ddd9292c8f9cc845dc150ca32c80beb6710e58e1bb31b618
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.22/compat/runtime.597fe6f5aa27fec6.js#sha256=597fe6f5aa27fec66c936a5fb6b57905f39446bec99b4b4c7b74167da9df01bb
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
