// ==UserScript==
// @name         LuoguSP
// @namespace    https://github.com/ShanireZ/LuoguSP
// @version      2.13.8
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
// @require      https://luogusp.round1.cc/releases/2.13.8/compat/early-gate.fb2d887badaf76c5.js#sha256=fb2d887badaf76c5ec97071bfac4145dfc374eaa91726519301586725d1bfa1a
// @require      https://luogusp.round1.cc/releases/2.13.8/compat/runtime.0bce27dc8c0559ec.js#sha256=0bce27dc8c0559eca0c1fdf7bd41959f17be4ba4f96b1781980b6f2cea8ccf7b
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
