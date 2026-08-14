// 锚点识别：页面上哪些元素该出卡。
//
// ★ 用事件委托（document 上一对 mouseover/mouseout）而不是给每个锚点挂监听 +
//   MutationObserver。洛谷是 SPA，锚点随路由重挂；委托天然不受影响，
//   而且**绕开了 rAF 节流那个坑** —— 隐藏标签页里 rAF 不触发，
//   凡是靠 rAF 补种监听的路径都会假死（交接单里记过两次）。

// ★★ pid 的字符集只有这一份。sources.js 曾经自己写了一份**漏掉下划线**的，
//    于是 `AT_abc397_a` / `CF_...` 这类题在数据层被当成非法 pid 直接退出，
//    卡片只剩一句「拿不到这条数据」—— 而接口本身是好的（实测 200、11541 B）。
//    owner 2026-08-14 第五轮报的就是它。同一个判据不许有第二份。
export const PID_PATTERN = /^[A-Za-z0-9_]+$/;
// 头像 URL 形如 https://cdn.luogu.com.cn/upload/usericon/1313427.png
const AVATAR_UID = /\/upload\/usericon\/(\d+)\./;

// ★ 站点框架里的锚点一律不出卡。owner 2026-08-14 报的三条误弹里有两条落在这里。
//   下面每一段都是登录态真机 DOM 实测（/problem/P1001 与 /user/{uid}）：
//
//   columba（新版）页：
//     div.top-bar > div.left  > div.breadcrumb > a          ← 左上角那个题号/用户名
//     div.top-bar > div.right > div.user-nav > span.avatar > a[/user/{我}]
//     nav.sidebar.lside.bar.hide.nav-scrollbar              ← 左抽屉（题库等导航）
//     div.user-nav.rside.hide.nav-scrollbar                 ← 右抽屉（「个人中心」菜单）
//   旧版页（首页就是）：
//     nav.user-nav < div.container < div.wrapper.header-layout ← 同一个用户菜单，换了套壳
//
// ★★ 右抽屉是 **`.top-bar` 的兄弟节点**（两者都直挂 `div#app.lfe-body`），
//    它里面有 `/user/{我}` 与 `/user/{我}/practice`。只排除 `.top-bar` 会整个漏掉它 ——
//    而 owner 说的「菜单栏个人中心」正是这个抽屉里的条目。
// ★★ `.user-nav` 是**三处共用**的类名（新版顶栏的用户区、新版右抽屉、旧版页头菜单），
//    单靠 `.top-bar/.lside/.rside` 会漏掉**旧版页**——首页实测就漏了（真机扫出来的）。
// ★★ 反过来也别扩大：文章页的 `header` 里是**作者**的用户名，那是要出卡的。
const SITE_CHROME_SELECTOR = ".top-bar, .lside, .rside, .user-nav";

const inSiteChrome = (node) =>
  !!(node && typeof node.closest === "function" && node.closest(SITE_CHROME_SELECTOR));

// ★ pid 判据。canary.13 的教训是**别用松正则**（`/problem/list` 与
//   `/problem/list?tag=N` 都会被当成 pid=`list`，于是导航按钮和 TAG 胶囊到处弹卡）；
//   canary.14 的教训是**也别全交给 problem-color 的解析器** —— 它额外要求「锚点文本
//   真的显示该 pid」，那是为**着色**设计的判据，而题库列表里题目链接的文本是**题名**，
//   于是题库里的题目反而不弹卡了（过度修复）。
//
// 所以这里自己判，两条硬要求：
//   1. href 的 **path 必须恰好是 `/problem/{id}`**（允许尾斜杠与 query，
//      所以 `/problem/list?tag=42` 因为 path 是 `/problem/list` 而被 id 形态挡下）；
//   2. id 必须**同时含字母和数字** —— `list` / `solution` / `new` 天然出局。
const looksLikePid = (id) =>
  typeof id === "string" && /[A-Za-z]/.test(id) && /[0-9]/.test(id) && PID_PATTERN.test(id);

