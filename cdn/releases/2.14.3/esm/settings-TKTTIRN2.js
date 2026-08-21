var y=`
  #luogusp-settings{position:fixed;inset:0;z-index:100000;font-size:14px;color:#222;}
  #luogusp-settings .luogusp-mask{position:absolute;inset:0;background:rgba(0,0,0,.35);}
  #luogusp-settings .luogusp-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#fff;border-radius:8px;padding:24px 30px;min-width:300px;box-shadow:0 8px 30px rgba(0,0,0,.2);}
  #luogusp-settings .luogusp-content{width:max-content;max-width:min(420px,calc(100vw - 88px));margin:0 auto;}
  #luogusp-settings h3{margin:0 0 12px;font-size:16px;}
  #luogusp-settings .luogusp-item{display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;}
  #luogusp-settings .luogusp-actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;}
  #luogusp-settings button{padding:5px 14px;border:1px solid #ccc;border-radius:5px;background:#f7f7f7;cursor:pointer;}
  #luogusp-settings button:not(.luogusp-primary):hover{background:#efefef;}
  #luogusp-settings .luogusp-primary{background:#0e88d3;border-color:#0e88d3;color:#fff;}
  #luogusp-settings .luogusp-primary:hover{background:#0879bd;border-color:#0879bd;color:#fff;}
  #luogusp-settings .luogusp-primary:active{background:#066ca9;border-color:#066ca9;color:#fff;}
  #luogusp-settings .luogusp-hint{margin:10px 0 0;color:#888;font-size:12px;}
  #luogusp-settings .luogusp-confirm{margin:0 0 16px;font-size:14px;line-height:1.6;}
  .luogusp-setting-entry{cursor:pointer;}
`;function z({storage:p,configurableFeatures:h}){let g={navContainers:["nav.lfe-body","nav.sidebar","nav.lside"],navText:".text, .title"},x=new Map(h.map(t=>[t.storageKey,t.label]));function k(){if(document.getElementById("luogusp-style"))return;let t=document.createElement("style");t.id="luogusp-style",t.textContent=y,(document.head||document.documentElement).appendChild(t)}let c=null;function S(){if(document.getElementById("luogusp-settings"))return;let t=document.createElement("div");t.id="luogusp-settings",t.innerHTML=`
      <div class="luogusp-mask"></div>
      <div class="luogusp-panel" role="dialog" aria-modal="true">
        <div class="luogusp-content">
          <h3>LuoguSP 功能设置</h3>
          <div class="luogusp-list">
            ${[...x].map(([o,s])=>`
              <label class="luogusp-item">
                <input type="checkbox" data-key="${o}" ${p.get(o)?"checked":""}>
                <span>${s}</span>
              </label>`).join("")}
          </div>
          <div class="luogusp-actions">
            <button data-act="all">全选</button>
            <button data-act="none">全不选</button>
            <button data-act="save" class="luogusp-primary">保存</button>
            <button data-act="close">关闭</button>
          </div>
          <p class="luogusp-hint">保存后需刷新页面生效。</p>
        </div>
      </div>`,document.body.appendChild(t);let e=()=>t.querySelectorAll('input[type="checkbox"]'),l=!1;function i(o){o.key==="Escape"&&a()}let a=()=>{l||(l=!0,t.remove(),document.removeEventListener("keydown",i),c===a&&(c=null))};c=a,t.addEventListener("click",o=>{let s=o.target;if(s.classList.contains("luogusp-mask"))return a();let n=s.getAttribute&&s.getAttribute("data-act");if(n==="close")return a();n==="all"&&e().forEach(u=>u.checked=!0),n==="none"&&e().forEach(u=>u.checked=!1),n==="save"&&(e().forEach(u=>p.set(u.dataset.key,u.checked)),a(),E())}),document.addEventListener("keydown",i)}function E(){let t=document.createElement("div");t.id="luogusp-settings",t.innerHTML='<div class="luogusp-mask"></div><div class="luogusp-panel" role="alertdialog" aria-modal="true"><div class="luogusp-content"><h3>设置已保存</h3><p class="luogusp-confirm">是否立即刷新页面生效？</p><div class="luogusp-actions"><button data-act="reload" class="luogusp-primary">立即刷新</button><button data-act="later">稍后</button></div></div></div>',document.body.appendChild(t);let e=!1,l=o=>{e||(e=!0,t.remove(),document.removeEventListener("keydown",i),o&&location.reload())};function i(o){o.key==="Escape"&&l(!1),o.key==="Enter"&&l(!0)}t.addEventListener("click",o=>{let s=o.target;if(s.classList.contains("luogusp-mask"))return l(!1);let n=s.getAttribute&&s.getAttribute("data-act");if(n==="reload")return l(!0);if(n==="later")return l(!1)}),document.addEventListener("keydown",i);let a=t.querySelector('[data-act="reload"]');a&&a.focus()}let w="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";function f(t){for(t.setAttribute("viewBox","0 0 24 24"),t.setAttribute("fill","currentColor");t.firstChild;)t.removeChild(t.firstChild);let e=document.createElementNS("http://www.w3.org/2000/svg","path");return e.setAttribute("d",w),t.appendChild(e),t}function A(t){let e=document.createElementNS("http://www.w3.org/2000/svg","svg");return t&&t.getAttribute("class")?e.setAttribute("class",t.getAttribute("class")):(e.style.width="1.1em",e.style.height="1.1em",e.style.marginRight=".4em",e.style.verticalAlign="middle"),f(e)}let L=["title","aria-label","aria-labelledby","data-title","data-tooltip","data-original-title"],m=t=>t.querySelector(g.navText);function b(){let t=null,e=null;for(let r of g.navContainers){let d=document.querySelector(r);if(d){t=d,e=r;break}}if(!t||t.querySelector(".luogusp-setting-entry"))return;let l=[...t.querySelectorAll("a")].filter(r=>r.querySelector("svg, img, .icon")&&m(r));if(!l.length)return;let i=l[l.length-1],a=i.closest("li"),o=a&&t.contains(a)?a:i,s=o.cloneNode(!0),n=s.matches("a")?s:s.querySelector("a");if(!n)return;for(let r of[s,...s.querySelectorAll("*")])for(let d of L)r.removeAttribute(d);n.removeAttribute("href"),n.removeAttribute("id"),n.classList.remove("router-link-active","router-link-exact-active","active"),n.classList.add("luogusp-setting-entry"),n.setAttribute("role","button");let u=m(n);u&&(e==="nav.lfe-body"?(u.textContent="",u.append("插件",document.createElement("br"),"设置")):u.textContent="插件设置");let v=n.querySelector("svg");if(v)f(v);else{let r=n.querySelector("img, i");r&&r.replaceWith(A(r))}s.setAttribute("title","插件设置"),n.setAttribute("aria-label","插件设置"),n.addEventListener("click",r=>{r.preventDefault(),r.stopPropagation(),S()}),o.parentNode.insertBefore(s,o.nextSibling)}function T(){let t=null,e=()=>{t=null;try{b()}catch(i){console.error("LuoguSP setting entry:",i)}},l=new MutationObserver(()=>{t===null&&(t=requestAnimationFrame(e))});return l.observe(document.body,{childList:!0,subtree:!0}),b(),()=>{l.disconnect(),t!==null&&cancelAnimationFrame(t),document.querySelectorAll(".luogusp-setting-entry").forEach(i=>(i.closest("li")||i).remove()),c&&c()}}return Object.freeze({id:"settings",mount:()=>(k(),T())})}export{z as createSettingsFeature};
