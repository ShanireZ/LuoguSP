import { createLuoguSPApp } from "../app/create-luogusp-app.js";

export function runLuoguSP(restrictedLoadingGate) {
  const bootstrap = () => {
    try {
      createLuoguSPApp({ restrictedLoadingGate }).bootstrapBrowser();
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