const pidFromHref = (href) => {
  if (typeof href !== "string" || !href) return null;
  // 只看 path 段，query 与 hash 一律不参与。
  const path = href.split(/[?#]/)[0];
  const match = path.match(/\/problem\/([A-Za-z0-9_]+)\/?$/);
  return match ? match[1] : null;
};

// ★★★ owner 2026-08-14 第五轮：题库里悬停**题号**不该出卡，而且它「和难度着色冲突」。
//    查清了，是同一个根因：题库每行的题号是 `div.pid[title="P1000"]`（不是链接），
//    而 **problem-color 正是靠这个 `title` 认出这是哪道题**
//    （`identity.js` 的 standaloneIdentity：title 必须是合法 pid 且与文本相同）。
//    我们为了灭掉浏览器原生浮泡会 `removeAttribute("title")` —— 一摘，着色当场失效。
//    所以 `.pid[title]` **整个从锚点选择器里拿掉**：题号格不出卡、title 不被碰，
//    同一行的**题名链接**照常出卡（那才是 canary.14 修过要保住的那条）。
export function resolveProblemAnchor(node, identity) {
  if (!node || typeof node.closest !== "function") return null;
  const anchor = node.closest('a[href*="/problem/"], a[data-luogusp-pid]');
  if (!anchor) return null;
  const resolved =
    identity && typeof identity.resolve === "function"
      ? identity.resolve(anchor)
      : null;
  const pid =
    (resolved && resolved.pid) ||
    anchor.dataset?.luoguspPid ||
    pidFromHref(anchor.getAttribute("href"));
  if (!looksLikePid(pid)) return null;
  return Object.freeze({ kind: "problem", key: `problem:${pid}`, pid, anchor });
}

export function resolveUserAnchor(node) {
  if (!node || typeof node.closest !== "function") return null;
  // owner 要求：用户名和头像都出卡。头像常常不在 <a> 里（列表项自己处理点击），
  // 所以先看链接，再退回头像 URL 里的 uid。
  const link = node.closest('a[href*="/user/"]');
  const fromLink = link
    ? (link.getAttribute("href") || "").match(/\/user\/(\d+)/)?.[1]
    : null;
  if (fromLink) {
    const uid = Number(fromLink);
    if (Number.isSafeInteger(uid) && uid > 0)
      return Object.freeze({ kind: "user", key: `user:${uid}`, uid, anchor: link });
  }
  const image = node.closest("img") || (node.tagName === "IMG" ? node : null);
  const src = image && (image.getAttribute("src") || "");
  const fromAvatar = src && src.match(AVATAR_UID)?.[1];
  if (fromAvatar) {
    const uid = Number(fromAvatar);
    if (Number.isSafeInteger(uid) && uid > 0)
      return Object.freeze({ kind: "user", key: `user:${uid}`, uid, anchor: image });
  }
  return null;
}

// 当前页面「讲的就是」谁 / 哪道题。★ owner 2026-08-14：个人页上那个人自己的头像、
// 题目页上指回本题的链接，都不该弹卡 —— 卡片是用来预览**别处**的东西的，
// 在讲 P1001 的页面上再弹一张 P1001 的卡毫无信息量。而「推荐题目」是别的 pid，照常弹。
//
// 判据挂在 URL 路径的**形状**上，不挂具体类名：类名会随洛谷改版烂掉，
// `/user/{uid}` 与 `/problem/{pid}` 这两个形状不会（上一轮已经因为挂类名吃过亏）。
// `/problem/list`、`/problem/solution/...` 这类第一段不是 pid 的，一律没有主体。
export function readPageSubject(pathname) {
  const path = typeof pathname === "string" ? pathname : "";
  const user = path.match(/^\/user\/(\d+)(?:\/|$)/);
  if (user) {
    const uid = Number(user[1]);
    if (Number.isSafeInteger(uid) && uid > 0)
      return Object.freeze({ kind: "user", uid });
  }
  const problem = path.match(/^\/problem\/([A-Za-z0-9_]+)(?:\/|$)/);
  if (problem && looksLikePid(problem[1]))
    return Object.freeze({ kind: "problem", pid: problem[1] });
  return null;
}

// 私信页「最近联系」列表的兜底。★ owner 2026-08-14 第五轮：悬停那里的**用户名**没反应。
// 真机 DOM 实测（/chat，旧版页）：
//     div.item
//       span.avatar > img{src=.../usericon/2020479.png}
//       div > span > span[用户名]        ← 纯 span，没有链接，**整行只有头像带 uid**
// 所以名字上什么都解析不出来。这里从命中元素往上找**最多 4 层**，
// 找一个「正好含一个头像」的容器，用那个头像的 uid。
//
// ★★ 故意**只在 `/chat` 上生效**。同样的形状在讨论区、文章列表里到处都是
//    （头像 + 标题 + 作者），在那些地方按行兜底会让「悬停标题弹出作者卡」，
//    那是误弹 —— owner 这几轮反复在清的正是误弹。要扩大范围得先有各页的证据。
const CHAT_ROW_DEPTH = 4;
const chatRowUid = (node, pathname) => {
  if (pathname !== "/chat") return null;
  let cursor = node;
  for (let step = 0; cursor && step < CHAT_ROW_DEPTH; step += 1) {
    const avatars = cursor.querySelectorAll
      ? cursor.querySelectorAll('img[src*="/upload/usericon/"]')
      : [];
    if (avatars.length === 1) {
      const uid = Number((avatars[0].getAttribute("src") || "").match(AVATAR_UID)?.[1]);
      if (Number.isSafeInteger(uid) && uid > 0)
        return Object.freeze({ kind: "user", key: `user:${uid}`, uid, anchor: cursor });
    }
    if (avatars.length > 1) return null;
    cursor = cursor.parentElement;
  }
  return null;
};

export function resolveHoverTarget(node, identity, subject, pathname) {
  // 站点框架（顶栏 / 两侧抽屉）整块不参与，连解析都不必做。
  if (inSiteChrome(node)) return null;
  // 用户优先：讨论区里用户名链接常常也落在含题号的行内，先判用户不会误判。
  const target =
    resolveUserAnchor(node) ||
    resolveProblemAnchor(node, identity) ||
    chatRowUid(node, pathname);
  if (!target || !subject || subject.kind !== target.kind) return target;
  if (target.kind === "user") return target.uid === subject.uid ? null : target;
  return target.pid === subject.pid ? null : target;
}

// 当前登录 uid。columba 页在 `lentille-context`，旧版页在 `window._feInjection.currentUser`。
// 拿不到就是匿名 —— 匿名不请求提交记录，也不显示关注按钮。
export function readViewerUid(doc, globalScope) {
  try {
    const node = doc && doc.getElementById && doc.getElementById("lentille-context");
    if (node) {
      const ctx = JSON.parse(node.textContent || "null");
      const uid = Number(ctx && ctx.user && ctx.user.uid);
      if (Number.isSafeInteger(uid) && uid > 0) return uid;
    }
  } catch (error) {
    /* 形状漂移就当匿名 */
  }
  const injection = globalScope && globalScope._feInjection;
  const uid = Number(
    injection && injection.currentUser && injection.currentUser.uid,
  );
  return Number.isSafeInteger(uid) && uid > 0 ? uid : null;
}

export function readCsrfToken(doc) {
  const meta = doc && doc.querySelector && doc.querySelector('meta[name="csrf-token"]');
  const token = meta && meta.getAttribute("content");
  return typeof token === "string" && token ? token : null;
}
