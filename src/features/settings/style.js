export const SETTINGS_STYLE = `
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
  #luogusp-settings .luogusp-primary{background:#0876b8;border-color:#0876b8;color:#fff;}
  #luogusp-settings .luogusp-primary:hover{background:#076faf;border-color:#076faf;color:#fff;}
  #luogusp-settings .luogusp-primary:active{background:#0667a2;border-color:#0667a2;color:#fff;}
  #luogusp-settings .luogusp-hint{margin:10px 0 0;color:#717171;font-size:12px;}
  #luogusp-settings .luogusp-confirm{margin:0 0 16px;font-size:14px;line-height:1.6;}
  .luogusp-setting-entry{cursor:pointer;}
  @keyframes luogusp-settings-in{from{opacity:.8;}}
  @media (prefers-reduced-motion:no-preference){
    #luogusp-settings .luogusp-panel[role=dialog]{animation:luogusp-settings-in 160ms ease-out;}
  }
`;
