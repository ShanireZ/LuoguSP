// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.14.10
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
// @require      https://luogusp.round1.cc/releases/2.14.10/compat/early-gate.38240e50aecd5275.js#sha256=38240e50aecd527561c015bea4af4bba4e0b7ba271f1ab9b23b1c253d6a86bd5
// @require      https://luogusp.round1.cc/releases/2.14.10/compat/runtime.55ef76c369afb053.js#sha256=55ef76c369afb0535554432e77bd29c8cdc52ebe530f91b8025ee436bbd00081
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
