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
  // 拉黑压过一切：既然已经拉黑，说「未关注」是废话。
  if (card.relation === "blacklisted") return "我已屏蔽";
  if (card.reverseRelation === "blacklisted") return "他屏蔽了我";
  const mine = card.relation === "following";
  const theirs = card.reverseRelation === "following";
  if (mine && theirs) return "互相关注";
  if (mine) return "我已关注";
  if (theirs) return "他关注了我";
  if (card.relation === "unrelated" && card.reverseRelation === "unrelated")
    return "未关注";
  return card.relation === "unrelated" ? "我未关注" : "他未关注我";
}

// 洛谷原生页头背景图的兜底。★ 抄自 UserFloatCard 组件原文：
// `user.background || "https://cdn.luogu.com.cn/images/bg/fe/DSCF0530-shrink.jpg"`。
const DEFAULT_HEADER_BACKGROUND =
  "https://cdn.luogu.com.cn/images/bg/fe/DSCF0530-shrink.jpg";

// 原生统计块：一个标签一个数字，横着铺。原生四项是 关注 / 粉丝 / 排名 / 等级分，
// 其中等级分**只在 eloValue 有值时才出现**（组件原文里就是 `...e.eloValue?[…]:[]`）。
// ★ 「排名」按 owner 2026-08-14 上一轮的明确要求移除，其余照原生。
const statTile = (name, value) => {
  const tile = el("div", "luogusp-hc-stat");
  tile.appendChild(el("span", "luogusp-hc-stat-k", name));
  tile.appendChild(el("span", "luogusp-hc-stat-v", value));
  return tile;
};

