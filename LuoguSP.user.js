// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.13.10
// @description  LuoguSP：题号显示难度颜色 / 私信 Ctrl+Click 打开用户个人页 / 个人页显示个人介绍 / IDE 模式一键测试所有样例 / 显示受限文章与剪贴板
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
// @require      https://luogusp.round1.cc/releases/2.13.10/compat/early-gate.702eb1cf0f84940e.js#sha256=702eb1cf0f84940ed9a9866c13314b3a7afb72b43727695d3c9d284281cc9763
// @require      https://luogusp.round1.cc/releases/2.13.10/compat/runtime.a86d47accc3a6fd1.js#sha256=a86d47accc3a6fd19da3b5e95b817e32972586b6d0511b932dd9d53b9adf9e52
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
