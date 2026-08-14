// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.20
// @description  [Canary] LuoguSP 2.14.0 验收版本（屏蔽原生个人卡、题库题号不弹卡、AT 题修复）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.20/compat/early-gate.e9f934336e3dfb61.js#sha256=e9f934336e3dfb618fa451524575134a9e42db941dbeb246e6b5cc3b3282a851
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.20/compat/runtime.fd021d2edc9b14ac.js#sha256=fd021d2edc9b14ac5b03deb0a06c93f88f097f933fcd54a84f5d67e6eb7083cc
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
