// ==UserScript==
// @name         LuoguSP Canary
// @namespace    https://github.com/ShanireZ/LuoguSP/canary
// @version      2.14.0-canary.16
// @description  [Canary] LuoguSP 2.14.0 验收版本（hover 卡误弹修正、原生徽章、卡片信息重排）
// @author       ShanireZ, realskc (Until 1.8.2)
// @license      GPL-3.0
// @match        https://www.luogu.com.cn/*
// @homepageURL  https://github.com/ShanireZ/LuoguSP
// @supportURL   https://github.com/ShanireZ/LuoguSP/issues
// @sandbox      raw
// @connect      luogusp.round1.cc
// @grant        GM_xmlhttpRequest
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.16/compat/early-gate.603fe5486b8c48e5.js#sha256=603fe5486b8c48e57d4a43c2f15ade844cceff981c0fe30a2b124c08422b1f2b
// @require      https://luogusp.round1.cc/releases/2.14.0-canary.16/compat/runtime.693c4fd93809b428.js#sha256=693c4fd93809b428ab3d27585bc85863cc81912b701709c4a85bb824ba0539b6
// @run-at       document-start
// ==/UserScript==
(()=>{var i=globalThis.__LUOGUSP_CDN_RUNTIME__;(!i||i.apiVersion!==1)&&console.error("LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.");})();
