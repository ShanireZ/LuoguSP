// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.14.4
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
// @require      https://luogusp.round1.cc/releases/2.14.4/compat/early-gate.16eb5533cc5eb634.js#sha256=16eb5533cc5eb634823aa21616ca60258e420c2588328a259eb04acd5d56faa5
// @require      https://luogusp.round1.cc/releases/2.14.4/compat/runtime.18c3ab644a52df19.js#sha256=18c3ab644a52df198526f6f4bceb57b2c22c51aa2ad86c69a4cd798bd3423988
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
