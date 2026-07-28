var h=`
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
  .luogusp-setting-entry{cursor:pointer;}
`;function T({storage:d,configurableFeatures:y}){let p={navContainers:["nav.lfe-body","nav.sidebar"],navText:".text, .title"},x=new Map(y.map(t=>[t.storageKey,t.label]));function S(){if(document.getElementById("luogusp-style"))return;let t=document.createElement("style");t.id="luogusp-style",t.textContent=h,(document.head||document.documentElement).appendChild(t)}let a=null;function k(){if(document.getElementById("luogusp-settings"))return;let t=document.createElement("div");t.id="luogusp-settings",t.innerHTML=`
      <div class="luogusp-mask"></div>
      <div class="luogusp-panel" role="dialog" aria-modal="true">
        <div class="luogusp-content">
          <h3>LuoguSP 功能设置</h3>
          <div class="luogusp-list">
            ${[...x].map(([i,u])=>`
              <label class="luogusp-item">
                <input type="checkbox" data-key="${i}" ${d.get(i)?"checked":""}>
                <span>${u}</span>
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
      </div>`,document.body.appendChild(t);let e=()=>t.querySelectorAll('input[type="checkbox"]'),c=!1;function l(i){i.key==="Escape"&&r()}let r=()=>{c||(c=!0,t.remove(),document.removeEventListener("keydown",l),a===r&&(a=null))};a=r,t.addEventListener("click",i=>{let u=i.target;if(u.classList.contains("luogusp-mask"))return r();let n=u.getAttribute&&u.getAttribute("data-act");if(n==="close")return r();n==="all"&&e().forEach(s=>s.checked=!0),n==="none"&&e().forEach(s=>s.checked=!1),n==="save"&&(e().forEach(s=>d.set(s.dataset.key,s.checked)),r(),confirm("设置已保存，是否立即刷新页面生效？")&&location.reload())}),document.addEventListener("keydown",l)}let E="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";function g(t){for(t.setAttribute("viewBox","0 0 24 24"),t.setAttribute("fill","currentColor");t.firstChild;)t.removeChild(t.firstChild);let e=document.createElementNS("http://www.w3.org/2000/svg","path");return e.setAttribute("d",E),t.appendChild(e),t}function w(t){let e=document.createElementNS("http://www.w3.org/2000/svg","svg");return t&&t.getAttribute("class")?e.setAttribute("class",t.getAttribute("class")):(e.style.width="1.1em",e.style.height="1.1em",e.style.marginRight=".4em",e.style.verticalAlign="middle"),g(e)}let f=t=>t.querySelector(p.navText);function m(){let t=null,e=null;for(let o of p.navContainers){let v=document.querySelector(o);if(v){t=v,e=o;break}}if(!t||t.querySelector(".luogusp-setting-entry"))return;let c=[...t.querySelectorAll("a")].filter(o=>o.querySelector("svg, img, .icon")&&f(o));if(!c.length)return;let l=c[c.length-1],r=l.closest("li"),i=r&&t.contains(r)?r:l,u=i.cloneNode(!0),n=u.matches("a")?u:u.querySelector("a");if(!n)return;n.removeAttribute("href"),n.removeAttribute("id"),n.classList.remove("router-link-active","router-link-exact-active","active"),n.classList.add("luogusp-setting-entry"),n.setAttribute("role","button");let s=f(n);s&&(e==="nav.lfe-body"?(s.textContent="",s.append("插件",document.createElement("br"),"设置")):s.textContent="插件设置");let b=n.querySelector("svg");if(b)g(b);else{let o=n.querySelector("img, i");o&&o.replaceWith(w(o))}n.addEventListener("click",o=>{o.preventDefault(),o.stopPropagation(),k()}),i.parentNode.insertBefore(u,i.nextSibling)}function A(){let t=null,e=()=>{t=null;try{m()}catch(l){console.error("LuoguSP setting entry:",l)}},c=new MutationObserver(()=>{t===null&&(t=requestAnimationFrame(e))});return c.observe(document.body,{childList:!0,subtree:!0}),m(),()=>{c.disconnect(),t!==null&&cancelAnimationFrame(t),document.querySelectorAll(".luogusp-setting-entry").forEach(l=>(l.closest("li")||l).remove()),a&&a()}}return Object.freeze({id:"settings",mount:()=>(S(),A())})}export{T as createSettingsFeature};
