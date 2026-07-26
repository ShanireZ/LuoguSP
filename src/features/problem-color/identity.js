export function createProblemIdentityResolver(config) {
  const {
    getOrigin,
    voidAnchorSelector,
    standalonePidSelector,
  } = config || {};
  if (typeof getOrigin !== "function")
    throw new TypeError("Problem Identity requires an origin adapter");

  const isProblemId = (id) => {
    if (typeof id !== "string" || !id) return false;
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
