import {
  abbreviateCount,
  badgeStyle,
  ccfBadge,
  levelColor,
  statusPresentation,
  xcpcBadge,
} from "./luogu-native.js";
// 卡片 DOM。★ 全程 createElement + textContent，不用 innerHTML 拼用户数据 ——
// 题名、slogan、徽章、标签都来自洛谷，拼字符串等于把注入面留给上游。

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

const SVG_NS = "http://www.w3.org/2000/svg";

// 原生徽章（✅ / 🎈）。FA 的 duotone 就是同一个 viewBox 里叠两段 path，
// secondary 在下、primary 在上；颜色由 luogu-native 按等级给出（两个图标是反的）。
// ★ 不用 innerHTML：path 数据是常量，但保持全仓一致的建 DOM 方式。
const badgeIcon = (badge) => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", badge.icon.viewBox);
  svg.setAttribute("class", "luogusp-hc-fa");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", badge.label);
  for (const [d, fill] of [
    [badge.icon.secondary, badge.secondary],
    [badge.icon.primary, badge.primary],
  ]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", fill);
    svg.appendChild(path);
  }
  return svg;
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
  // ★ owner 2026-08-14：难度**用题号的颜色表达**，不再单占一行文字。
  //   这和插件自己的 problem-color 是同一套语义（也是洛谷自己的惯例），
  //   题名保持正文色，免得整行都花掉。
  const title = el("p", "luogusp-hc-title");
  const pid = el("span", null, card.pid);
  pid.style.color = card.difficultyColor;
  title.appendChild(pid);
  title.appendChild(document.createTextNode(` ${card.name}`));
  titles.appendChild(title);
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
    // owner 要求：按钮上不带统计数字。
    const toggle = el("button", "luogusp-hc-tagbtn", "显示标签");
    toggle.type = "button";
    const list = el("div", "luogusp-hc-taglist");
    list.hidden = true;
    for (const name of card.tags) list.appendChild(el("span", "luogusp-hc-tag", name));
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      list.hidden = !list.hidden;
      toggle.textContent = list.hidden ? "显示标签" : "隐藏标签";
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

