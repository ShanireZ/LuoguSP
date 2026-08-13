// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.11
// @description  [Canary] LuoguSP 2.14.0 验收版本（按需加载回归修复 + 刷新提示居中）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.11/compat/early-gate.2919b813d5552b13.js#sha256=2919b813d5552b131e5212c37870be9d6496a91de0fabe1c6037b8dabfd3d724
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.11/compat/runtime.a067530183d0221b.js#sha256=a067530183d0221b3f1a5ade8027164fb721e3b0c9b3f15cd4352b21bd622b05
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
