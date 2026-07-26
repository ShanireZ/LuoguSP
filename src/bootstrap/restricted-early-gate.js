import { createRestrictedLoadingGate } from "../features/restricted-content/loading-gate.js";

const SHARED_GATE_KEY = "__LUOGUSP_RESTRICTED_LOADING_GATE_V1__";

function createGate() {
  return createRestrictedLoadingGate({
    pageAdapter: {
      currentPath: () => location.pathname,
      isEnabled: () => {
        try {
          const value = localStorage.getItem(
            "LuoguSP.showRestrictedContent",
          );
          return value === null || value === "true";
        } catch (error) {
          return false;
        }
      },
      isCandidateRoute: (path) =>
        /^\/(article|paste)\/[A-Za-z0-9]+\/?$/.test(path),
    },
    overlayAdapter: {
      mount: () => {
        const className = "luogusp-rst-preparing";
        const styleId = "luogusp-rst-early-style";
        let observer = null;
        let mountedRoot = null;
        let previousBusy = null;
        const attach = () => {
          const root = document.documentElement;
          if (!root) return false;
          mountedRoot = root;
          previousBusy = root.getAttribute("aria-busy");
          root.setAttribute("aria-busy", "true");
          root.classList.add(className);
          if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
              html.${className},html.${className} body{overflow:hidden!important;background:#f5f5f5!important;}
              html.${className} body>*{visibility:hidden!important;}
              html.${className}::before{content:"";position:fixed;left:50%;top:50%;z-index:2147483646;width:36px;height:36px;margin:-31px 0 0 -21px;border:3px solid rgba(52,152,219,.25);border-top-color:#3498db;border-radius:50%;animation:luogusp-rst-early-spin .8s linear infinite;}
              html.${className}::after{content:"加载中…";position:fixed;left:0;right:0;top:calc(50% + 17px);z-index:2147483646;color:#595959;text-align:center;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;}
              @keyframes luogusp-rst-early-spin{to{transform:rotate(360deg);}}
              @media (prefers-reduced-motion:reduce){html.${className}::before{animation-duration:1.8s;}}
            `;
            (document.head || root).appendChild(style);
          }
          return true;
        };
        if (!attach()) {
          observer = new MutationObserver(() => {
            if (!attach()) return;
            observer.disconnect();
            observer = null;
          });
          observer.observe(document, { childList: true, subtree: true });
        }
        return () => {
          if (observer) observer.disconnect();
          observer = null;
          const root = mountedRoot || document.documentElement;
          if (root) {
            root.classList.remove(className);
            if (previousBusy === null)
              root.removeAttribute("aria-busy");
            else root.setAttribute("aria-busy", previousBusy);
          }
          const style = document.getElementById(styleId);
          if (style) style.remove();
        };
      },
    },
  });
}

export function installRestrictedEarlyGate() {
  const existing = globalThis[SHARED_GATE_KEY];
  if (
    existing &&
    typeof existing.start === "function" &&
    typeof existing.release === "function"
  )
    return existing;

  const gate = createGate();
  Object.defineProperty(globalThis, SHARED_GATE_KEY, {
    value: gate,
    configurable: true,
  });
  try {
    gate.start();
  } catch (error) {
    console.error("LuoguSP restricted early loader:", error);
  }
  return gate;
}