const linkButton = (text, href, extraClass) => {
  const node = el("a", `luogusp-hc-btn is-ghost${extraClass ? " " + extraClass : ""}`, text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
};

export function renderUserCard(card, options = {}) {
  const { origin = "", onFollow, onBlock, followBusy = false, viewerUid = null } = options;
  const box = document.createDocumentFragment();

  // ---- 原生卡的页头：背景图 + 压在上面的头像 ----
  const header = el("div", "luogusp-hc-userhead");
  header.style.backgroundImage = `url("${(card.background || DEFAULT_HEADER_BACKGROUND).replace(/"/g, "%22")}")`;
  if (card.avatar) {
    const avatar = el("img", "luogusp-hc-avatar");
    avatar.src = card.avatar;
    avatar.alt = "";
    avatar.loading = "lazy";
    header.appendChild(avatar);
  }
  box.appendChild(header);

  const body = el("div", "luogusp-hc-userbody");
  const title = el("p", "luogusp-hc-title");
  const nameLink = el("a", "luogusp-hc-name", card.name);
  // 原生用户名就是按等级色渲染的，并且是加粗的（UserName 组件默认 noBold=false）。
  nameLink.style.color = levelColor(card.color);
  nameLink.href = `${origin}/user/${card.uid}`;
  nameLink.target = "_blank";
  nameLink.rel = "noopener noreferrer";
  title.appendChild(nameLink);
  // ★ ✅ 与 🎈 是真图标：两段 duotone path 抄自洛谷的 fontawsm 块，
  //   分档与配色抄自 OiLevel / XcpcLevel 组件（见 luogu-native.js）。
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
  body.appendChild(title);

  // slogan。原生在空的时候回落到「这个人很懒，什么也没有留下。」，我们照做。
  // ★ 过长交给 CSS 截（-webkit-line-clamp 两行），不在 JS 里切字符串 —— 会劈开 emoji。
  body.appendChild(
    el(
      "div",
      "luogusp-hc-sub luogusp-hc-muted luogusp-hc-clamp",
      card.slogan || "这个人很懒，什么也没有留下。",
    ),
  );

  const stats = el("div", "luogusp-hc-stats");
  if (card.followingCount !== null)
    stats.appendChild(statTile("关注", fmtCount(card.followingCount)));
  if (card.followerCount !== null)
    stats.appendChild(statTile("粉丝", fmtCount(card.followerCount)));
  // ★ 等级分：原生取 `user.eloValue`。注意「eloValue 恒为 null」那条旧结论
  //   **只对 `/user/{uid}` 成立**；主接口 `/api/user/info/{uid}` 里是真值，原生卡读的就是它。
  if (card.eloRating !== null)
    stats.appendChild(statTile("等级分", String(card.eloRating)));
  if (stats.childNodes.length) body.appendChild(stats);

  // ---- 操作区。原生是「关注 / 私信 / 更多(拉黑·举报·管理用户)」，
  //      owner 要求把举报与屏蔽**摊开放在按钮行右侧**，不折叠。 ----
  // ★ 看自己时原生整个操作区都不画（组件里的 `x.value || M.value`），我们照做。
  const isSelf = viewerUid !== null && viewerUid === card.uid;
  if (!isSelf) {
    const actions = el("div", "luogusp-hc-actions");
    // 关注：拉黑状态下原生是禁用的（写着「已拉黑」），未知关系一律不给可点按钮。
    if (typeof onFollow === "function" && card.relation !== "unknown") {
      const blacklisted = card.relation === "blacklisted";
      const following = card.relation === "following";
      const follow = el(
        "button",
        `luogusp-hc-btn${following || blacklisted ? " is-off" : ""}`,
        blacklisted
          ? "已拉黑"
          : following
            ? card.reverseRelation === "following"
              ? "互相关注"
              : "已关注"
            : "关注",
      );
      follow.type = "button";
      if (followBusy || blacklisted) follow.disabled = true;
      follow.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onFollow(card);
      });
      actions.appendChild(follow);
    }
    // 私信：原生就是一个到 /chat?uid= 的链接（路由名 chat.list）。
    actions.appendChild(linkButton("私信", `${origin}/chat?uid=${card.uid}`));
    actions.appendChild(el("span", "luogusp-hc-spacer"));
    // 举报：原生也只是个链接，路由 ticket.create → /ticket/new。不发任何请求。
    actions.appendChild(
      linkButton(
        "举报",
        `${origin}/ticket/new?type=report.user&related=${card.uid}`,
        "is-danger",
      ),
    );
    // 屏蔽：原生要先弹确认，且**正在关注的人不能拉黑**（洛谷自己会拒）。
    if (typeof onBlock === "function" && (card.relation === "unrelated" || card.relation === "blacklisted")) {
      const block = el(
        "button",
        "luogusp-hc-btn is-ghost is-danger",
        card.relation === "blacklisted" ? "取消屏蔽" : "屏蔽",
      );
      block.type = "button";
      if (followBusy) block.disabled = true;
      block.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onBlock(card);
      });
      actions.appendChild(block);
    }
    body.appendChild(actions);
  }

  // ---- 到这里为止是「复刻」，下面是我们的扩展 ----
  const extras = el("div", "luogusp-hc-extra");
  // ★★ 「通过 / 提交」只认 `/user/{uid}` 的口径（主接口同名字段含义不同，会大 8 倍）。
  //    隐藏了做题情况的账号两个都拿不到（实测 397982），整行不画。
  if (card.passedCount !== null || card.submittedCount !== null)
    extras.appendChild(
      row(
        "通过 / 提交",
        `${fmtCount(card.passedCount) || "?"} / ${fmtCount(card.submittedCount) || "?"}`,
      ),
    );
  if (card.guRating !== null) extras.appendChild(row("咕值", card.guRating));
  // 获奖：最近 3 条，年份降序。★ 只取 `contest`（已经是简称），**不取 `event`** ——
  // 那是「被认为是第 50 届 ICPC…上海站」这种全称，会把整行撑爆。
  if (card.prizes.length) {
    const entries = card.prizes
      .map((item) => item && item.prize)
      .filter(Boolean)
      .map((prize) => [prize.year, prize.contest, prize.prize].filter(Boolean).join(" "))
      .filter((text) => text);
    if (entries.length) {
      const list = el("span", "luogusp-hc-stack");
      for (const text of entries) list.appendChild(el("span", null, text));
      extras.appendChild(row("获奖", list));
    }
  }
  // ★★ 关系：两边都未知就不画 —— 匿名访客拿不到这两个字段，写「未关注」是伪造。
  //    看自己时也不画：「我和我自己未关注」是句废话（原生连整个操作区都不画）。
  if (!isSelf && (card.relation !== "unknown" || card.reverseRelation !== "unknown"))
    extras.appendChild(row("关系", relationText(card)));
  if (card.registerTime !== null)
    extras.appendChild(row("注册于", fmtDate(card.registerTime) || "?"));
  if (card.blogAddress) {
    const blog = el("a", "luogusp-hc-link", "个人博客");
    blog.href = card.blogAddress;
    blog.target = "_blank";
    blog.rel = "noopener noreferrer";
    extras.appendChild(row("博客", blog));
  }
  if (extras.childNodes.length) {
    body.appendChild(el("div", "luogusp-hc-sep"));
    body.appendChild(extras);
  }
  box.appendChild(body);
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
