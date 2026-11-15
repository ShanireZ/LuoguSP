import { createGetRequestScheduler } from "../core/get-request-scheduler.js";
import { createNativeDifficultySource } from "../features/problem-color/native-difficulty-source.js";
import { createProblemData, LENTILLE_INIT } from "../features/problem-color/problem-data.js";
import { createNativeUserInfo } from "./luogu-user-info.js";

export function createBrowserProblemResources() {
  if (typeof document === "undefined") return null;
  const clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const scheduler = createGetRequestScheduler({
    fetch: (url, init) => fetch(url, { ...init, ...LENTILLE_INIT }),
    clock,
  });
  const userInfo = createNativeUserInfo({ origin: location.origin, viewer: () => data.viewerUid() });
  const native = createNativeDifficultySource({
    document,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    origin: location.origin,
    onPage: (page, url, at) => data.rememberPage(page, url, at),
    prepareOtherGet: userInfo.prepare,
  });
  const data = createProblemData({
    origin: location.origin,
    text: scheduler.text,
    refresh: native.harvest,
    legacyViewer: () => {
      const uid = Number(globalThis._feInjection?.currentUser?.uid);
      return Number.isSafeInteger(uid) && uid > 0 ? uid : 0;
    },
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
