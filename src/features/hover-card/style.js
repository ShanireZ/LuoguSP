// hover 卡样式。跟着洛谷的观感走：白底、细边、圆角 4px、阴影浅。
// ★ 卡片用 position:fixed —— 锚点常在 overflow:hidden 的容器里（讨论区行、题解列表），
//   用 absolute 会被裁掉。
export const HOVER_CARD_STYLE = `
.luogusp-hc{position:fixed;z-index:2147482000;width:320px;max-width:calc(100vw - 24px);background:#fff;color:#3f3f3f;border:1px solid #e6e6e6;border-radius:4px;box-shadow:0 4px 16px rgba(26,26,26,.14);font:13px/1.6 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;padding:12px 14px;box-sizing:border-box;}
.luogusp-hc[hidden]{display:none;}
.luogusp-hc-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;}
.luogusp-hc-avatar{width:36px;height:36px;border-radius:50%;flex:0 0 auto;background:#f0f0f0;}
.luogusp-hc-title{font-size:14px;font-weight:600;line-height:1.4;margin:0;word-break:break-all;}
.luogusp-hc-sub{font-size:12px;margin-top:1px;}
.luogusp-hc-badges{display:inline-flex;align-items:center;gap:4px;margin-left:4px;vertical-align:middle;}
.luogusp-hc-badge{font-size:11px;line-height:1.4;padding:0 5px;border-radius:3px;background:#f2f4f7;color:#5a5a5a;white-space:nowrap;}
.luogusp-hc-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;}
.luogusp-hc-key{color:#8a8a8a;flex:0 0 auto;}
.luogusp-hc-val{text-align:right;word-break:break-all;}
.luogusp-hc-sep{border-top:1px solid #f0f0f0;margin:8px 0 6px;}
.luogusp-hc-tags{margin-top:2px;}
.luogusp-hc-tagbtn{background:none;border:0;padding:0;color:#3498db;cursor:pointer;font:inherit;}
.luogusp-hc-taglist{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}
.luogusp-hc-tag{font-size:11px;line-height:1.5;padding:0 6px;border-radius:3px;background:#eef4fb;color:#2b6ca3;}
.luogusp-hc-actions{display:flex;align-items:center;gap:8px;margin-top:10px;}
.luogusp-hc-btn{font-size:12px;line-height:1.5;padding:3px 12px;border-radius:3px;border:1px solid #3498db;background:#3498db;color:#fff;cursor:pointer;}
.luogusp-hc-btn:hover{background:rgba(52,152,219,.9);}
.luogusp-hc-btn.is-off{background:#fff;color:#3498db;}
.luogusp-hc-btn[disabled]{opacity:.55;cursor:default;}
.luogusp-hc-link{color:#3498db;text-decoration:none;font-size:12px;}
.luogusp-hc-ok{color:#52c41a;}
.luogusp-hc-warn{color:#f39c11;}
.luogusp-hc-muted{color:#8a8a8a;}
.luogusp-hc-spin{width:16px;height:16px;border:2px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;animation:luogusp-hc-spin .8s linear infinite;margin:2px auto;}
@keyframes luogusp-hc-spin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.luogusp-hc-spin{animation-duration:1.8s;}}
`;
