import { createBrowserStorage, createLuoguSPApp } from "../app/create-luogusp-app.js";
import { createProblemColorFeature } from "../features/problem-color/feature.js";
import { createBrowserProblemResources } from "../browser/luogu-problem-resources.js";

export function runLuoguSP(restrictedLoadingGate, options = {}) {
  const storage = options.storageAdapter || createBrowserStorage();
  const problemResources = createBrowserProblemResources();
  const problemColorFeature = createProblemColorFeature({ storage, problemResources });
  // Observe parser-created nodes at document-start. The other features still
  // wait for DOMContentLoaded; the lifecycle then adopts this same instance.
  let disposeEarly = null;
  let stopProblemObserver;
  const disposeStartup = () => {
    disposeEarly?.();
    stopProblemObserver?.();
    restrictedLoadingGate.release();
  };
  try {
    stopProblemObserver = problemResources?.observer.mount();
    const enabled = !storage.has(problemColorFeature.storageKey) || problemColorFeature.enabled();
    if (document.readyState === "loading" && enabled)
      disposeEarly = problemColorFeature.mount({ isCurrent: () => true });
  } catch (error) {
    disposeStartup();
    throw error;
  }
  const bootstrap = () => {
    try {
      createLuoguSPApp({
        restrictedLoadingGate,
        ...options,
        storageAdapter: storage,
        problemResources,
        problemColorFeature,
      }).bootstrapBrowser();
    } catch (error) {
      disposeStartup();
      throw error;
    }
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bootstrap, {
      once: true,
    });
  else bootstrap();
}
