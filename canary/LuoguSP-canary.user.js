// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.3-canary.2
// @description  [Canary] LuoguSP 2.14.3 驗收版本（第 2 輪：設定刷新確認框隨卸載收走、發佈目錄防呆）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.3-canary.2/compat/early-gate.e711bf1bd2856df0.js#sha256=e711bf1bd2856df04906a507784e79ea94f25d60c1dedacccef7469a58055438
// @require      https://luogusp.round1.cc/releases/2.14.3-canary.2/compat/runtime.82a49deb11caa502.js#sha256=82a49deb11caa502addc22488661236313989f85234498bdee993970bf261c32
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
