import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { createRestrictedPageDetector } from "./page-detector.js";
import { createRestrictedUrlPolicy } from "./url-policy.js";

// 「显示受限文章与剪贴板」的启动侧薄壳。
//
// 真正的实现（保存站工作流、壳骨架收割、document.write 重建、评论传输层、
// 互动状态持久化……）是启动包里最大的一块，却只在「安全访问中心」拦截页上才用得到。
// 这里只留**廉价探测器**：不是拦截页就一个字节都不拉；是拦截页才按需加载重机械。
//
// ★ 设置项必须在不加载重机械的前提下就能显示（导航栏「插件设置」列出全部功能），
//   所以 id / key / label 由本壳持有，与被拆出去的实现保持一致。
// ★ `mount` 必须**同步**返回 disposer（page-lifecycle 的契约），所以这里同步探测、
//   异步加载，并用一个已释放标记保证「壳先被 dispose、块后到达」时不会再挂上去。

const RESTRICTED_ROUTE = /^\/(article|paste)\/[A-Za-z0-9]+\/?$/;

export function createRestrictedContentFeature(config) {
  const {
    storage,
    restrictedLoadingGate,
    getPageLifecycle,
    loadBundle,
    logError = (error) => console.error("LuoguSP restricted bundle:", error),
    // 探测三锚点默认取全局；注入是为了可测（本壳是启动包里唯一还会碰 DOM 的部分）。
    pageAdapter = {
      path: () => location.pathname,
      title: () => document.title,
      target: () => {
        const pre = document.querySelector("pre#url");
        return pre ? (pre.textContent || "").trim() : "";
      },
    },
  } = config || {};

  const detector = createRestrictedPageDetector({
    path: pageAdapter.path,
    title: pageAdapter.title,
    target: pageAdapter.target,
    urlPolicy: createRestrictedUrlPolicy(),
  });

  let feature = null;
  let pending = null;
  let unavailable = false;

  // 块只加载一次并共享；失败就记下来别反复重试（拦截页会反复 onRoute）。
  const ensureFeature = () => {
    if (feature) return Promise.resolve(feature);
    if (unavailable) return Promise.resolve(null);
    // 没人接线就等于功能不存在 —— 必须报出来，别静默变成「功能没做」。
    if (typeof loadBundle !== "function") {
      unavailable = true;
      logError(new TypeError("受限内容功能块的加载器未接线"));
      return Promise.resolve(null);
    }
    if (!pending)
      pending = Promise.resolve()
        .then(() => loadBundle())
        .then((module) => {
          const create =
            module && typeof module.createRestrictedContentFeature === "function"
              ? module.createRestrictedContentFeature
              : null;
          if (!create) throw new TypeError("受限内容功能块缺少工厂导出");
          feature = create({ storage, restrictedLoadingGate, getPageLifecycle });
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

  const detect = () => {
    try {
      return detector.detect();
    } catch (error) {
      logError(error);
      return null;
    }
  };

  return defineConfigurableFeature({
    id: "restricted-document",
    key: "showRestrictedContent",
    label: "显示受限文章与剪贴板",
    storage,
    mount: (context) => {
      // 不是拦截页 → 一个字节都不拉。这是本次拆分的全部意义。
      if (!detect()) return () => {};
      let released = false;
      let innerDispose = null;
      ensureFeature().then((loaded) => {
        if (released || !loaded) return;
        try {
          innerDispose = loaded.mount(context);
        } catch (error) {
          logError(error);
        }
      });
      return () => {
        released = true;
        if (typeof innerDispose === "function") innerDispose();
        innerDispose = null;
      };
    },
    // 加载层要在启动包里同步起手，否则拦截页会闪一下原始内容。
    // 块没加载过就没有重建记录，onRoute 无事可做，不必为它把块拉下来。
    onRoute: () => {
      if (restrictedLoadingGate) restrictedLoadingGate.start();
      if (!feature) return;
      try {
        if (typeof feature.onRoute === "function") feature.onRoute();
      } catch (error) {
        logError(error);
      }
    },
  });
}

export const isRestrictedCandidateRoute = (path) =>
  RESTRICTED_ROUTE.test(String(path || ""));
