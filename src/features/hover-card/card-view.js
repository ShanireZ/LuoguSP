import {
  abbreviateCount as fmtCount,
  badgeStyle,
  ccfBadge,
  levelColor,
  statusPresentation,
  xcpcBadge,
} from "./luogu-native.js";
// 卡片 DOM。★ 全程 createElement + textContent，不用 innerHTML 拼使用者資料 ——
// 題名、slogan、徽章、標籤都來自洛谷，拼字串等於把注入面留給上游。

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
};

const SVG_NS = "http://www.w3.org/2000/svg";

// 原生徽章（✅ / 🎈）。FA 的 duotone 就是同一個 viewBox 裡疊兩段 path，
// secondary 在下、primary 在上；顏色由 luogu-native 按等級給出（兩個圖標是反的）。
// ★ 不用 innerHTML：path 資料是常數，但保持全倉一致的建 DOM 方式。
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
  const value = el("span", "luogusp-hc-val");
  value.append(valueNode);
  line.append(el("span", "luogusp-hc-key", key), value);
  return line;
};

const fmtDate = (seconds) =>
  Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toLocaleDateString("zh-CN")
    : null;

// Each available statistic has a centered label and value.
const statTile = (name, value) => {
  const tile = el("div", "luogusp-hc-stat");
  tile.append(el("span", "luogusp-hc-stat-k", name), el("span", "luogusp-hc-stat-v", value));
  return tile;
};

const linkButton = (text, href, extraClass) => {
  const node = el("a", `luogusp-hc-btn is-ghost${extraClass ? " " + extraClass : ""}`, text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
};

export function renderProblemCard(card, options = {}) {
  const { origin = "", href, onResize, tagsExpanded = false } = options;
  const box = document.createDocumentFragment();

  const head = el("div", "luogusp-hc-head");
  const titles = el("div");
  titles.style.minWidth = "0";
  // ★ owner 2026-08-14：難度**用題號的顏色表達**，不再單佔一行文字。
  //   這和外掛自己的 problem-color 是同一套語義（也是洛谷自己的慣例），
  //   題名保持正文色，免得整行都花掉。
  const title = el("p", "luogusp-hc-title");
  const pid = el("span", null, card.pid);
  pid.style.color = card.difficultyColor;
  title.append(pid, ` ${card.name}`);
  titles.appendChild(title);
  head.appendChild(titles);
  box.appendChild(head);

  // owner 要求：通過數與提交數都要顯示，且按 k / m 縮寫。
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

  // ★ owner 拍板：標籤預設摺疊 —— 標籤會劇透演算法。
  if (card.tags.length) {
    const tags = el("div", "luogusp-hc-tags");
    // owner 要求：按鈕上不帶統計數字。
    const toggle = el("button", "luogusp-hc-tagbtn", tagsExpanded ? "隐藏标签" : "显示标签");
    toggle.type = "button";
    const list = el("div", "luogusp-hc-taglist");
    list.hidden = !tagsExpanded;
    toggle.setAttribute("aria-expanded", String(tagsExpanded));
    for (const name of card.tags) list.appendChild(el("span", "luogusp-hc-tag", name));
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      list.hidden = !list.hidden;
      toggle.textContent = list.hidden ? "显示标签" : "隐藏标签";
      toggle.setAttribute("aria-expanded", String(!list.hidden));
      onResize?.();
    });
    tags.append(toggle, list);
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
    // 未知就說未知：accepted 缺失不等於「沒通過」。
    // owner 要求：用洛谷原生的狀態表示。實測洛谷記錄列表只繪製兩種 ——
    // status 12 = Accepted（#52c41a），其它（實測到 14）= Unaccepted（#e74c3c）。
    // 細分狀態（WA/TLE/…）的**數字碼表本輪沒取到證據**，所以不編。
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

  // ★ owner 2026-08-14 第四輪：這兩個改成和使用者卡一樣的按鈕，文案也改。
  const actions = el("div", "luogusp-hc-actions");
  actions.appendChild(linkButton("跳转题目", href || `${origin}/problem/${card.pid}`));
  if (mine.bestRecordId !== null)
    actions.appendChild(
      linkButton("最佳提交", `${origin}/record/${mine.bestRecordId}`),
    );
  box.appendChild(actions);
  return box;
}

