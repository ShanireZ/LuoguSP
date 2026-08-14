import { createBrowserRouteAdapter } from "../core/browser-route-adapter.js";
import { createPageLifecycle } from "../core/page-lifecycle.js";
import { createHiddenIntroFeature } from "../features/hidden-intro/feature.js";
import { createIdeBatchFeature } from "../features/ide-batch/feature.js";
import { createProblemColorFeature } from "../features/problem-color/feature.js";
import { createHoverCardFeatures } from "../features/hover-card/lazy-feature.js";
import { createRestrictedContentFeature } from "../features/restricted-content/lazy-feature.js";
import { createSettingsFeature } from "../features/settings/feature.js";

function createBrowserStorage() {
  return Object.freeze({
    get: (key) => localStorage.getItem(key) === "true",
    set: (key, value) => localStorage.setItem(key, String(value)),
    has: (key) => localStorage.getItem(key) !== null,
  });
}

function createDefaultRouteAdapter() {
  if (typeof window === "undefined")
    return Object.freeze({
      token: () => "",
      subscribe: () => () => {},
    });
  return createBrowserRouteAdapter({
    history,
    eventTarget: window,
    token: () =>
      `${location.pathname}${location.search}${location.hash}`,
    logError: (error) => console.error("LuoguSP route:", error),
  });
}

function createDocumentAdapter() {
  return Object.freeze({
    schedule: (callback) => {
      const frame = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(frame);
    },
    whenReady: (callback) => {
      if (document.body) return callback();
      let active = true;
      const ready = () => {
        if (active) callback();
      };
      document.addEventListener("DOMContentLoaded", ready, {
        once: true,
      });
      return () => {
        active = false;
        document.removeEventListener("DOMContentLoaded", ready);
      };
    },
  });
}

export function createLuoguSPApp(options = {}) {
  const storage = options.storageAdapter || createBrowserStorage();
  const routeAdapter = options.routeAdapter || createDefaultRouteAdapter();
  const restrictedLoadingGate = options.restrictedLoadingGate || null;
  let pageLifecycle = null;

  const problemColorFeature = createProblemColorFeature({ storage });
  const hiddenIntroFeature = createHiddenIntroFeature({
    storage,
    nativeIntroAdapter: options.hiddenIntroNativeAdapter,
    rendererConfig: options.hiddenIntroRendererConfig,
    onDiagnostic: options.hiddenIntroDiagnosticReporter,
  });
  const ideBatchFeature = createIdeBatchFeature({
    storage,
    idePreparationAdapter: options.idePreparationAdapter,
  });
  const restrictedContentFeature = createRestrictedContentFeature({
    storage,
    restrictedLoadingGate,
    getPageLifecycle: () => pageLifecycle,
    loadBundle: options.restrictedContentLoadBundle,
  });
  const hoverCardFeatures = createHoverCardFeatures({
    storage,
    loadBundle: options.hoverCardLoadBundle,
    fetchPage: options.hoverCardFetchPage,
  });
  // ★ 这个数组的顺序**就是设置面板里的顺序**（owner 2026-08-14 第四轮点名要的排法）。
  const configurableFeatures = Object.freeze([
    problemColorFeature,
    hoverCardFeatures.problem,
    hoverCardFeatures.user,
    hiddenIntroFeature,
    restrictedContentFeature,
    ideBatchFeature,
  ]);
  const settingsFeature = createSettingsFeature({
    storage,
    configurableFeatures,
  });

  pageLifecycle = createPageLifecycle({
    routeAdapter,
    documentAdapter: createDocumentAdapter(),
    storage,
    logError: (id, error) =>
      console.error(`LuoguSP lifecycle ${id}:`, error),
  });
  pageLifecycle.register(settingsFeature);
  configurableFeatures.forEach((feature) =>
    pageLifecycle.register(feature),
  );

  const initializeFeatureDefaults = () => {
    for (const feature of configurableFeatures) {
      if (!storage.has(feature.storageKey))
        storage.set(feature.storageKey, feature.defaultEnabled);
    }
  };

  let bootstrapped = false;
  const bootstrapAdapter =
    options.bootstrapAdapter ||
    Object.freeze({
      initialize: initializeFeatureDefaults,
      start: () => pageLifecycle.start(),
    });
  const bootstrapBrowser = () => {
    if (bootstrapped) return;
    bootstrapped = true;
    bootstrapAdapter.initialize();
    bootstrapAdapter.start();
  };

  const app = { bootstrapBrowser };
  if (options.exposeTestInterface) {
    app.test = Object.freeze({
      startIdeBatch: ideBatchFeature.start,
      ideState: ideBatchFeature.getState,
    });
  }
  return Object.freeze(app);
}
