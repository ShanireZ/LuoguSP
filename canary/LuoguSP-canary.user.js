// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.21
// @description  [Canary] LuoguSP 2.14.0 验收版本（首次悬停必弹、裸用户名也能弹）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.21/compat/early-gate.d65abfc6656ea3e1.js#sha256=d65abfc6656ea3e1cb15ecff1af8ee0aa0d02f2774025a45028ca6db8725a761
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.21/compat/runtime.e358ec4e094d0570.js#sha256=e358ec4e094d0570f3f3cbb2ec9479c569b8cc23aa2419b5eae6ffadde3b166d
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