const sectionKey = (section) => section.classList.contains("luogusp-hc-row")
  ? section.firstElementChild.textContent : section.classList[0];

function updateSections(card, content, reuse, onChange) {
  const sections = [...content.children];
  const keys = new Set(sections.map(sectionKey));
  const previous = new Map([...card.children].map(node => [sectionKey(node), node]));
  for (const [key, old] of previous) if (!keys.has(key)) old.remove();
  let next = card.firstElementChild;
  for (const section of sections) {
    const existing = previous.get(sectionKey(section));
    let node = section;
    if (existing && (existing.isEqualNode(section) || reuse(existing, section))) node = existing;
    else if (existing) {
      existing.replaceWith(section);
      if (next === existing) next = section;
    }
    if (node !== next) card.insertBefore(node, next);
    next = node.nextElementSibling;
    if (node === section) onChange?.(node, existing);
  }
}

export function updateProblemCard(card, content, fadeField) {
  updateSections(card, content, (existing, section) => {
    if (existing.classList.contains("luogusp-hc-actions")) {
      // A late best-record link must not unset focus on the problem link.
      const currentBest = existing.children[1];
      const nextBest = section.children[1];
      if (currentBest && nextBest) currentBest.href = nextBest.href;
      else if (nextBest) existing.append(nextBest);
      else if (currentBest) {
        if (currentBest === document.activeElement) existing.firstElementChild.focus({ preventScroll: true });
        currentBest.remove();
      }
      return true;
    }
    if (existing.classList.contains("luogusp-hc-tags")) {
      existing.lastElementChild.replaceChildren(...section.lastElementChild.children);
      return true;
    }
    return false;
  }, fadeField && ((node) => {
    if (node.classList.contains("luogusp-hc-row")) fadeField(node);
  }));
}

export function updateUserCard(card, content, preserveActions, fadeField, pendingAction) {
  const active = card.contains(document.activeElement) ? document.activeElement : null;
  updateSections(card, content, (existing, section) => {
    if (existing.classList.contains("luogusp-hc-userhead")) return true;
    if (!existing.classList.contains("luogusp-hc-userbody")) return false;
    updateSections(existing, section, (old, next) => {
      if (old.classList.contains("luogusp-hc-relation-status")) {
        old.textContent = next.textContent;
        return true;
      }
      if (old.classList.contains("luogusp-hc-slogan")) {
        if (!old.firstElementChild.isEqualNode(next.firstElementChild))
          old.firstElementChild.textContent = next.firstElementChild.textContent;
        return true;
      }
      return preserveActions && old.classList.contains("luogusp-hc-actions");
    },
      fadeField && ((node, previous) => {
        if (node.classList.contains("luogusp-hc-stats")) {
          const tiles = new Map(Array.from(previous?.children ?? [], (tile) =>
            [tile.firstElementChild.textContent, tile],
          ));
          for (const tile of node.children)
            if (!tiles.get(tile.firstElementChild.textContent)?.isEqualNode(tile)) fadeField(tile);
        } else if (node.classList.contains("luogusp-hc-extra")) {
          fadeField(node);
        }
      }),
    );
    return true;
  });
  if (!active || (active === document.activeElement && !(active === card && pendingAction))) return null;

  const action = active === card ? pendingAction :
    active.dataset.luoguspAction || (active.closest(".luogusp-hc-confirm") ? "block" : null);
  const replacement = action
    ? [...card.querySelectorAll("[data-luogusp-action]")].find(node => node.dataset.luoguspAction === action)
    : active.matches("a[href]") && [...card.querySelectorAll("a[href]")].find(link => link.href === active.href);
  // A disabled relation button cannot hold focus. The card holds it until
  // settlement, unless the user has moved to another control in the meantime.
  (replacement && !replacement.disabled ? replacement : card).focus({ preventScroll: true });
  return replacement?.disabled ? action : null;
}

