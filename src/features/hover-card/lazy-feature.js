import { defineConfigurableFeature } from "../../app/feature-descriptor.js";

// hover 卡的启动侧薄壳。与受限内容那次同一个形状：**只有用户真的把指针停在
// 题号或用户名上，才去拉那个块**。绝大多数页面浏览根本不会触发。
//
// ★ 设置项必须在不加载块的前提下就能列出来，所以 id / key / label 由本壳持有。
// ★ 这里不做锚点解析（那是块里的事），只做一件最便宜的判断：指针下面有没有可能是
//   题号或用户链接。判断错了顶多多拉一次块（一次，之后就常驻），判断漏了才是缺陷。
//
// ★★★ owner 2026-08-14 报「很多时候第一次悬停不弹卡」。根因就在这层：
//    块是**被这一次 mouseover 拉下来的**，等它加载完挂上委托监听时，
//    那个事件早就派发完了 —— 而用户如果停着不动，**再也不会有新的 mouseover**，
//    于是第一次悬停必然落空，非得晃一下鼠标才出卡。
//    修法=挂载成功后**照着指针当前位置补发一次 mouseover**。
//    ★ 用 `elementFromPoint` 现取元素，而不是复用当初那个 target：块下载要几百毫秒，
//      这中间指针很可能已经挪到别的锚点上了（那些 mouseover 同样没人接）。

// 候选锚点选择器按**当前开着的类别**拼：只开了题目卡就别为用户名去拉块。
const PROBLEM_CANDIDATES = 'a[href*="/problem/"]';
const USER_CANDIDATES = 'a[href*="/user/"], img[src*="/upload/usericon/"]';
// 站点框架（顶栏 + 左右抽屉）里的锚点永远不会出卡（判据在块里的 anchors.js），
// 所以连块都不必为它们拉下来。★ 这是**纯省事**的收紧，不是判据：
// 少拉一次块顶多慢一点，多拉一次块什么也不会坏。
const CHROME_SELECTOR = ".top-bar, .lside, .rside, .user-nav";

// ★★★ 屏蔽洛谷原生的个人悬停卡。owner 2026-08-14 第五轮：文章广场、讨论区、
//   提交记录、题目页出题人……到处都是原生卡和我们的卡一起弹。
//
// 结构取自 `DropdownWrapper` 组件原文（loader chunk）：
//     <wrapper><trigger .../><Teleport to="#app">
//       <div class="dropdown {shown}">{shown ? 卡片内容 : 空}</div>
//     </Teleport></wrapper>
//   用户卡本体是那个 `class="float-card"` 的节点（`UserFloatCard` 的根）。
//   全站 chunk 里 `"float-card"` **只有这一处**用到，所以按它认不会误伤。
//
// ★ 为什么用 CSS 而不是掐事件：原生触发器的 `mouseover` 监听挂在触发元素上，
//   要拦就得在 document 捕获阶段 `stopPropagation` —— 那会连带掐掉那棵子树上
//   别人的一切 mouseover，代价不可控。CSS 只影响显示，坏不了任何行为。
//   代价是原生那边照样会发一次 `/api/user/info/{uid}`（约 1 KB），可以接受。
// ★ 只在**用户卡开关打开时**才注入：关掉我们的卡就该把原生卡还给用户。
//   `:has()` 那条连空的下拉盒子一起藏掉；下面那条是没有 `:has()` 时的兜底。
const NATIVE_SUPPRESS_ID = "luogusp-hc-native-suppress";
const NATIVE_SUPPRESS_CSS =
  ".dropdown:has(> .float-card){display:none !important;}" +
  ".float-card{display:none !important;}";

const suppressNativeCard = (on) => {
  const head = document.head || document.documentElement;
  const existing = document.getElementById(NATIVE_SUPPRESS_ID);
  if (!on) {
    if (existing) existing.remove();
    return;
  }
  if (existing || !head) return;
  const style = document.createElement("style");
  style.id = NATIVE_SUPPRESS_ID;
  style.textContent = NATIVE_SUPPRESS_CSS;
  head.appendChild(style);
};

