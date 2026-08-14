import { defineConfigurableFeature } from "../../app/feature-descriptor.js";

// hover 卡的启动侧薄壳。与受限内容那次同一个形状：**只有用户真的把指针停在
// 题号或用户名上，才去拉那个块**。绝大多数页面浏览根本不会触发。
//
// ★ 设置项必须在不加载块的前提下就能列出来，所以 id / key / label 由本壳持有。
// ★ 这里不做锚点解析（那是块里的事），只做一件最便宜的判断：指针下面有没有可能是
//   题号或用户链接。判断错了顶多多拉一次块（一次，之后就常驻），判断漏了才是缺陷。
//
// ★★★ owner 报过两轮「第一次悬停不弹卡」。这一层有**两个**独立原因，都修了：
//
//  1. 块是**被这一次 mouseover 拉下来的**，等它加载完挂上委托监听时，那个事件早就
//     派发完了；用户停着不动就再也没有新事件。→ 挂载时把**指针当时的坐标**交给块，
//     由块自己解析并**立刻开卡**（`mount({ replayAt })`）。
//     ★ 不再补发合成事件：跨 realm 造事件脆，而且合成事件还要再等 300ms 停留，
//       体感仍然是「第一次悬停不弹」。
//
//  2. ★★★ **薄壳看不见的元素，块永远没机会加载。** 私信页的联系人行里，用户名是个
//     **裸 span**（整行只有头像带 uid），压根不匹配候选选择器 —— 于是悬停名字毫无反应，
//     非得先蹭一下头像把块拉下来，之后名字才开始工作。owner 报的就是这个。
//     真机扫过 /chat · /record/list · /article · /discuss · /problem/list 五类页面，
//     **只有 /chat 是裸 span**，其余的用户名都在 `a[href*="/user/"]` 里。
//     但「按元素猜」这条路本身就会一直漏 —— 所以判据换成**按页面**：
//     这一页只要有可预览的东西，指针一动就把块拉下来。

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

  // 当前开着的类别。块通过 `isEnabled` 现问，所以在设置里改开关**立刻生效**，不必重挂。
  const active = new Set();
  // 这一页上到底有没有可预览的东西（站点框架里的不算 —— 每页顶栏都有我自己的头像，
  // 拿它当依据就等于「所有页面都加载」）。★ 只缓存**肯定**的结论：SPA 的内容是后到的，
  // 一开始没有不代表以后没有；扫一次要遍历全页，所以没结论时按 500ms 限流。
  let pageHasTargets = false;
  let lastScanAt = 0;
  const pageWorthLoading = (selector, now) => {
    if (pageHasTargets) return true;
    if (now - lastScanAt < 500) return false;
    lastScanAt = now;
    for (const node of document.querySelectorAll(selector))
      if (!node.closest(CHROME_SELECTOR)) {
        pageHasTargets = true;
        return true;
      }
    return false;
  };
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
      if (typeof event.clientX === "number")
        point = { x: event.clientX, y: event.clientY };
      // 指针**正压在**候选上 → 一定要拉；否则看这一页值不值得拉。
      // ★ 后一条才是关键：它把「薄壳看不见某个元素」这一整类 bug 从根上去掉了 ——
      //   块由**页面**决定加不加载，不再由「指针碰巧压在什么上」决定。
      const onCandidate = !node.closest(CHROME_SELECTOR) && !!node.closest(selector);
      if (!onCandidate && !pageWorthLoading(selector, Date.now())) return;
      ensureFeature().then((loaded) => {
        if (released || !loaded || innerDispose) return;
        try {
          // 把指针坐标交给块：那一次悬停的事件它接不到，只能靠坐标自己补。
          innerDispose = loaded.mount({ replayAt: point });
        } catch (error) {
          logError(error);
          return;
        }
        detach();
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