export function renderUserCard(card, options = {}) {
  const { origin = "", onFollow, onBlock, followBusy = false, viewerUid = null } = options;
  const box = document.createDocumentFragment();

  const header = el("div", "luogusp-hc-userhead");
  for (const name of ["cover", "avatar"]) {
    const image = el("img", `luogusp-hc-${name}`);
    image.alt = "";
    header.appendChild(image);
  }
  box.appendChild(header);

  const body = el("div", "luogusp-hc-userbody");
  // 使用者名這一行是個左右兩端對齊的 flex：左邊名字 + 徽章 + 稱號，右邊貼著 uid。
  // ★ owner 2026-08-14：uid 要在這一行**最右側**。掛在這裡而不是簽名行 ——
  //   簽名會被截成兩行，右邊緣不穩定。
  const title = el("p", "luogusp-hc-title luogusp-hc-utitle");
  const identity = el("span", "luogusp-hc-identity");
  const nameLink = el("a", "luogusp-hc-name", card.name);
  // 原生使用者名就是按等級色繪製的，並且是加粗的（UserName 元件預設 noBold=false）。
  nameLink.style.color = levelColor(card.color);
  nameLink.href = `${origin}/user/${card.uid}`;
  nameLink.target = "_blank";
  nameLink.rel = "noopener noreferrer";
  identity.appendChild(nameLink);
  // ★ ✅ 與 🎈 是真圖標：兩段 duotone path 抄自洛谷的 fontawsm 塊，
  //   分檔與配色抄自 OiLevel / XcpcLevel 元件（見 luogu-native.js）。
  const badges = el("span", "luogusp-hc-badges");
  for (const badge of [ccfBadge(card.ccfLevel), xcpcBadge(card.xcpcLevel)])
    if (badge) badges.appendChild(badgeIcon(badge));
  // 稱號：原生是白字 + 等級色底 + 圓角 2px。
  // ★★ owner 2026-08-14 第四輪報「管理員、作弊者沒顯示」。規則照抄 `UserName` 元件原文：
  //    `Cheater` 色 → 「作弊者」；否則 `user.badge`；否則 `isAdmin` → 「管理員」；都沒有就不畫。
  //    兩個字面值取自洛谷自己的 i18n 表（`Cheat` / `Admin` 的 zh-CN 值）。
  const badgeText =
    card.color === "Cheater"
      ? "作弊者"
      : card.badge
        ? card.badge
        : card.isAdmin
          ? "管理员"
          : null;
  if (badgeText) {
    const badge = el("span", "luogusp-hc-badge", badgeText);
    badge.setAttribute("style", badgeStyle(card.color));
    badges.appendChild(badge);
  }
  if (badges.childNodes.length) identity.appendChild(badges);
  title.append(identity, el("span", "luogusp-hc-uid", `uid : ${card.uid}`));
  body.appendChild(title);

  // slogan。原生在空的時候回落到「這個人很懶，什麼也沒有留下。」，我們照做。
  // ★ 過長交給 CSS 截（-webkit-line-clamp 兩行），不在 JS 裡切字串 —— 會劈開 emoji。
  // `finalizeCard()` 量完才在第二行末尾顯示展開按鈕。展開後交由卡片捲動顯示全文。
  const sloganBox = el("div", "luogusp-hc-slogan");
  const slogan = el(
    "div",
    "luogusp-hc-sub luogusp-hc-muted luogusp-hc-clamp",
    card.slogan || "这个人很懒，什么也没有留下。",
  );
  const expand = el("button", "luogusp-hc-expand", "展开");
  expand.type = "button";
  expand.setAttribute("aria-expanded", "false");
  expand.hidden = true;
  expand.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = sloganBox.classList.toggle("is-open");
    expand.textContent = open ? "收起" : "展开";
    expand.setAttribute("aria-expanded", String(open));
    if (typeof options.onResize === "function") options.onResize();
  });
  sloganBox.append(slogan, expand);
  body.appendChild(sloganBox);

  const stats = el("div", "luogusp-hc-stats");
  if (card.followingCount !== null)
    stats.appendChild(statTile("关注", fmtCount(card.followingCount)));
  if (card.followerCount !== null)
    stats.appendChild(statTile("粉丝", fmtCount(card.followerCount)));
  if (card.eloRating !== null)
    stats.appendChild(statTile("等级分", String(card.eloRating)));
  // ★ owner 2026-08-14：咕值與「通過 / 提交」從下面的擴充行**挪進這一排**，依次尾隨。
  if (card.guRating !== null) stats.appendChild(statTile("咕值", String(card.guRating)));
  // ★★ 「通過 / 提交」只認 `/user/{uid}` 的口徑（主介面同名欄位是提交**次數**，會大 8 倍）。
  //    隱藏了做題情況的帳號兩個都拿不到（實測 397982），整格不畫。
  if (card.passedCount !== null || card.submittedCount !== null)
    stats.appendChild(
      statTile(
        "通过 / 提交",
        `${fmtCount(card.passedCount) || "?"} / ${fmtCount(card.submittedCount) || "?"}`,
      ),
    );
  if (stats.childNodes.length) body.appendChild(stats);

  // ---- 操作區。原生是「關注 / 私信 / 更多(拉黑·舉報·管理使用者)」，
  //      owner 要求把舉報與屏蔽**攤開放在按鈕行右側**，不折疊。 ----
  // ★ 看自己時原生整個操作區都不畫（元件裡的 `x.value || M.value`），我們照做。
  const isSelf = viewerUid !== null && viewerUid === card.uid;
  if (!isSelf) {
    const actions = el("div", "luogusp-hc-actions");
    // 關注：拉黑狀態下原生是禁用的（寫著「已拉黑」），未知關係一律不給可點按鈕。
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
      follow.dataset.luoguspAction = "follow";
      if (followBusy || blacklisted) follow.disabled = true;
      follow.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onFollow(card);
      });
      actions.appendChild(follow);
    }
    // 私信：原生就是一個到 /chat?uid= 的連結（路由名 chat.list）。
    actions.appendChild(linkButton("私信", `${origin}/chat?uid=${card.uid}`));
    // ★ owner 2026-08-14 第四輪：私信與舉報之間加一個「專欄」。
    //   路由 user.show.article → /user/{uid}/article（`/_lfe/config` 裡可查）。
    actions.appendChild(linkButton("专栏", `${origin}/user/${card.uid}/article`));
    // ★ 舉報與屏蔽不靠右，**緊跟在私信/專欄後面**。
    // 舉報：原生也只是個連結，路由 ticket.create → /ticket/new。不發任何請求。
    actions.appendChild(
      linkButton(
        "举报",
        `${origin}/ticket/new?type=report.user&related=${card.uid}`,
        "is-danger",
      ),
    );
    // 屏蔽：**正在關注的人不能拉黑**（洛谷自己會拒）。
    // ★★ owner 2026-08-14 拍板：確認改成**卡內就地確認**，不彈任何層。
    //    點一下「屏蔽」，整條按鈕行原地換成「確定屏蔽 XXX？[確定] [取消]」。
    //    懸停卡本來就貼在指針底下，再疊一個居中彈層反而要使用者把滑鼠移開 ——
    //    而滑鼠一移開，卡片自己就該收起來了。
    if (typeof onBlock === "function" && (card.relation === "unrelated" || card.relation === "blacklisted")) {
      const undo = card.relation === "blacklisted";
      const block = el("button", "luogusp-hc-btn is-ghost is-danger", undo ? "取消屏蔽" : "屏蔽");
      block.type = "button";
      block.dataset.luoguspAction = "block";
      if (followBusy) block.disabled = true;
      block.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ask = el("div", "luogusp-hc-actions luogusp-hc-confirm");
        ask.appendChild(
          el(
            "span",
            "luogusp-hc-confirm-text",
            `${undo ? "取消屏蔽" : "屏蔽"} ${card.name}？`,
          ),
        );
        const yes = el("button", "luogusp-hc-btn is-danger", "确定");
        yes.type = "button";
        const restoreActions = () => {
          ask.replaceWith(actions);
          options.onResize?.();
          block.focus({ preventScroll: true });
        };
        yes.addEventListener("click", (accept) => {
          accept.preventDefault();
          accept.stopPropagation();
          restoreActions();
          onBlock(card);
        });
        const no = el("button", "luogusp-hc-btn is-ghost", "取消");
        no.type = "button";
        no.addEventListener("click", (cancel) => {
          cancel.preventDefault();
          cancel.stopPropagation();
          restoreActions();
        });
        ask.append(yes, no);
        actions.replaceWith(ask);
        // 換了一行內容，高度可能變 —— 就地重定位，免得頂出視口。
        if (typeof options.onResize === "function") options.onResize();
        no.focus({ preventScroll: true });
      });
      actions.appendChild(block);
    }
    body.appendChild(actions);
    if (onFollow || onBlock) {
      const status = el("div", "luogusp-hc-relation-status", options.relationNotice);
      status.setAttribute("role", "status");
      body.appendChild(status);
    }
  }

  // ---- 到這裡為止是「復刻」，下面是我們的擴充 ----
  // 擴充區只剩上面那排放不下的東西。★ owner 2026-08-14 砍掉兩行：
  //   「關係」—— 關注按鈕已經把關係說清楚了（關注 / 已關注 / 互相關注 / 已拉黑），重複；
  //   「註冊於」—— 不看。
  //   咕值與通過/提交不是刪掉，是**挪進了上面的統計排**。
  const extras = el("div", "luogusp-hc-extra");
  // 獲獎：最近 3 條，年份降序。★ 只取 `contest`（已經是簡稱），**不取 `event`** ——
  // 那是「被認為是第 50 屆 ICPC…上海站」這種全稱，會把整行撐爆。
  if (card.prizes.length) {
    const entries = card.prizes
      .map((item) => item && item.prize)
      .filter(Boolean)
      .map((prize) => [prize.year, prize.contest, prize.prize].filter(Boolean).join(" "))
      .filter((text) => text);
    if (entries.length) {
      const list = el("span", "luogusp-hc-stack");
      for (const text of entries) list.appendChild(el("span", null, text));
      extras.appendChild(row("最近奖项", list));
    }
  }
  if (extras.childNodes.length) {
    body.appendChild(el("div", "luogusp-hc-sep"));
    body.appendChild(extras);
  }
  box.appendChild(body);
  return box;
}