// ★ owner 2026-08-14 第四轮把开关拆成两个：「题目悬停显示预览卡」与
//   「用户名/头像悬停显示预览卡」。两个开关**共用同一个块、同一次挂载** ——
//   分别挂两次会得到两张卡片元素、两套委托监听。做法是引用计数：
//   哪一类被打开就把它记进 active，块在 hover 时按 active 过滤；
//   两类都关掉了才真正卸载。
export function createHoverCardFeatures(config) {
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
          feature = create({
            storage,
            fetchPage,
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

  // 指针当前位置上补发一次 mouseover，让刚挂上的委托监听接住它。
  // ★ 事件对象必须用**文档自己那个 realm** 的构造器：块是经 blob 动态 import 在页面
  //   realm 执行的，拿错 realm 的构造器造出来的事件派发不进去（仓库里已经因为
  //   「搬进另一个 realm 等于换了一套宿主对象」栽过一次）。
  const replayHover = (point) => {
    const view = document.defaultView;
    const Ctor = view && view.MouseEvent;
    if (!point || typeof Ctor !== "function" || !document.elementFromPoint) return;
    const node = document.elementFromPoint(point.x, point.y);
    if (!node || typeof node.closest !== "function") return;
    const selector = candidateSelector();
    if (!selector) return;
    if (!node.closest(selector) || node.closest(CHROME_SELECTOR)) return;
    node.dispatchEvent(
      new Ctor("mouseover", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  };

  // 当前开着的类别。块通过 `isEnabled` 现问，所以在设置里改开关**立刻生效**，不必重挂。
  const active = new Set();
  const candidateSelector = () =>
    [
      active.has("problem") ? PROBLEM_CANDIDATES : null,
      active.has("user") ? USER_CANDIDATES : null,
    ]
      .filter(Boolean)
      .join(", ");
  // ★ 两个开关共用**一次**挂载：各挂各的会得到两张卡片元素、两套委托监听。
  //   所以做引用计数 —— 第一个打开时装壳，最后一个关掉时才拆。
  let shellDispose = null;
  let refs = 0;
  let innerDispose = null;

  const mountShell = () => {
    if (!document.body) return () => {};
    let released = false;
    // 指针最后落在哪儿。★ 探针**一直挂到块真正接管为止**，就是为了让这个坐标保持新鲜：
    //   块在路上时用户还在移动，补发要按最新位置来。
    let point = null;
    const detach = () => document.removeEventListener("mouseover", probe, true);
    function probe(event) {
      const node = event.target;
      if (!node || typeof node.closest !== "function") return;
      const selector = candidateSelector();
      if (!selector) return;
      if (!node.closest(selector)) return;
      if (node.closest(CHROME_SELECTOR)) return;
      if (typeof event.clientX === "number")
        point = { x: event.clientX, y: event.clientY };
      ensureFeature().then((loaded) => {
        if (released || !loaded || innerDispose) return;
        try {
          innerDispose = loaded.mount();
        } catch (error) {
          logError(error);
          return;
        }
        // 正主接管了：拆掉探针，再把它错过的那一次悬停补上。
        detach();
        replayHover(point);
      });
    }
    document.addEventListener("mouseover", probe, true);
    return () => {
      released = true;
      detach();
      if (typeof innerDispose === "function") innerDispose();
      innerDispose = null;
    };
  };

  const mountFor = (kind) => {
    active.add(kind);
    // 我们的用户卡一上场，就把原生那张藏起来 —— 两张一起弹是 owner 报的问题。
    if (kind === "user") suppressNativeCard(true);
    if (refs === 0) shellDispose = mountShell();
    refs += 1;
    return () => {
      active.delete(kind);
      if (kind === "user") suppressNativeCard(false);
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
