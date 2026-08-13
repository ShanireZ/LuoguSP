// 锚点识别：页面上哪些元素该出卡。
//
// ★ 用事件委托（document 上一对 mouseover/mouseout）而不是给每个锚点挂监听 +
//   MutationObserver。洛谷是 SPA，锚点随路由重挂；委托天然不受影响，
//   而且**绕开了 rAF 节流那个坑** —— 隐藏标签页里 rAF 不触发，
//   凡是靠 rAF 补种监听的路径都会假死（交接单里记过两次）。

const PID_PATTERN = /^[A-Za-z0-9_]+$/;
// 头像 URL 形如 https://cdn.luogu.com.cn/upload/usericon/1313427.png
const AVATAR_UID = /\/upload\/usericon\/(\d+)\./;

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

export function resolveProblemAnchor(node, identity) {
  if (!node || typeof node.closest !== "function") return null;
  const anchor = node.closest('a[href*="/problem/"], .pid[title], a[data-luogusp-pid]');
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

export function resolveHoverTarget(node, identity) {
  // 用户优先：讨论区里用户名链接常常也落在含题号的行内，先判用户不会误判。
  return resolveUserAnchor(node) || resolveProblemAnchor(node, identity);
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
