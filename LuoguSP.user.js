// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.14.5
// @description  LuoguSP：题号显示难度颜色 / 题目悬停显示预览卡 / 用户名/头像悬停显示预览卡 / 个人页显示个人介绍 / 受限文章与剪贴板解限 / IDE 模式一键测试所有样例
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
// @require      https://luogusp.round1.cc/releases/2.14.5/compat/early-gate.a6566fa8f1000003.js#sha256=a6566fa8f1000003226fc60cdf322c961341a0403bb1a11479d63444ef36a2ae
// @require      https://luogusp.round1.cc/releases/2.14.5/compat/runtime.c2b7a35eedef5b33.js#sha256=c2b7a35eedef5b33d0c55d87340567ffa7f0c9f9201002cda42c7e14d8c6c22c
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
