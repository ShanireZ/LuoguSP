import {
  NATIVE_BADGE_COLOR,
  abbreviateCount,
  badgeStyle,
  levelColor,
  statusPresentation,
} from "./luogu-native.js";
// 卡片 DOM。★ 全程 createElement + textContent，不用 innerHTML 拼用户数据 ——
// 题名、slogan、徽章、标签都来自洛谷，拼字符串等于把注入面留给上游。

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

const row = (key, valueNode) => {
  const line = el("div", "luogusp-hc-row");
  line.appendChild(el("span", "luogusp-hc-key", key));
  const value = el("span", "luogusp-hc-val");
  value.appendChild(
    typeof valueNode === "string" || typeof valueNode === "number"
      ? document.createTextNode(String(valueNode))
      : valueNode,
  );
  line.appendChild(value);
  return line;
};

const fmtDate = (seconds) =>
  Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toLocaleDateString("zh-CN")
    : null;

// owner 拍板：小于 1000 全显示，小于 1000000 用 k，否则用 m。
const fmtCount = (value) => abbreviateCount(value);

export function renderProblemCard(card, options = {}) {
  const { origin = "" } = options;
  const box = document.createDocumentFragment();

  const head = el("div", "luogusp-hc-head");
  const titles = el("div");
  titles.style.minWidth = "0";
  const title = el("p", "luogusp-hc-title", `${card.pid} ${card.name}`);
  titles.appendChild(title);
  const sub = el("div", "luogusp-hc-sub", card.difficultyName);
  sub.style.color = card.difficultyColor;
  titles.appendChild(sub);
  head.appendChild(titles);
  box.appendChild(head);

  // owner 要求：通过数与提交数都要显示，且按 k / m 缩写。
  if (card.acceptedCount !== null || card.submittedCount !== null)
    box.appendChild(
      row(
        "通过 / 提交",
        `${fmtCount(card.acceptedCount) || "?"} / ${fmtCount(card.submittedCount) || "?"}` +
          (card.acceptanceRate === null ? "" : `　${card.acceptanceRate}%`),
      ),
    );
  if (card.timeLimitMs !== null || card.memoryLimitKb !== null)
    box.appendChild(
      row(
        "限制",
        [
          card.timeLimitMs === null ? null : `${card.timeLimitMs} ms`,
          card.memoryLimitKb === null
            ? null
            : `${Math.round(card.memoryLimitKb / 1024)} MB`,
        ]
          .filter(Boolean)
          .join(" / "),
      ),
    );

  // ★ owner 拍板：标签默认折叠 —— 标签会剧透算法。
  if (card.tags.length) {
    const tags = el("div", "luogusp-hc-tags");
    const toggle = el("button", "luogusp-hc-tagbtn", `显示标签（${card.tags.length}）`);
    toggle.type = "button";
    const list = el("div", "luogusp-hc-taglist");
    list.hidden = true;
    for (const name of card.tags) list.appendChild(el("span", "luogusp-hc-tag", name));
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      list.hidden = !list.hidden;
      toggle.textContent = list.hidden
        ? `显示标签（${card.tags.length}）`
        : "隐藏标签";
    });
    tags.appendChild(toggle);
    tags.appendChild(list);
    box.appendChild(tags);
  }

  const mine = card.mine;
  const hasMine =
    mine.accepted !== null ||
    mine.submitted !== null ||
    mine.bookmarked !== null ||
    mine.lastAttempt;
  if (hasMine) {
    box.appendChild(el("div", "luogusp-hc-sep"));
    // 未知就说未知：accepted 缺失不等于「没通过」。
    // owner 要求：用洛谷原生的状态表示。实测洛谷记录列表只渲染两种 ——
    // status 12 = Accepted（#52c41a），其它（实测到 14）= Unaccepted（#e74c3c）。
    // 细分状态（WA/TLE/…）的**数字码表本轮没取到证据**，所以不编。
    const native =
      mine.bestStatus !== null
        ? statusPresentation(mine.bestStatus)
        : mine.accepted === true
          ? statusPresentation(12)
          : mine.submitted === true
            ? statusPresentation(-1)
            : null;
    const status = el("span", "luogusp-hc-status");
    if (native) {
      status.textContent =
        mine.bestScore === null
          ? native.label
          : `${native.label} · ${mine.bestScore} 分`;
      status.style.color = native.color;
    } else {
      status.className = "luogusp-hc-muted";
      status.textContent = mine.submitted === false ? "未提交" : "未知";
    }
    box.appendChild(row("我的状态", status));
    if (mine.lastAttempt && mine.lastAttempt.at) {
      const when = fmtDate(mine.lastAttempt.at) || "";
      const parts = [when];
      if (mine.lastAttempt.score !== null)
        parts.push(`${mine.lastAttempt.score} 分`);
      if (mine.lastAttempt.durationMs !== null)
        parts.push(`${mine.lastAttempt.durationMs} ms`);
      box.appendChild(row("上次尝试", parts.filter(Boolean).join(" · ")));
    }
    if (mine.bookmarked === true) box.appendChild(row("收藏", "已收藏"));
  }

  const actions = el("div", "luogusp-hc-actions");
  const problemLink = el("a", "luogusp-hc-link", "打开题目");
  problemLink.href = `${origin}/problem/${card.pid}`;
  problemLink.target = "_blank";
  problemLink.rel = "noopener noreferrer";
  actions.appendChild(problemLink);
  if (mine.bestRecordId !== null) {
    const record = el("a", "luogusp-hc-link", "最好的一次提交");
    record.href = `${origin}/record/${mine.bestRecordId}`;
    record.target = "_blank";
    record.rel = "noopener noreferrer";
    actions.appendChild(record);
  }
  box.appendChild(actions);
  return box;
}

