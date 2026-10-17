import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { createRestrictedPageDetector } from "./page-detector.js";
import { createRestrictedUrlPolicy } from "./url-policy.js";

// 「顯示受限文章與剪貼板」的啟動側薄殼。
//
// 真正的實作（保存站工作流、殼骨架收割、document.write 重建、評論傳輸層、
// 互動狀態持久化……）是啟動包裡最大的一塊，卻只在「安全訪問中心」攔截頁上才用得到。
// 這裡只留**廉價探測器**：不是攔截頁就一個位元組都不拉；是攔截頁才按需載入重機械。
//
// ★ 設定項必須在不載入重機械的前提下就能顯示（導覽欄「外掛設定」列出全部功能），
//   所以 id / key / label 由本殼持有，與被拆出去的實作保持一致。
// ★ `mount` 必須**同步**回傳 disposer（page-lifecycle 的契約），所以這裡同步探測、
//   非同步載入，並用一個已釋放標記保證「殼先被 dispose、塊後到達」時不會再掛上去。

const RESTRICTED_ROUTE = /^\/(article|paste)\/[A-Za-z0-9]+\/?$/;

export function createRestrictedContentFeature(config) {
  const {
    storage,
    restrictedLoadingGate,
    getPageLifecycle,
    loadBundle,
    logError = (error) => console.error("LuoguSP restricted bundle:", error),
    // 探測三錨點預設取全域；注入是為了可測（本殼是啟動包裡唯一還會碰 DOM 的部分）。
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

  // 塊只載入一次並共享；失敗就記下來別反覆重試（攔截頁會反覆 onRoute）。
  const ensureFeature = () => {
    if (feature) return Promise.resolve(feature);
    if (unavailable) return Promise.resolve(null);
    // 沒人串接就等於功能不存在 —— 必須報出來，別靜默變成「功能沒做」。
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
    label: "受限文章与剪贴板解限",
    storage,
    mount: (context) => {
      // 不是攔截頁 → 一個位元組都不拉。這是本次拆分的全部意義。
      // ★ 但必須先把早期載入層放掉：它在 document-start 就遮住了**所有**
      //   /article/*、/paste/* 頁面（`body>*{visibility:hidden}`），
      //   舊程式碼由 document-boot 在探測失敗時釋放。這裡提前 return 卻不釋放，
      //   就會把每一個正常文章/剪貼簿頁面永久遮成空白。
      if (!detect()) {
        if (restrictedLoadingGate) restrictedLoadingGate.release();
        return () => {};
      }
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
    // 載入層要在啟動包裡同步起手，否則攔截頁會閃一下原始內容。
    // 塊沒載入過就沒有重建記錄，onRoute 無事可做，不必為它把塊拉下來。
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