// 关系文案。★ 两个方向各自可能是「未知」（响应里没这个字段），所以不能只判 following ——
// 一边未知时只说得出确定的那一半，说满了就是伪造。两边都未知时调用方根本不画这一行。
export function relationText(card) {
  const mine = card.relation === "following";
  const theirs = card.reverseRelation === "following";
  if (mine && theirs) return "互相关注";
  if (mine) return "我已关注";
  if (theirs) return "他关注了我";
  if (card.relation === "unrelated" && card.reverseRelation === "unrelated")
    return "未关注";
  return card.relation === "unrelated" ? "我未关注" : "他未关注我";
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
  // ★ ✅ 与 🎈 现在是**真图标**：FA duotone 的两段 path 照抄自洛谷的 fontawsm 块，
  //   分档与配色照抄自 OiLevel / XcpcLevel 组件（见 luogu-native.js 的注释）。
  //   上一版渲染成 "CCF 7" / "XCPC 3" 这样的文字 —— owner 报的就是这条。
  const badges = el("span", "luogusp-hc-badges");
  for (const badge of [ccfBadge(card.ccfLevel), xcpcBadge(card.xcpcLevel)])
    if (badge) badges.appendChild(badgeIcon(badge));
  // 称号：原生是白字 + 等级色底 + 圆角 2px。
  if (card.badge) {
    const badge = el("span", "luogusp-hc-badge", card.badge);
    badge.setAttribute("style", badgeStyle(card.color));
    badges.appendChild(badge);
  }
  if (badges.childNodes.length) title.appendChild(badges);
  titles.appendChild(title);
  // ★ owner：个人签名可能很长。截断交给 CSS（-webkit-line-clamp，最多两行后省略号），
  //   不在这里截字符串 —— 按码位截会把 emoji / 组合字符劈成两半。
  if (card.slogan)
    titles.appendChild(
      el("div", "luogusp-hc-sub luogusp-hc-muted luogusp-hc-clamp", card.slogan),
    );
  head.appendChild(titles);
  box.appendChild(head);

  // ★★ owner 2026-08-14 的两条口径，合成一条：改叫「通过 / 提交」（去掉「尝试」二字，
  //    与题目卡同一个说法），并且**用户把做题情况设为隐藏时这两个字段就没有** ——
  //    两个都缺就整行不画，只缺一个就把缺的那半写 `?`。
  //    绝不能拿 0 顶替：`Number(null) === 0` 这个坑本项目已经咬过三次。
  if (card.passedCount !== null || card.submittedCount !== null)
    box.appendChild(
      row(
        "通过 / 提交",
        `${fmtCount(card.passedCount) || "?"} / ${fmtCount(card.submittedCount) || "?"}`,
      ),
    );
  // ★ owner 要求移除「排名」一行（原生悬停卡里有，我们不重复）。
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
  // 获奖。★ owner 问过两次「显示的是最后一条吗」——查清了：`data.prizes` 是
  //   **按年份升序**的（实测 697932：2024 CSP-J 在前、2025 CSP-S 在后，洛谷个人页也是这个顺序），
  //   而旧代码取 `prizes[0]`，等于**永远只显示最早那一条**，最近的奖反而看不到。
  //   现在按年份**降序**把拿到的都摆出来（模型层已截到 4 条），每条一行。
  if (card.prizes.length) {
    const entries = card.prizes
      .map((item) => item && item.prize)
      .filter(Boolean)
      .map((prize) =>
        [prize.year, prize.contest, prize.event, prize.prize]
          .filter(Boolean)
          .join(" "),
      )
      .filter((text) => text);
    if (entries.length) {
      const list = el("span", "luogusp-hc-stack");
      for (const text of entries) list.appendChild(el("span", null, text));
      box.appendChild(row("获奖", list));
    }
  }

  const separator = el("div", "luogusp-hc-sep");
  let separated = false;
  const separate = () => {
    if (separated) return;
    separated = true;
    box.appendChild(separator);
  };
  // ★ 关注/粉丝：两个都拿不到就不画这一行（隐藏了社交信息的账号就是这样）。
  if (card.followingCount !== null || card.followerCount !== null) {
    separate();
    box.appendChild(
      row(
        "关注 / 粉丝",
        `${card.followingCount === null ? "?" : card.followingCount} / ${card.followerCount === null ? "?" : card.followerCount}`,
      ),
    );
  }
  // ★★ 关系那一行以前**恒画**，两边都未知时写成「未关注」—— 那是在伪造未知：
  //    匿名访客（以及看自己时）的响应里根本没有 userRelationship / reverseUserRelationship
  //    （实测：匿名取 /user/697932，两个字段都不返回），却被断言成「没关注他」。
  //    现在两边都未知就不画这一行。
  if (card.relation !== "unknown" || card.reverseRelation !== "unknown") {
    separate();
    box.appendChild(row("关系", relationText(card)));
  }
  if (card.registerTime !== null) {
    separate();
    box.appendChild(row("注册于", fmtDate(card.registerTime) || "?"));
  }

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

// 卡片位置。★ owner 报「卡片离题目较远，鼠标移动时卡片会消失然后显示另一题的卡片」：
// 根因是跨行锚点（题号被包在一个跨两行的 <a> 里）的 getBoundingClientRect().bottom
// 落在第二行下面，卡片被推远；鼠标去卡片的路上就会经过别的题号，于是切了目标。
// 修法：定位锚点用**指针所在的那一行**（调用方传 pointer 时以它为准），并把间隙收到 4px。
// 调用方负责先挑好「指针所在的那一行」再传进来（见 feature.js 的 rectForPointer）。
export function placeCard(cardEl, rect, viewport) {
  const gap = 4;
  const width = cardEl.offsetWidth || 320;
  const height = cardEl.offsetHeight || 160;
  let left = rect.left;
  if (left + width > viewport.width - gap) left = viewport.width - width - gap;
  if (left < gap) left = gap;
  let top = rect.bottom + gap;
  if (top + height > viewport.height - gap) {
    const above = rect.top - height - gap;
    top = above >= gap ? above : Math.max(gap, viewport.height - height - gap);
  }
  cardEl.style.left = `${Math.round(left)}px`;
  cardEl.style.top = `${Math.round(top)}px`;
  return { left: Math.round(left), top: Math.round(top) };
}
