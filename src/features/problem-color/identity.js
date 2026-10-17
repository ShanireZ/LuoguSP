// ★★★ pid 的字元集判據，全倉**唯一**一份（hover 卡那邊由 anchors.js 再匯出）。
//   放在這裡而不是 anchors.js：本檔案同時進啟動包（problem-color）與 hover 卡按需塊，
//   而 anchors.js 只在後者裡。`sources.js` 曾經自己寫過一份漏掉下劃線的，
//   於是 `AT_abc397_a` 這類題在資料層被當成非法 pid 直接退出（owner 2026-08-14 第五輪）。
//
// ★★ 為什麼它必須參與 `isProblemId`（2026-08-15 實測重現）：pid 的兩個來源
//   —— void 錨點的**可見文字**與 `?forum=` 的**取值** —— 都是頁面內容，攻擊者可控
//   （討論區是使用者生成內容），而 pipeline.js 會把它原樣拼進 `/problem/${pid}?_contentOnly=1`。
//   舊判據只要求「含字母且含數字」，於是：
//     `P1000#zzz`               → 井號截斷，實際請求 `/problem/P1000`（連 query 都被吃掉），
//                                 於是**把別的題的難度染到這個錨點上**；
//     `a1/../../api/user/search` → 實際請求 `https://www.luogu.com.cn/api/user/search`，
//                                 帶著同源 Cookie 打到一個完全不相干的介面。
//   兩條都是真機可建構的，不是理論風險。字元集守衛把它們整類關死。
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

// 評測記錄注入的 5..7 在新舊難度資料之間存在歧義：相同數值可能對應不同當前檔位。
// 只重複使用編號含義未變化的 0..4；高檔題交給題目頁介面按 pid 獲取當前難度。
export function recordDifficultyForHarvest(difficulty) {
  return Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= 4
    ? difficulty
    : null;
}
