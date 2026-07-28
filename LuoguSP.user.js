// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.13.5
// @description  LuoguSP：题号显示难度颜色 / 私信 Ctrl+Click 打开用户个人页 / 个人页显示个人介绍 / IDE 模式一键测试所有样例 / 显示受限文章与剪贴板
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL   https://github.com/ShanireZ/LuoguSP
// @supportURL    https://github.com/ShanireZ/LuoguSP/issues
// @updateURL     https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @downloadURL   https://gitee.com/shanire/LuoguSP/raw/main/LuoguSP.user.js
// @sandbox      raw
// @connect      spcdn.betaoi.cc
// @grant        GM_xmlhttpRequest
// @require      https://spcdn.betaoi.cc/releases/2.13.5/compat/early-gate.532cc8089a2d1a74.js#sha256=532cc8089a2d1a74d89ec07279b0508e01b5d4a14f48bbbe6b3c8c8f6b650d72
// @require      https://spcdn.betaoi.cc/releases/2.13.5/compat/runtime.66b5552c371b625c.js#sha256=66b5552c371b625cb77c491333cc0e13007df6f0967e90bdc971472c48802500
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
