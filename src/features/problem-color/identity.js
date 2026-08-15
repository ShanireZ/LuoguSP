// ★★★ pid 的字符集判据，全仓**唯一**一份（hover 卡那边由 anchors.js 再导出）。
//   放在这里而不是 anchors.js：本文件同时进启动包（problem-color）与 hover 卡按需块，
//   而 anchors.js 只在后者里。`sources.js` 曾经自己写过一份漏掉下划线的，
//   于是 `AT_abc397_a` 这类题在数据层被当成非法 pid 直接退出（owner 2026-08-14 第五轮）。
//
// ★★ 为什么它必须参与 `isProblemId`（2026-08-15 实测复现）：pid 的两个来源
//   —— void 锚点的**可见文本**与 `?forum=` 的**取值** —— 都是页面内容，攻击者可控
//   （讨论区是用户生成内容），而 pipeline.js 会把它原样拼进 `/problem/${pid}?_contentOnly=1`。
//   旧判据只要求「含字母且含数字」，于是：
//     `P1000#zzz`               → 井号截断，实际请求 `/problem/P1000`（连 query 都被吃掉），
//                                 于是**把别的题的难度染到这个锚点上**；
//     `a1/../../api/user/search` → 实际请求 `https://www.luogu.com.cn/api/user/search`，
//                                 带着同源 Cookie 打到一个完全不相干的接口。
//   两条都是真机可构造的，不是理论风险。字符集守卫把它们整类关死。
export const PID_PATTERN = /^[A-Za-z0-9_]+$/;

export function createProblemIdentityResolver(config) {
  const {
    getOrigin,
    voidAnchorSelector,
    standalonePidSelector,
  } = config || {};
  if (typeof getOrigin !== "function")
    throw new TypeError("Problem Identity requires an origin adapter");

  const isProblemId = (id) => {
    if (typeof id !== "string" || !id || !PID_PATTERN.test(id)) return false;
    if (id.startsWith("AT_")) return true;
    return /[a-zA-Z]/.test(id) && /[0-9]/.test(id);
  };
  const anchorShowsPid = (anchor, pid) => {
    const first = anchor.firstElementChild;
    if (
      first &&
      first.matches("span.pid") &&
      (first.innerText || first.textContent || "").trim() === pid
    )
      return true;
    const text = (
      anchor.innerText ||
      anchor.textContent ||
      ""
    ).trimStart();
    if (!text.startsWith(pid)) return false;
    return !/[A-Za-z0-9_]/.test(text.charAt(pid.length));
  };
  const exactProblemUrl = (href, origin, pid) => {
    let url;
    try {
      url = new URL(href, origin);
    } catch (error) {
      return null;
    }
    if (url.origin !== origin) return null;
    const path = url.pathname.match(/^\/problem\/([A-Za-z0-9_]+)\/?$/);
    return path && path[1] === pid ? url : null;
  };
  const standaloneIdentity = (target, origin) => {
    const title = (
      (target.getAttribute && target.getAttribute("title")) ||
      target.title ||
      ""
    ).trim();
    const text = (
      target.innerText ||
      target.textContent ||
      ""
    ).trim();
    if (!isProblemId(title) || text !== title) return null;

    const row = target.parentElement;
    if (!row || !row.querySelectorAll) return null;
    for (const anchor of row.querySelectorAll("a[href]")) {
      const url = exactProblemUrl(anchor.href, origin, title);
      if (url)
        return {
          pid: title,
          kind: "standalone",
          key: `standalone:${url.href}`,
        };
    }
    return null;
  };
  const resolve = (target) => {
    if (!target || !target.matches) return null;
    const origin = getOrigin();
    if (
      standalonePidSelector &&
      target.matches(standalonePidSelector)
    )
      return standaloneIdentity(target, origin);
    if (voidAnchorSelector && target.matches(voidAnchorSelector)) {
      const pid = (
        target.innerText ||
        target.textContent ||
        ""
      )
        .trim()
        .split(/\s+/)[0];
      return isProblemId(pid) && anchorShowsPid(target, pid)
        ? { pid, kind: "void", key: `void:${pid}` }
        : null;
    }
    let url;
    try {
      url = new URL(target.href, origin);
    } catch (error) {
      return null;
    }
    if (url.origin !== origin) return null;
    const forumPid = url.searchParams.get("forum");
    if (forumPid)
      return isProblemId(forumPid) && anchorShowsPid(target, forumPid)
        ? { pid: forumPid, kind: "forum", key: `forum:${url.href}` }
        : null;
    const path = url.pathname.match(/^\/problem\/([A-Za-z0-9_]+)\/?$/);
    const pid = path && path[1];
    return isProblemId(pid) && anchorShowsPid(target, pid)
      ? { pid, kind: "problem", key: `problem:${url.href}` }
      : null;
  };

  return Object.freeze({ resolve });
}

// 评测记录注入的 5..7 在新旧难度数据之间存在歧义：相同数值可能对应不同当前档位。
// 只复用编号含义未变化的 0..4；高档题交给题目页接口按 pid 获取当前难度。
export function recordDifficultyForHarvest(difficulty) {
  return Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= 4
    ? difficulty
    : null;
}
