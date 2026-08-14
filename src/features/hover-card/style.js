// hover 卡样式。跟着洛谷的观感走：白底、细边、圆角 4px、阴影浅。
// ★ 卡片用 position:fixed —— 锚点常在 overflow:hidden 的容器里（讨论区行、题解列表），
//   用 absolute 会被裁掉。
export const HOVER_CARD_STYLE = `
/* ★ 宽度固定、并且**永远不出视口**：高度由 placeCard 按可用空间钉 max-height，
   内容再长也只在卡片内部出滚动条（owner 2026-08-14：展开标签后卡片顶出界）。 */
.luogusp-hc{position:fixed;z-index:2147482000;width:320px;max-width:calc(100vw - 24px);background:#fff;color:#3f3f3f;border:1px solid #e6e6e6;border-radius:4px;box-shadow:0 4px 16px rgba(26,26,26,.14);font:13px/1.6 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;padding:12px 14px;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;}
.luogusp-hc[hidden]{display:none;}
.luogusp-hc-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;}
/* 用户卡=复刻洛谷原生 UserFloatCard 的骨架：背景图页头 → 头像压在下沿 → 名字/签名/统计/操作。
   页头用负 margin 顶出卡片自身的内边距（原生 float-card 是 padding:0 的），
   这样只影响用户卡，题目卡的内边距原样不动。
   比例取自洛谷个人页的 .user-header-top（实测 1168x240 ≈ 4.87:1、background cover 居中、
   头像 66px 圆形 + 1px #979797 描边）等比缩到 320px 宽。 */
.luogusp-hc-userhead{position:relative;height:66px;margin:-12px -14px 0;border-radius:3px 3px 0 0;background:#dfe6ec 50% 50%/cover no-repeat;}
.luogusp-hc-userhead .luogusp-hc-avatar{position:absolute;left:14px;bottom:-16px;width:52px;height:52px;}
.luogusp-hc-userbody{padding-top:22px;}
.luogusp-hc-avatar{width:36px;height:36px;border-radius:50%;flex:0 0 auto;background:#f0f0f0;border:1px solid #979797;box-sizing:border-box;}
.luogusp-hc-name{text-decoration:none;font-weight:bold;}
.luogusp-hc-name:hover{text-decoration:underline;}
/* 原生统计块：标签在上、数字在下，横向铺开。★ owner 2026-08-14：数值要**横向居中**
   对齐到标签，并且咕值与「通过 / 提交」依次尾随在关注/粉丝/等级分后面。 */
.luogusp-hc-stats{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0 2px;}
.luogusp-hc-stat{display:flex;flex-direction:column;align-items:center;line-height:1.3;}
.luogusp-hc-stat-k{color:#8a8a8a;font-size:11px;white-space:nowrap;}
.luogusp-hc-stat-v{font-size:14px;font-weight:600;white-space:nowrap;}
/* 用户名行两端对齐：左边名字+徽章，右边贴 uid。 */
.luogusp-hc-utitle{display:flex;align-items:baseline;gap:8px;}
.luogusp-hc-identity{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.luogusp-hc-uid{margin-left:auto;flex:0 0 auto;color:#8a8a8a;font-size:11px;font-weight:400;}
.luogusp-hc-extra{margin-top:2px;}
.luogusp-hc-title{font-size:14px;font-weight:600;line-height:1.4;margin:0;word-break:break-all;}
.luogusp-hc-sub{font-size:12px;margin-top:1px;}
.luogusp-hc-badges{display:inline-flex;align-items:center;gap:4px;margin-left:4px;vertical-align:middle;}
/* 原生徽章实测：✅(fa-badge-check) 与 🎈(fa-balloon) 都是 1em 见方的 duotone SVG，
   配色由 luogu-native 按等级给出（写在 path 的 fill 上，不吃 currentColor）；
   称号是白字 + 等级色底 + 圆角 2px + .765em + 左右 .383em 内边距（底色跟随用户等级色）。 */
.luogusp-hc-badge{font-size:.765em;line-height:1.5;white-space:nowrap;}
.luogusp-hc-fa{width:1em;height:1em;display:inline-block;vertical-align:-.125em;overflow:visible;}
.luogusp-hc-status{font-size:.9em;font-weight:600;}
.luogusp-hc-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;}
.luogusp-hc-key{color:#8a8a8a;flex:0 0 auto;}
.luogusp-hc-val{text-align:right;word-break:break-all;min-width:0;}
/* 获奖等可能有多条，右对齐竖着码；别让它们挤成一行。 */
.luogusp-hc-stack{display:flex;flex-direction:column;align-items:flex-end;}
/* 个人签名默认压两行，展开到 6 行封顶（再多也截断，免得把卡片顶出视口）。
   webkit-box 是唯一跨浏览器可用的多行截断，Firefox 也实现了这套前缀属性。
   ★ 展开按钮压在**最后一行末尾**，白底盖住省略号的尾巴。 */
.luogusp-hc-slogan{position:relative;}
.luogusp-hc-clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}
.luogusp-hc-slogan.is-open .luogusp-hc-clamp{-webkit-line-clamp:6;}
.luogusp-hc-expand{position:absolute;right:0;bottom:0;border:0;padding:0 0 0 10px;background:linear-gradient(90deg,rgba(255,255,255,0) 0,#fff 10px,#fff 100%);color:#3498db;cursor:pointer;font:inherit;font-size:12px;line-height:inherit;}
.luogusp-hc-expand[hidden]{display:none;}
.luogusp-hc-sep{border-top:1px solid #f0f0f0;margin:8px 0 6px;}
.luogusp-hc-tags{margin-top:2px;}
.luogusp-hc-tagbtn{background:none;border:0;padding:0;color:#3498db;cursor:pointer;font:inherit;}
.luogusp-hc-taglist{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}
/* ★ canary.13 真机回归：标签默认就显示、切换按钮看着失效。根因是上面这条类选择器的
   display:flex 特异性高于 UA 样式表的 [hidden]{display:none}，于是 hidden 根本不起作用。
   任何给了 display 的元素都必须自己再声明一次 [hidden]。 */
.luogusp-hc-taglist[hidden]{display:none;}
.luogusp-hc-tag{font-size:11px;line-height:1.5;padding:0 6px;border-radius:3px;background:#eef4fb;color:#2b6ca3;}
/* ★ 按钮行必须能换行：拉黑状态下是「已拉黑 私信 专栏 举报 取消屏蔽」五个，
   320px 一行放不下，不换行就会撑出一条横向滚动条并把最后一个按钮切掉。 */
.luogusp-hc-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-top:10px;}
.luogusp-hc-btn{font-size:12px;line-height:1.5;padding:3px 12px;border-radius:3px;border:1px solid #3498db;background:#3498db;color:#fff;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-block;white-space:nowrap;}
.luogusp-hc-btn:hover{background:rgba(52,152,219,.9);}
.luogusp-hc-btn.is-off,.luogusp-hc-btn.is-ghost{background:#fff;color:#3498db;}
.luogusp-hc-btn.is-off:hover,.luogusp-hc-btn.is-ghost:hover{background:rgba(52,152,219,.08);}
/* 举报与屏蔽用洛谷自己的危险色（--lfe-color--red-3 = #e74c3c，原生菜单里这两项就是红的）。 */
.luogusp-hc-btn.is-danger{border-color:#e74c3c;color:#e74c3c;background:#fff;}
.luogusp-hc-btn.is-danger:hover{background:rgba(231,76,60,.08);}
.luogusp-hc-btn[disabled]{opacity:.55;cursor:default;}
/* 卡内就地确认：整条按钮行原地换成一句问话 + 确定/取消。不弹任何层 —— 卡片本来
   就贴在指针底下，再叠一个居中弹层反而要用户把鼠标移开，一移开卡片就收起来了。 */
.luogusp-hc-confirm{flex-wrap:wrap;}
.luogusp-hc-confirm-text{flex:1 1 100%;color:#e74c3c;font-size:12px;line-height:1.6;word-break:break-all;}
.luogusp-hc-link{color:#3498db;text-decoration:none;font-size:12px;}
.luogusp-hc-ok{color:#52c41a;}
.luogusp-hc-warn{color:#f39c11;}
.luogusp-hc-muted{color:#8a8a8a;}
.luogusp-hc-spin{width:16px;height:16px;border:2px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;animation:luogusp-hc-spin .8s linear infinite;margin:2px auto;}
@keyframes luogusp-hc-spin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.luogusp-hc-spin{animation-duration:1.8s;}}
`;
