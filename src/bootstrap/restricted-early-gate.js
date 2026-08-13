import {
  LOADER_BACKDROP,
  LOADER_FONT,
  LOADER_MESSAGE_BOX,
  LOADER_SPINNER_BOX,
  LOADER_TEXT_COLOR,
} from "../features/restricted-content/loader-geometry.js";
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
            // 几何与壳内加载层同源（loader-geometry.js）：两者先后出现在同一位置，
            // 一旦不一致，切换瞬间转圈就会跳一下。
            style.textContent = `
              html.${className},html.${className} body{overflow:hidden!important;background:${LOADER_BACKDROP}!important;}
              html.${className} body>*{visibility:hidden!important;}
              html.${className}::before{content:"";${LOADER_SPINNER_BOX}z-index:2147483646;animation:luogusp-rst-early-spin .8s linear infinite;}
              html.${className}::after{content:"加载中…";${LOADER_MESSAGE_BOX}z-index:2147483646;color:${LOADER_TEXT_COLOR};font:${LOADER_FONT};}
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
