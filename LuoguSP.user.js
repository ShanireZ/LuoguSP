// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.14.7
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
// @require      https://luogusp.round1.cc/releases/2.14.7/compat/early-gate.79cb17962baeabfe.js#sha256=79cb17962baeabfedee181d820c2a98bf4abb42220a3b76558006d95598d1b9f
// @require      https://luogusp.round1.cc/releases/2.14.7/compat/runtime.48c631bb0a1191f1.js#sha256=48c631bb0a1191f17370068118409be760eeb0324e34adbebe236a09e9766734
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
