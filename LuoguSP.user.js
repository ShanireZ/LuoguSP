// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.14.9
// @description  LuoguSP：題號顯示難度顏色 / 題目懸停顯示預覽卡 / 使用者名稱/頭像懸停顯示預覽卡 / 個人頁顯示個人介紹 / 受限文章與剪貼板解限 / IDE 模式一鍵測試所有樣例
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL   https://github.com/ShanireZ/LuoguSP
// @supportURL    https://github.com/ShanireZ/LuoguSP/issues
// @updateURL     https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js
// @downloadURL   https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.9/compat/early-gate.19e5ab394cabff7f.js#sha256=19e5ab394cabff7f01bee71021c52b154ddbc6772ff5b586841c308ce7289dc8
// @require      https://luogusp.round1.cc/releases/2.14.9/compat/runtime.92a3540a16c0e4f3.js#sha256=92a3540a16c0e4f3b87ea4f149034ee9c5c32f09e9212398e818f5782ec587c0
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
