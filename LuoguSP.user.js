// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.14.6
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
// @require      https://luogusp.round1.cc/releases/2.14.6/compat/early-gate.fe3f2a81d119b8c4.js#sha256=fe3f2a81d119b8c49ac9b5b2b359bcc9f823c0fb290ca60ee4d53147e481a3b5
// @require      https://luogusp.round1.cc/releases/2.14.6/compat/runtime.539a993454a5b677.js#sha256=539a993454a5b6778e577a3fcce545b80c24714cd4c8f3b517320bf40785f76b
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
