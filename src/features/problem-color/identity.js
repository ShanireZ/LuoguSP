export function createProblemIdentityResolver(config) {
  const { getOrigin, voidAnchorSelector } = config || {};
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
  const resolve = (anchor) => {
    if (!anchor || !anchor.matches) return null;
    if (voidAnchorSelector && anchor.matches(voidAnchorSelector)) {
      const pid = (
        anchor.innerText ||
        anchor.textContent ||
        ""
      )
        .trim()
        .split(/\s+/)[0];
      return isProblemId(pid) && anchorShowsPid(anchor, pid)
        ? { pid, kind: "void", key: `void:${pid}` }
        : null;
    }
    const origin = getOrigin();
    let url;
    try {
      url = new URL(anchor.href, origin);
    } catch (error) {
      return null;
    }
    if (url.origin !== origin) return null;
    const forumPid = url.searchParams.get("forum");
    if (forumPid)
      return isProblemId(forumPid) && anchorShowsPid(anchor, forumPid)
        ? { pid: forumPid, kind: "forum", key: `forum:${url.href}` }
        : null;
    const path = url.pathname.match(/^\/problem\/([A-Za-z0-9_]+)\/?$/);
    const pid = path && path[1];
    return isProblemId(pid) && anchorShowsPid(anchor, pid)
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
