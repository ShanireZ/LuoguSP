import { createBrowserStorage, createLuoguSPApp } from "../app/create-luogusp-app.js";
import { createProblemColorFeature } from "../features/problem-color/feature.js";

export function runLuoguSP(restrictedLoadingGate, options = {}) {
  const storage = options.storageAdapter || createBrowserStorage();
  const problemColorFeature = createProblemColorFeature({ storage });
  // Observe parser-created nodes at document-start. The other features still
  // wait for DOMContentLoaded; the lifecycle then adopts this same instance.
  let disposeEarly = null;
  try {
    const enabled = !storage.has(problemColorFeature.storageKey) || problemColorFeature.enabled();
    if (document.readyState === "loading" && enabled)
      disposeEarly = problemColorFeature.mount({ isCurrent: () => true });
  } catch (error) {
    restrictedLoadingGate.release();
    throw error;
  }
  const bootstrap = () => {
    try {
      createLuoguSPApp({
        restrictedLoadingGate,
        ...options,
        storageAdapter: storage,
        problemColorFeature,
      }).bootstrapBrowser();
    } catch (error) {
      if (disposeEarly) disposeEarly();
      restrictedLoadingGate.release();
      throw error;
    }
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bootstrap, {
      once: true,
    });
  else bootstrap();
}