// 插入文件之後才做得了的那點收尾。★ 目前只有一件事：簽名到底有沒有溢出兩行 ——
// 沒溢出就別擺那個「展開」按鈕。讀 `scrollHeight` 會強制一次同步佈局，
// 而這時候卡片已經在文件裡、`hidden` 也已經摘掉，量得到真值。
export function finalizeCard(cardEl) {
  const box = cardEl.querySelector(".luogusp-hc-slogan");
  const slogan = box && box.querySelector(".luogusp-hc-clamp");
  const expand = box && box.querySelector(".luogusp-hc-expand");
  if (!slogan || !expand) return;
  const wasOpen = box.classList.contains("is-open");
  // Measure against the same two-line limit even when the user expanded it.
  box.classList.remove("is-open");
  const overflowing = slogan.scrollHeight > slogan.clientHeight + 1;
  const restoreFocus = !overflowing && document.activeElement === expand;
  const open = wasOpen && overflowing;
  box.classList.toggle("is-open", open);
  expand.hidden = !overflowing;
  expand.textContent = open ? "收起" : "展开";
  expand.setAttribute("aria-expanded", String(open));
  if (restoreFocus)
    (cardEl.querySelector(".luogusp-hc-name") || cardEl).focus({ preventScroll: true });
}

// 卡片位置。
// ★ owner 2026-08-14 第一輪報過「卡片離題目遠、滑鼠移過去時被換掉」：定位錨點用
//   **指針所在的那一行**（呼叫方先挑好再傳進來），間隙收到 4px。
// ★★ owner 第四輪報「有的向上有的向下，向下時點開標籤就出界」：
//   舊判據是「下面放不下就翻上去」，於是下面差一點點也整張翻走；而翻上去同樣放不下時
//   又被壓回視口內 —— 卡片高度一變（展開標籤、展開簽名）就頂出去。
//   現在改成兩步：**放得下就放下面，放不下挑空間大的那一邊**，
//   並且把 `max-height` 釘在那一側的可用空間上（配合 CSS 的 `overflow:auto`），
//   於是內容再長也只是卡片內部出捲軸，永遠不出界。
export function placeCard(cardEl, rect, viewport, options = {}) {
  const gap = 4;
  const x = viewport.x ?? 0;
  const y = viewport.y ?? 0;
  cardEl.style.maxWidth = `${Math.max(0, viewport.width - 24)}px`;
  options.measureSignature?.();
  const width = cardEl.offsetWidth || 320;
  const left = Math.max(x + gap, Math.min(rect.left, x + viewport.width - width - gap));

  // ★★★ 先把上一次釘的 max-height 摘掉再量。owner 2026-08-14 第七輪報
  //    「展開之後越界」「下面明明放不下卻還往下彈、右邊出捲軸」——根因就在這：
  //    上一次定位留下的 `max-height` 把 `offsetHeight` 夾住了，於是內容明明長高了，
  //    量出來還是那個被夾住的舊高度，判據以為「下面放得下」，永遠不翻上去。
  //    **量之前必須先鬆開自己上一次施加的約束。**
  cardEl.style.maxHeight = "";
  // ★★★ 2.14.1「卡片跳走」。載入態的卡片裡只有一個 16px 的轉圈，連內邊距才 ≈42px；
  //   內容一到就是 ≈320px。拿轉圈的真高去定邊，**錨點下方餘量 44~320px 時必然**
  //   先落下方、內容一完成實作又翻到上方 —— 那是視口下部一大片區域，不是邊角情形，
  //   而且指針正朝原來那個位置移動，卡片從它底下跳走。
  //   修法：載入態傳 `assumeMinHeight`，用「內容將會有多高」去定邊，而不是用轉圈的高。
  const natural = Math.max(
    cardEl.offsetHeight || 160,
    Number(options.assumeMinHeight) || 0,
  );

  const below = y + viewport.height - rect.bottom - gap * 2;
  const above = rect.top - y - gap * 2;
  // ★★ 上下分界線（owner 要的「分界比例」就是這三句，按優先級從上往下讀）：
  //   1. **下面放得下就放下面** —— 閱讀順序自然，也是原生的習慣；
  //   2. 下面放不下、**上面放得下就翻上去** —— 這一條是本輪補的。
  //      舊判據是「下面放不下且 below < above 才翻」，於是「下面差一點點、但仍比上面寬」
  //      的情形會賴在下面並被 max-height 夾出捲軸，正是 owner 看到的樣子；
  //   3. 兩邊都放不下 —— 才比誰寬，挑寬的那邊，並把 max-height 釘在那一側。
  //      這時候出捲軸是沒辦法的事（視口本來就裝不下），但絕不出界。
  const fitsBelow = natural <= below;
  const fitsAbove = natural <= above;
  // ★★ `forceBelow` 只在**內容完成實作那一次**由呼叫方釘住，沿用開卡時定的那一邊，
  //   保證「轉圈在哪一邊，內容就在哪一邊」。之後（使用者點展開標籤/展開簽名）
  //   一律傳 null，仍按上面那三句話重新判 —— owner 第七輪要的翻邊行為一字不動。
  const useBelow =
    typeof options.forceBelow === "boolean"
      ? options.forceBelow
      : fitsBelow || (!fitsAbove && below >= above);
  const fullHeight = Math.max(0, Math.floor(viewport.height - gap * 2));
  const room = Math.min(fullHeight, Math.max(120, Math.floor(useBelow ? below : above)));
  cardEl.style.maxHeight = `${room}px`;
  const height = Math.min(cardEl.offsetHeight || natural, room);
  const anchoredTop = useBelow ? rect.bottom + gap : rect.top - height - gap;
  const top = Math.max(y + gap, Math.min(anchoredTop, y + viewport.height - height - gap));
  cardEl.style.left = `${Math.round(left)}px`;
  cardEl.style.top = `${Math.round(top)}px`;
  return {
    left: Math.round(left),
    top: Math.round(top),
    maxHeight: room,
    below: useBelow,
    // 給測試與排查用：這次到底是「放得下」還是「兩邊都放不下只能挑大的」。
    fits: useBelow ? fitsBelow : fitsAbove,
  };
}
