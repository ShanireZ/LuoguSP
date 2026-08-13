import { defineConfigurableFeature } from "../../app/feature-descriptor.js";

// hover 卡的启动侧薄壳。与受限内容那次同一个形状：**只有用户真的把指针停在
// 题号或用户名上，才去拉那个块**。绝大多数页面浏览根本不会触发。
//
// ★ 设置项必须在不加载块的前提下就能列出来，所以 id / key / label 由本壳持有。
// ★ 这里不做锚点解析（那是块里的事），只做一件最便宜的判断：指针下面有没有可能是
//   题号或用户链接。判断错了顶多多拉一次块（一次，之后就常驻），判断漏了才是缺陷。

const CANDIDATE_SELECTOR =
  'a[href*="/problem/"], a[href*="/user/"], .pid[title], img[src*="/upload/usericon/"]';

export function createHoverCardFeature(config) {
  const {
    storage,
    loadBundle,
    fetchPage,
    logError = (error) => console.error("LuoguSP hover card bundle:", error),
  } = config || {};

  let feature = null;
  let pending = null;
  let unavailable = false;

  const ensureFeature = () => {
    if (feature) return Promise.resolve(feature);
    if (unavailable) return Promise.resolve(null);
    // 没人接线就等于功能不存在，必须报出来 —— 静默会伪装成「功能没做」。
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
          feature = create({ storage, fetchPage });
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

  const mount = () => {
    if (!document.body) return () => {};
    let released = false;
    let innerDispose = null;
    // 第一次碰到候选锚点就换正主接管：块自己会重新装委托监听，
    // 所以这里把探针拆掉即可，不必转发这一次事件。
    const probe = (event) => {
      const node = event.target;
      if (!node || typeof node.closest !== "function") return;
      if (!node.closest(CANDIDATE_SELECTOR)) return;
      document.removeEventListener("mouseover", probe, true);
      ensureFeature().then((loaded) => {
        if (released || !loaded) return;
        try {
          innerDispose = loaded.mount();
        } catch (error) {
          logError(error);
        }
      });
    };
    document.addEventListener("mouseover", probe, true);
    return () => {
      released = true;
      document.removeEventListener("mouseover", probe, true);
      if (typeof innerDispose === "function") innerDispose();
      innerDispose = null;
    };
  };

  return defineConfigurableFeature({
    id: "hover-card",
    key: "showHoverCards",
    label: "题号与用户悬停预览卡",
    storage,
    mount,
  });
}
