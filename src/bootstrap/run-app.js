import { createLuoguSPApp } from "../app/create-luogusp-app.js";

export function runLuoguSP(restrictedLoadingGate, options = {}) {
  const bootstrap = () => {
    try {
      createLuoguSPApp({
        restrictedLoadingGate,
        ...options,
      }).bootstrapBrowser();
    } catch (error) {
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
