// hover 卡樣式。跟著洛谷的觀感走：白底、細邊、圓角 4px、陰影淺。
// 固定定位避開錨點容器的裁切，placeCard 設定可用高度，內容在卡內捲動。
// 使用者頁頭用負邊距貼齊卡片邊緣，比例取自原生 1168 × 240 的頁頭。
// 統計標籤和數值置中，獎項靠右分行。簽名預設兩行，展開後至多六行。
// 明確覆蓋標籤的 display:flex，確保 [hidden] 仍可隱藏。卡內操作可換行，
// 屏蔽沿用洛谷的危險色，在原本的操作區確認。
export const HOVER_CARD_STYLE = `
.luogusp-hc{position:fixed;z-index:2147482000;width:320px;max-width:calc(100vw - 24px);background:#fff;color:#3f3f3f;border:1px solid #e6e6e6;border-radius:4px;box-shadow:0 4px 16px rgba(26,26,26,.14);font:13px/1.6 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;padding:12px 14px;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;}
.luogusp-hc[hidden]{display:none;}
body.luogusp-hc-owns-user-preview .dropdown:has(> .float-card){display:none !important;}
body.luogusp-hc-owns-user-preview .float-card{display:none !important;}
.luogusp-hc-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;}
.luogusp-hc-userhead{position:relative;height:66px;margin:-12px -14px 0;border-radius:3px 3px 0 0;background:#dfe6ec 50% 50%/cover no-repeat;}
.luogusp-hc-userhead img:not([src]){display:none;}
.luogusp-hc-cover{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit;}
.luogusp-hc-userhead .luogusp-hc-avatar{position:absolute;left:14px;bottom:-16px;width:52px;height:52px;}
.luogusp-hc-userbody{padding-top:22px;}
.luogusp-hc-avatar{width:36px;height:36px;border-radius:50%;flex:0 0 auto;background:#f0f0f0;border:1px solid #979797;box-sizing:border-box;}
.luogusp-hc-name{text-decoration:none;font-weight:bold;}
.luogusp-hc-name:hover{text-decoration:underline;}
.luogusp-hc-stats{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0 2px;}
.luogusp-hc-stat{display:flex;flex-direction:column;align-items:center;line-height:1.3;}
.luogusp-hc-stat-k{color:#8a8a8a;font-size:11px;white-space:nowrap;}
.luogusp-hc-stat-v{font-size:14px;font-weight:600;white-space:nowrap;}
.luogusp-hc-utitle{display:flex;align-items:baseline;gap:8px;}
.luogusp-hc-identity{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.luogusp-hc-uid{margin-left:auto;flex:0 0 auto;color:#8a8a8a;font-size:11px;font-weight:400;}
.luogusp-hc-extra{margin-top:2px;}
.luogusp-hc-title{font-size:14px;font-weight:600;line-height:1.4;margin:0;word-break:break-all;}
.luogusp-hc-sub{font-size:12px;margin-top:1px;}
.luogusp-hc-badges{display:inline-flex;align-items:center;gap:4px;margin-left:4px;vertical-align:middle;}
.luogusp-hc-badge{font-size:.765em;line-height:1.5;white-space:nowrap;}
.luogusp-hc-fa{width:1em;height:1em;display:inline-block;vertical-align:-.125em;overflow:visible;}
.luogusp-hc-status{font-size:.9em;font-weight:600;}
.luogusp-hc-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;}
.luogusp-hc-key{color:#8a8a8a;flex:0 0 auto;}
.luogusp-hc-val{text-align:right;word-break:break-all;min-width:0;}
.luogusp-hc-stack{display:flex;flex-direction:column;align-items:flex-end;}
.luogusp-hc-slogan{position:relative;}
.luogusp-hc-clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}
.luogusp-hc-slogan.is-open .luogusp-hc-clamp{-webkit-line-clamp:6;}
.luogusp-hc-expand{position:absolute;right:0;bottom:0;border:0;padding:0 0 0 10px;background:linear-gradient(90deg,rgba(255,255,255,0) 0,#fff 10px,#fff 100%);color:#3498db;cursor:pointer;font:inherit;font-size:12px;line-height:inherit;}
.luogusp-hc-expand[hidden]{display:none;}
.luogusp-hc-sep{border-top:1px solid #f0f0f0;margin:8px 0 6px;}
.luogusp-hc-tags{margin-top:2px;}
.luogusp-hc-tagbtn{background:none;border:0;padding:0;color:#3498db;cursor:pointer;font:inherit;}
.luogusp-hc-taglist{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}
.luogusp-hc-taglist[hidden]{display:none;}
.luogusp-hc-tag{font-size:11px;line-height:1.5;padding:0 6px;border-radius:3px;background:#eef4fb;color:#2b6ca3;}
.luogusp-hc-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-top:10px;}
.luogusp-hc-btn{font-size:12px;line-height:1.5;padding:3px 12px;border-radius:3px;border:1px solid #3498db;background:#3498db;color:#fff;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-block;white-space:nowrap;}
.luogusp-hc-btn:hover{background:rgba(52,152,219,.9);}
.luogusp-hc-btn.is-off,.luogusp-hc-btn.is-ghost{background:#fff;color:#3498db;}
.luogusp-hc-btn.is-off:hover,.luogusp-hc-btn.is-ghost:hover{background:rgba(52,152,219,.08);}
.luogusp-hc-btn.is-danger{border-color:#e74c3c;color:#e74c3c;background:#fff;}
.luogusp-hc-btn.is-danger:hover{background:rgba(231,76,60,.08);}
.luogusp-hc-btn[disabled]{opacity:.55;cursor:default;}
.luogusp-hc-confirm{flex-wrap:wrap;}
.luogusp-hc-confirm-text{flex:1 1 100%;color:#e74c3c;font-size:12px;line-height:1.6;word-break:break-all;}
.luogusp-hc-relation-status:not(:empty){margin-top:4px;color:#a42626;font-size:12px;}
.luogusp-hc-link{color:#3498db;text-decoration:none;font-size:12px;}
.luogusp-hc-ok{color:#52c41a;}
.luogusp-hc-warn{color:#f39c11;}
.luogusp-hc-muted{color:#8a8a8a;}
.luogusp-hc-loading{display:flex;justify-content:center;align-items:center;gap:8px;}
.luogusp-hc-spin{width:16px;height:16px;border:2px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;animation:luogusp-hc-spin .8s linear infinite;margin:2px 0;}
@keyframes luogusp-hc-spin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.luogusp-hc-spin{animation:none;}}
`;
