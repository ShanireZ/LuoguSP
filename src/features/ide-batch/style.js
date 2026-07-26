export const IDE_BATCH_STYLE = `
  .luogusp-ide-tabbar{display:flex;gap:20px;padding:0 12px;border-bottom:1px solid #e8e8e8;flex:none;}
  .luogusp-ide-tab{font-size:13px;color:#606266;padding:7px 2px 5px;cursor:pointer;border-bottom:2px solid transparent;}
  .luogusp-ide-tab.on{color:#3498db;border-bottom-color:#3498db;font-weight:500;}
  .luogusp-ide-panel{overflow:auto;flex:1 1 0;min-height:0;padding:8px 12px 12px;font-size:13px;color:#333;}
  .luogusp-ide-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
  .luogusp-ide-title{font-weight:500;}
  .luogusp-ide-summary{font-size:12px;color:#888;}
  .luogusp-ide-headbtns{margin-left:auto;display:flex;gap:6px;}
  .luogusp-ide-row{border:1px solid #e8e8e8;border-radius:6px;margin:0 0 8px;background:#fff;overflow:hidden;}
  .luogusp-ide-rowhead{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;}
  .luogusp-ide-rowhead:hover{background:#f7fbfe;}
  .luogusp-ide-chev{color:#999;width:10px;transition:transform .2s;}
  .luogusp-ide-row.open .luogusp-ide-chev{transform:rotate(90deg);}
  .luogusp-ide-meta{font-size:12px;color:#999;margin-left:auto;}
  .luogusp-ide-pill{font-size:12px;padding:1px 10px;border-radius:10px;border:1px solid transparent;white-space:nowrap;}
  .luogusp-ide-detail{display:none;border-top:1px solid #eee;background:#fcfcfc;padding:10px 12px;}
  .luogusp-ide-row.open .luogusp-ide-detail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
  .luogusp-ide-row.open .luogusp-ide-detail.luogusp-ide-log{display:block;}
  @media (max-width:1500px){.luogusp-ide-row.open .luogusp-ide-detail{grid-template-columns:1fr;}}
  .luogusp-ide-pane h5{margin:0 0 4px;font-size:12px;font-weight:500;color:#888;}
  .luogusp-ide-pane .code-container{margin:0;}
  .luogusp-ide-pane pre{margin:0;border:1px solid #e6e6e6;border-radius:4px;background:#fff;padding:6px 8px;font-size:12px;line-height:1.55;color:#333;overflow-x:auto;min-height:40px;font-family:"Fira Code","Fira Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace;}
  .luogusp-ide-pane .luogusp-ide-diffline{background:#fcebeb;color:#a32d2d;display:block;margin:0 -8px;padding:0 8px;}
  .luogusp-ide-note{font-size:12px;color:#a32d2d;margin:0 0 8px;}
  .luogusp-ide-empty{color:#aaa;font-style:italic;}
  .luogusp-ide-panel .code-container:hover>.copy-button{opacity:1;}
  .luogusp-ide-panel .copy-button{position:absolute;top:.3em;right:.3em;padding:.45em;display:flex;align-items:center;justify-content:center;transition:opacity .2s;opacity:0;background:transparent;border:0;border-radius:4px;cursor:pointer;color:#555;}
  .luogusp-ide-panel .copy-button.copied{color:#52c41a;}
  .luogusp-ide-panel .copy-icon{width:1em;height:1em;}
`;
