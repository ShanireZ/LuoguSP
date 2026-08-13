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

const fmtCount = (value) =>
  Number.isFinite(value) ? value.toLocaleString("zh-CN") : null;

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

  if (card.acceptanceRate !== null)
    box.appendChild(
      row(
        "通过率",
        `${card.acceptanceRate}%　${fmtCount(card.acceptedCount) || "?"} 通过`,
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
    let statusText = "未知";
    let statusClass = "luogusp-hc-muted";
    if (mine.accepted === true) {
      statusText = "已通过";
      statusClass = "luogusp-hc-ok";
    } else if (mine.submitted === true) {
      statusText =
        mine.bestScore === null ? "尝试过" : `尝试过 · 最高 ${mine.bestScore} 分`;
      statusClass = "luogusp-hc-warn";
    } else if (mine.submitted === false) {
      statusText = "未提交";
    }
    const status = el("span", statusClass, statusText);
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
  // ★ ✅ 与气球的驱动字段：ccfLevel>0 / xcpcLevel>0（41 用户双向零反例实测）。
  const badges = el("span", "luogusp-hc-badges");
  if (card.ccfLevel !== null && card.ccfLevel > 0)
    badges.appendChild(el("span", "luogusp-hc-badge", `✅ CCF ${card.ccfLevel}`));
  if (card.xcpcLevel !== null && card.xcpcLevel > 0)
    badges.appendChild(el("span", "luogusp-hc-badge", `🎈 XCPC ${card.xcpcLevel}`));
  if (card.badge) badges.appendChild(el("span", "luogusp-hc-badge", card.badge));
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
