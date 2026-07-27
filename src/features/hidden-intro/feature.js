import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { createHiddenIntroDiagnostics } from "./diagnostics.js";
import { createFallbackIntroController } from "./fallback-intro-controller.js";
import { createNativeIntroAdapter } from "./native-intro-adapter.js";
import { HIDDEN_INTRO_STYLE } from "./style.js";

const documentRouteStates = new WeakMap();

export function createHiddenIntroFeature({
  storage,
  nativeIntroAdapter,
  fallbackIntroController,
  rendererConfig,
  onDiagnostic,
} = {}) {
  const SELECTORS = {
    userIntroColumn: ".sidebar-container .main",
    nativeIntro: ".introduction:not(.luogusp-intro-card *)",
  };
  const diagnostics = createHiddenIntroDiagnostics(onDiagnostic);
  let nativeAdapter = nativeIntroAdapter || null;
  let fallbackController = fallbackIntroController || null;
  const introWaiters = new Set();

  const getNativeAdapter = () => {
    if (!nativeAdapter) nativeAdapter = createNativeIntroAdapter();
    return nativeAdapter;
  };
  const getFallbackController = () => {
    if (!fallbackController)
      fallbackController = createFallbackIntroController({
        diagnostics,
        rendererConfig,
      });
    return fallbackController;
  };
  const nativeVisible = () =>
    !!document.querySelector(SELECTORS.nativeIntro);

  const injectStyle = () => {
    if (document.getElementById("luogusp-intro-style")) return;
    const style = document.createElement("style");
    style.id = "luogusp-intro-style";
    style.textContent = HIDDEN_INTRO_STYLE;
    (document.head || document.documentElement).appendChild(style);
  };

  function currentUserRoute() {
    const match = location.pathname.match(/^\/(?:user|space)\/(\d+)/);
    const hash = location.hash || "";
    return {
      uid: match ? match[1] : "",
      key: match
        ? `${location.pathname}${location.search}${hash}`
        : "",
      isHome:
        !!match &&
        (!hash || hash === "#" || hash === "#home" || hash === "#main"),
    };
  }

  async function showHiddenIntro(
    expectedRoute,
    lifecycleContext,
    signal,
    onNativeAttached,
    trustExistingNative = false,
  ) {
    const route = expectedRoute || currentUserRoute();
    if (!route.uid || !route.isHome) return;
    const uid = route.uid;
    const routeKey = route.key;
    const stillCurrent = () => {
      const current = currentUserRoute();
      return (
        !signal?.aborted &&
        (!lifecycleContext || lifecycleContext.isCurrent()) &&
        current.uid === uid &&
        current.key === routeKey &&
        current.isHome
      );
    };
    const fallback = getFallbackController();
    fallback.removeCards();
    const introduction = await fallback.getIntroduction(uid, signal);
    if (!stillCurrent() || !introduction?.trim()) return;
    if (trustExistingNative && nativeVisible()) {
      diagnostics.set("already-native");
      return;
    }
    let nativeResult;
    try {
      nativeResult = await getNativeAdapter().attach({
        uid,
        introduction,
        signal,
      });
    } catch (error) {
      nativeResult = {
        status: "native-unsupported",
        reason: "adapter-error",
      };
      console.debug("LuoguSP hidden-intro native:", nativeResult);
    }
    if (!stillCurrent()) {
      nativeResult.restore?.();
      return;
    }
    if (
      trustExistingNative &&
      nativeResult.status !== "native-attached" &&
      nativeVisible()
    ) {
      nativeResult.restore?.();
      diagnostics.set("already-native");
      return;
    }
    diagnostics.set(nativeResult.status, nativeResult.reason || null);
    if (nativeResult.status === "native-attached") {
      onNativeAttached?.({ routeKey, restore: nativeResult.restore });
      return;
    }
    if (nativeResult.status === "already-native") return;

    const place = () => {
      if (!stillCurrent()) return true;
      if (fallback.hasCard()) return true;
      if (nativeVisible()) return false;
      const column = document.querySelector(SELECTORS.userIntroColumn);
      if (!column) return false;
      const mounted = fallback.mount({
        column,
        introduction,
        signal,
        isCurrent: stillCurrent,
      });
      mounted.ready.catch((error) => {
        if (!signal?.aborted)
          console.error("LuoguSP intro fallback:", error);
      });
      return true;
    };
    if (place()) return;

    let timer = null;
    const observer = new MutationObserver(() => {
      if (place()) cleanup();
    });
    const cleanup = () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      introWaiters.delete(cleanup);
    };
    introWaiters.add(cleanup);
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(cleanup, 8000);
  }

  function watchHiddenIntro(lifecycleContext) {
    const controller = new AbortController();
    const fallback = getFallbackController();
    let requestedRouteKey = "";
    let nativeAttachment = null;
    let routeState = documentRouteStates.get(document);
    if (!routeState) {
      routeState = { lastRouteKey: null, transitioned: false };
      documentRouteStates.set(document, routeState);
    }
    const restoreNativeAttachment = () => {
      if (!nativeAttachment) return;
      nativeAttachment.restore?.();
      nativeAttachment = null;
    };
    const attachNative = (attachment) => {
      restoreNativeAttachment();
      nativeAttachment = attachment;
    };
    const check = () => {
      const route = currentUserRoute();
      if (
        routeState.lastRouteKey !== null &&
        routeState.lastRouteKey !== route.key
      )
        routeState.transitioned = true;
      routeState.lastRouteKey = route.key;
      if (nativeAttachment && nativeAttachment.routeKey !== route.key)
        restoreNativeAttachment();
      if (!route.uid || !route.isHome) {
        restoreNativeAttachment();
        fallback.removeCards();
        requestedRouteKey = "";
        return;
      }
      if (nativeVisible()) {
        fallback.removeCards();
        if (!routeState.transitioned) {
          diagnostics.set("already-native");
          requestedRouteKey = route.key;
          return;
        }
        if (nativeAttachment) {
          requestedRouteKey = route.key;
          return;
        }
        if (
          requestedRouteKey !== route.key &&
          getNativeAdapter().isVisibleForUser?.({ uid: route.uid })
        ) {
          diagnostics.set("already-native");
          requestedRouteKey = route.key;
          return;
        }
      }
      if (fallback.hasCard()) {
        requestedRouteKey = route.key;
        return;
      }
      if (route.key !== requestedRouteKey) {
        requestedRouteKey = route.key;
        showHiddenIntro(
          route,
          lifecycleContext,
          controller.signal,
          attachNative,
          !routeState.transitioned,
        ).catch((error) => {
          if (!controller.signal.aborted)
            console.error("LuoguSP intro render:", error);
        });
      }
    };

    check();
    let frame = null;
    const queueCheck = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        check();
      });
    };
    const observer = new MutationObserver(queueCheck);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      controller.abort();
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      restoreNativeAttachment();
      for (const cleanup of [...introWaiters]) cleanup();
      fallback.removeCards();
    };
  }

  const feature = defineConfigurableFeature({
    id: "hidden-intro",
    key: "showIntro",
    label: "个人页显示个人介绍",
    storage,
    mount: (context) => {
      injectStyle();
      return watchHiddenIntro(context);
    },
  });
  return Object.freeze({ ...feature, getDiagnostics: diagnostics.get });
}
