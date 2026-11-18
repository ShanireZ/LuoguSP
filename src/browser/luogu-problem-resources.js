import { createGetRequestScheduler } from "../core/get-request-scheduler.js";
import { createNativeDifficultySource } from "../features/problem-color/native-difficulty-source.js";
import { createProblemData, LENTILLE_INIT } from "../features/problem-color/problem-data.js";
import { getMediaType, matchesGetUrl, SAME_ORIGIN_GET } from "./luogu-get-response.js";
import { createNativeUserInfo } from "./luogu-user-info.js";

export function createBrowserProblemResources() {
  if (typeof document === "undefined") return null;
  const origin = location.origin;
  const clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const scheduler = createGetRequestScheduler({
    fetch: async (path, init) => {
      const expectedUrl = new URL(path, origin).href;
      const response = await fetch(expectedUrl, { ...init, ...SAME_ORIGIN_GET, ...LENTILLE_INIT });
      if (!matchesGetUrl(response, expectedUrl)) throw new Error("Unexpected problem response URL");
      if (response.ok) {
        if (response.status !== 200) throw new Error(`Unexpected problem response status ${response.status}`);
        const mediaType = getMediaType(response);
        if (mediaType !== "application/json" && mediaType !== "text/html")
          throw new Error("Unexpected problem response media type");
      }
      return response;
    },
    clock,
  });
  const data = createProblemData({
    origin,
    text: scheduler.text,
    refresh: () => native.harvest(),
    legacyViewer: () => {
      const uid = Number(globalThis._feInjection?.currentUser?.uid);
      return Number.isSafeInteger(uid) && uid > 0 ? uid : 0;
    },
  });
  const userInfo = createNativeUserInfo({ origin, viewer: data.viewerUid });
  const native = createNativeDifficultySource({
    document,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    origin,
    onPage: data.rememberPage,
    prepareOtherGet: userInfo.prepare,
  });
  let stop;
  const observer = Object.freeze({
    id: "problem-data-observer",
    keepMountedOnRoute: true,
    mount() {
      if (!stop) stop = native.subscribe(() => {});
      return () => {
        stop?.();
        stop = null;
      };
    },
  });
  return Object.freeze({ data, native, observer, userInfo });
}
