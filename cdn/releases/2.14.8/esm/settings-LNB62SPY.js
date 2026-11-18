var y=`
  #luogusp-settings{position:fixed;inset:0;z-index:2147483000;display:grid;grid-template:minmax(0,1fr)/minmax(0,1fr);
    place-items:center;box-sizing:border-box;padding:12px;font-size:14px;color:#222;}
  #luogusp-settings .luogusp-mask{position:absolute;inset:0;background:rgba(0,0,0,.35);}
  #luogusp-settings .luogusp-panel{position:relative;box-sizing:border-box;min-width:min(360px,100%);max-width:100%;max-height:100%;
    overflow:auto;overscroll-behavior:contain;background:#fff;border-radius:8px;padding:24px clamp(12px,5vw,30px);box-shadow:0 8px 30px rgba(0,0,0,.2);}
  #luogusp-settings .luogusp-content{width:max-content;max-width:min(420px,100%);margin:0 auto;overflow-wrap:anywhere;}
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
  @keyframes luogusp-settings-in{from{opacity:.8;}}
  @media (prefers-reduced-motion:no-preference){
    #luogusp-settings .luogusp-panel[role=dialog]{animation:luogusp-settings-in 160ms ease-out;}
  }
`;function $({storage:g,configurableFeatures:x}){let f={navContainers:["nav.lfe-body","nav.sidebar","nav.lside"],navText:".text, .title"},k=new Map(x.map(t=>[t.storageKey,t.label]));function w(){if(document.getElementById("luogusp-style"))return;let t=document.createElement("style");t.id="luogusp-style",t.textContent=y,(document.head||document.documentElement).appendChild(t)}let p=new Set,S=()=>{for(let t of[...p])t()};function m(t,o,r){let n=window.visualViewport,i=()=>{if(!n)return;t.style.inset=`${n.offsetTop}px auto auto ${n.offsetLeft}px`,t.style.width=`${n.width}px`,t.style.height=`${n.height}px`;let e=document.activeElement;t.contains(e)&&e.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"})},l=(e=!0)=>{n?.removeEventListener("resize",i),n?.removeEventListener("scroll",i),t.remove(),document.removeEventListener("keydown",a,!0),p.delete(l),e&&o.isConnected&&o.focus({preventScroll:!0})};function a(e){if(e.key==="Escape")e.preventDefault(),e.stopPropagation(),l();else if(e.key==="Tab"){let u=[...t.querySelectorAll("button:not(:disabled), input:not(:disabled)")],d=document.activeElement,s=e.shiftKey?u.at(-1):u[0],c=e.shiftKey?u[0]:u.at(-1);(!t.contains(d)||d===c)&&(e.preventDefault(),s?.focus())}}return i(),n?.addEventListener("resize",i),n?.addEventListener("scroll",i),document.body.appendChild(t),p.add(l),document.addEventListener("keydown",a,!0),(t.querySelector(r)||t.querySelector("button"))?.focus(),l}function E(t){if(document.getElementById("luogusp-settings"))return;let o=document.createElement("div");o.id="luogusp-settings",o.innerHTML=`
      <div class="luogusp-mask"></div>
      <div class="luogusp-panel" role="dialog" aria-modal="true" aria-labelledby="luogusp-settings-title">
        <div class="luogusp-content">
          <h3 id="luogusp-settings-title">LuoguSP 功能设置</h3>
          <div class="luogusp-list">
            ${[...k].map(([i,l])=>`
              <label class="luogusp-item">
                <input type="checkbox" data-key="${i}" ${g.get(i)?"checked":""}>
                <span>${l}</span>
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
      </div>`;let r=()=>o.querySelectorAll('input[type="checkbox"]'),n=m(o,t,'input[type="checkbox"]');o.addEventListener("click",i=>{let l=i.target;if(l.classList.contains("luogusp-mask"))return n();let a=l.getAttribute&&l.getAttribute("data-act");if(a==="close")return n();a==="all"&&r().forEach(e=>e.checked=!0),a==="none"&&r().forEach(e=>e.checked=!1),a==="save"&&(r().forEach(e=>g.set(e.dataset.key,e.checked)),n(!1),A(t))})}function A(t){let o=document.createElement("div");o.id="luogusp-settings",o.innerHTML='<div class="luogusp-mask"></div><div class="luogusp-panel" role="alertdialog" aria-modal="true" aria-labelledby="luogusp-settings-title" aria-describedby="luogusp-settings-confirm"><div class="luogusp-content"><h3 id="luogusp-settings-title">设置已保存</h3><p class="luogusp-confirm" id="luogusp-settings-confirm">是否立即刷新页面生效？</p><div class="luogusp-actions"><button data-act="reload" class="luogusp-primary">立即刷新</button><button data-act="later">稍后</button></div></div></div>';let r=m(o,t,'[data-act="later"]');o.addEventListener("click",n=>{let i=n.target;if(i.classList.contains("luogusp-mask"))return r();let l=i.getAttribute&&i.getAttribute("data-act");l==="reload"&&(r(!1),location.reload()),l==="later"&&r()})}let L="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";function b(t){for(t.setAttribute("viewBox","0 0 24 24"),t.setAttribute("fill","currentColor");t.firstChild;)t.removeChild(t.firstChild);let o=document.createElementNS("http://www.w3.org/2000/svg","path");return o.setAttribute("d",L),t.appendChild(o),t}function T(t){let o=document.createElementNS("http://www.w3.org/2000/svg","svg");return t&&t.getAttribute("class")?o.setAttribute("class",t.getAttribute("class")):(o.style.width="1.1em",o.style.height="1.1em",o.style.marginRight=".4em",o.style.verticalAlign="middle"),b(o)}let q=["title","aria-label","aria-labelledby","data-title","data-tooltip","data-original-title"],v=t=>t.querySelector(f.navText);function h(){let t=null,o=null;for(let s of f.navContainers){let c=document.querySelector(s);if(c){t=c,o=s;break}}if(!t||t.querySelector(".luogusp-setting-entry"))return;let r=[...t.querySelectorAll("a")].filter(s=>s.querySelector("svg, img, .icon")&&v(s));if(!r.length)return;let n=r[r.length-1],i=n.closest("li"),l=i&&t.contains(i)?i:n,a=l.cloneNode(!0),e=a.matches("a")?a:a.querySelector("a");if(!e)return;for(let s of[a,...a.querySelectorAll("*")])for(let c of q)s.removeAttribute(c);e.removeAttribute("href"),e.removeAttribute("id"),e.classList.remove("router-link-active","router-link-exact-active","active"),e.classList.add("luogusp-setting-entry"),e.setAttribute("role","button"),e.tabIndex=0;let u=v(e);u&&(o==="nav.lfe-body"?(u.textContent="",u.append("插件",document.createElement("br"),"设置")):u.textContent="插件设置");let d=e.querySelector("svg");if(d)b(d);else{let s=e.querySelector("img, i");s&&s.replaceWith(T(s))}a.setAttribute("title","插件设置"),e.setAttribute("aria-label","插件设置"),e.addEventListener("click",s=>{s.preventDefault(),s.stopPropagation(),E(e)}),e.addEventListener("keydown",s=>{s.key!=="Enter"&&s.key!==" "||(s.preventDefault(),e.click())}),l.parentNode.insertBefore(a,l.nextSibling)}function C(){let t=null,o=()=>{t=null;try{h()}catch(n){console.error("LuoguSP setting entry:",n)}},r=new MutationObserver(()=>{t===null&&(t=requestAnimationFrame(o))});return r.observe(document.body,{childList:!0,subtree:!0}),h(),()=>{r.disconnect(),t!==null&&cancelAnimationFrame(t),document.querySelectorAll(".luogusp-setting-entry").forEach(n=>(n.closest("li")||n).remove()),S()}}return Object.freeze({id:"settings",mount:()=>(w(),C())})}export{$ as createSettingsFeature};