export function renderUserCard(card, options = {}) {
  const { origin = "", onFollow, followBusy = false } = options;
  const box = document.createDocumentFragment();

  const head = el("div", "luogusp-hc-head");
  if (card.avatar) {
    const avatar = el("img", "luogusp-hc-avatar");
    avatar.src = card.avatar;
    avatar.alt = "";
    avatar.loading = "lazy";
    head.appendChild(avatar);
  }
  const titles = el("div");
  titles.style.minWidth = "0";
  const title = el("p", "luogusp-hc-title", card.name);
  // 原生用户名就是按等级色渲染的（实测 6 档配对）。
  title.style.color = levelColor(card.color);
  // ★ ✅ 与气球的驱动字段：ccfLevel>0 / xcpcLevel>0（41 用户双向零反例实测）。
  const badges = el("span", "luogusp-hc-badges");
  // 原生 ✅(fa-badge-check) 与 🎈(fa-balloon) 实测都是 #3498db、1em。
  // ★ 两者都是 duotone **双 path** 图标，精确复刻要 4 段 path 数据（下一轮补）；
  //   这里先把颜色、字号与位置对齐原生。
  if (card.ccfLevel !== null && card.ccfLevel > 0) {
    const ccf = el("span", "luogusp-hc-badge luogusp-hc-badge-icon", `CCF ${card.ccfLevel}`);
    ccf.style.color = NATIVE_BADGE_COLOR;
    badges.appendChild(ccf);
  }
  if (card.xcpcLevel !== null && card.xcpcLevel > 0) {
    const xcpc = el("span", "luogusp-hc-badge luogusp-hc-badge-icon", `XCPC ${card.xcpcLevel}`);
    xcpc.style.color = NATIVE_BADGE_COLOR;
    badges.appendChild(xcpc);
  }
  // 称号：原生是白字 + 等级色底 + 圆角 2px。
  if (card.badge) {
    const badge = el("span", "luogusp-hc-badge", card.badge);
    badge.setAttribute("style", badgeStyle(card.color));
    badges.appendChild(badge);
  }
  if (badges.childNodes.length) title.appendChild(badges);
  titles.appendChild(title);
  if (card.slogan)
    titles.appendChild(el("div", "luogusp-hc-sub luogusp-hc-muted", card.slogan));
  head.appendChild(titles);
  box.appendChild(head);

  if (card.passedCount !== null)
    box.appendChild(
      row(
        "通过题数",
        card.submittedCount === null
          ? String(card.passedCount)
          : `${card.passedCount} / 尝试 ${card.submittedCount}`,
      ),
    );
  if (card.ranking !== null) box.appendChild(row("排名", fmtCount(card.ranking)));
  if (card.guRating !== null) box.appendChild(row("咕值", card.guRating));
  // ★ Elo 取顶层 data.elo 的最新一场；user.elo 恒为 null。
  if (card.eloRating !== null)
    box.appendChild(
      row(
        "比赛 Elo",
        card.eloTime
          ? `${card.eloRating}（${fmtDate(card.eloTime)}）`
          : String(card.eloRating),
      ),
    );
  if (card.prizes.length) {
    const first = card.prizes[0] && card.prizes[0].prize;
    if (first)
      box.appendChild(
        row(
          "获奖",
          [first.year, first.contest, first.prize].filter(Boolean).join(" "),
        ),
      );
  }

  box.appendChild(el("div", "luogusp-hc-sep"));
  box.appendChild(
    row(
      "关注 / 粉丝",
      `${card.followingCount === null ? "?" : card.followingCount} / ${card.followerCount === null ? "?" : card.followerCount}`,
    ),
  );
  const relationText =
    card.relation === "following" && card.reverseRelation === "following"
      ? "互相关注"
      : card.relation === "following"
        ? "我已关注"
        : card.reverseRelation === "following"
          ? "他关注了我"
          : "未关注";
  box.appendChild(row("关系", relationText));
  if (card.registerTime !== null)
    box.appendChild(row("注册于", fmtDate(card.registerTime) || "?"));

  const actions = el("div", "luogusp-hc-actions");
  // 关系未知（0/1 之外，例如黑名单）就不给可点的按钮 —— 猜错方向会替用户做错事。
  if (typeof onFollow === "function" && card.relation !== "unknown") {
    const follow = el(
      "button",
      `luogusp-hc-btn${card.relation === "following" ? " is-off" : ""}`,
      card.relation === "following"
        ? card.reverseRelation === "following"
          ? "互相关注"
          : "已关注"
        : "关注",
    );
    follow.type = "button";
    if (followBusy) follow.disabled = true;
    follow.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onFollow(card);
    });
    actions.appendChild(follow);
  }
  const home = el("a", "luogusp-hc-link", "个人主页");
  home.href = `${origin}/user/${card.uid}`;
  home.target = "_blank";
  home.rel = "noopener noreferrer";
  actions.appendChild(home);
  box.appendChild(actions);
  return box;
}

// 卡片位置：贴锚点下方，撞到视口边就翻到上方 / 收回边内。
export function placeCard(cardEl, anchorRect, viewport) {
  const gap = 8;
  const width = cardEl.offsetWidth || 320;
  const height = cardEl.offsetHeight || 160;
  let left = anchorRect.left;
  if (left + width > viewport.width - gap) left = viewport.width - width - gap;
  if (left < gap) left = gap;
  let top = anchorRect.bottom + gap;
  if (top + height > viewport.height - gap) {
    const above = anchorRect.top - height - gap;
    top = above >= gap ? above : Math.max(gap, viewport.height - height - gap);
  }
  cardEl.style.left = `${Math.round(left)}px`;
  cardEl.style.top = `${Math.round(top)}px`;
  return { left: Math.round(left), top: Math.round(top) };
}
