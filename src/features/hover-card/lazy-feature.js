import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { readCsrfToken, readViewerUid, resolveHoverTarget } from "./anchors.js";
import { isPreviewShortcut } from "./hover-intent.js";

// Both settings share one optional bundle and one delegated preview instance.
export function createHoverCardFeatures(config) {
  const {
    storage,
    loadBundle,
    fetchPage,
    problemData,
    nativeUserInfo,
    logError = (error) => console.error("LuoguSP hover card bundle:", error),
  } = config || {};

  let feature = null;
  let pending = null;
  let unavailable = false;

  const ensureFeature = () => {
    if (feature) return Promise.resolve(feature);
    if (unavailable) return Promise.resolve(null);
    // 沒人串接就等於功能不存在，必須報出來 —— 靜默會偽裝成「功能沒做」。
    if (typeof loadBundle !== "function") {
      unavailable = true;
      logError(new TypeError("hover 卡功能块的加载器未接线"));
      return Promise.resolve(null);
    }
    if (!pending)
      pending = Promise.resolve()
        .then(() => loadBundle())
        .then((module) => {
          const create =
            module && typeof module.createHoverCardFeature === "function"
              ? module.createHoverCardFeature
              : null;
          if (!create) throw new TypeError("hover 卡功能块缺少工厂导出");
          feature = create({
            anchors: { readCsrfToken, readViewerUid, resolveHoverTarget },
            fetchPage,
            problemData,
            nativeUserInfo,
            isEnabled: (kind) => active.has(kind),
          });
          return feature;
        })
        .catch((error) => {
          unavailable = true;
          logError(error);
          return null;
        })
        .finally(() => {
          pending = null;
        });
    return pending;
  };

  const active = new Set();
  let shellDispose = null;
  let refs = 0;
  let innerDispose = null;

  const mountShell = () => {
    if (!document.body) return () => {};
    let released = false;
    // 指針最後落在哪兒。★ 探針**一直掛到塊真正接管為止**，就是為了讓這個座標保持新鮮：
    //   塊在路上時使用者還在移動，補發要按最新位置來。
    let point = null;
    let keyboardAnchor = null;
    const detach = () => {
      document.removeEventListener("mouseover", probe, true);
      document.removeEventListener("keydown", probeKeyboard);
    };
    function mountBundle() {
      ensureFeature().then((loaded) => {
        if (released || !loaded || innerDispose) return;
        try {
          // 把指針座標交給塊：那一次懸停的事件它接不到，只能靠座標自己補。
          const replayFocus = keyboardAnchor && keyboardAnchor === document.activeElement ? keyboardAnchor : null;
          innerDispose = loaded.mount(replayFocus ? { replayFocus } : { replayAt: point });
        } catch (error) {
          logError(error);
          return;
        }
        detach();
      });
    }
    function probe(event) {
      if (typeof event.clientX === "number")
        point = { x: event.clientX, y: event.clientY };
      const target = resolveHoverTarget(event.target);
      if (target && active.has(target.kind)) mountBundle();
    }
    function probeKeyboard(event) {
      if (event.key === "Escape") keyboardAnchor = null;
      if (event.defaultPrevented || !isPreviewShortcut(event)) return;
      const node = event.target;
      const target = resolveHoverTarget(node);
      if (!target || target.anchor !== node || !active.has(target.kind)) return;
      event.preventDefault();
      keyboardAnchor = node;
      mountBundle();
    }
    document.addEventListener("mouseover", probe, true);
    document.addEventListener("keydown", probeKeyboard);
    return () => {
      released = true;
      detach();
      if (typeof innerDispose === "function") innerDispose();
      innerDispose = null;
    };
  };

  const mountFor = (kind) => {
    active.add(kind);
    if (refs === 0) shellDispose = mountShell();
    refs += 1;
    return () => {
      active.delete(kind);
      if (kind === "user" && innerDispose) feature.dismissUserPreview?.();
      refs -= 1;
      if (refs > 0) return;
      if (typeof shellDispose === "function") shellDispose();
      shellDispose = null;
    };
  };

  return Object.freeze({
    problem: defineConfigurableFeature({
      id: "hover-card-problem",
      key: "showProblemHoverCards",
      label: "题目悬停显示预览卡",
      storage,
      mount: () => mountFor("problem"),
    }),
    user: defineConfigurableFeature({
      id: "hover-card-user",
      key: "showUserHoverCards",
      label: "用户名/头像悬停显示预览卡",
      storage,
      mount: () => mountFor("user"),
    }),
  });
}
