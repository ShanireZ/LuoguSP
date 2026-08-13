// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.15
// @description  [Canary] LuoguSP 2.14.0 验收版本（hover 卡定位与判据修正）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.15/compat/early-gate.5e31745dd11f7d93.js#sha256=5e31745dd11f7d937aebeb525824a56bdc4ecb248a255aaccf8e662b5bcf4f3b
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.15/compat/runtime.73fbd496f70c3988.js#sha256=73fbd496f70c3988ba4c78f8dee50302c48723bb4839eab4b8da06aa90833fd6
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
