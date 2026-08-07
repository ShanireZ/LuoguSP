// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.13.6
// @description  LuoguSP：题号显示难度颜色 / 私信 Ctrl+Click 打开用户个人页 / 个人页显示个人介绍 / IDE 模式一键测试所有样例 / 显示受限文章与剪贴板
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL   https://github.com/ShanireZ/LuoguSP
// @supportURL    https://github.com/ShanireZ/LuoguSP/issues
// @updateURL     https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js
// @downloadURL   https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js
// @sandbox      raw
// @connect      spcdn.betaoi.cc
// @grant        GM_xmlhttpRequest
// @require      https://spcdn.betaoi.cc/releases/2.13.6/compat/early-gate.2dd1be00c1170602.js#sha256=2dd1be00c1170602e715425ba167794999194010764775018199a23d6cade7e0
// @require      https://spcdn.betaoi.cc/releases/2.13.6/compat/runtime.0d14e575d779f48e.js#sha256=0d14e575d779f48e6e782700f1210c1f877b183c727b780364150fbdd8f26446
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
