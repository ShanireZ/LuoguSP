// 錨點識別：頁面上哪些元素該出卡。
//
// ★ 用事件委託（document 上一對 mouseover/mouseout）而不是給每個錨點掛監聽 +
//   MutationObserver。洛谷是 SPA，錨點隨路由重掛；委託天然不受影響，
//   而且**繞開了 rAF 節流那個坑** —— 隱藏標籤頁裡 rAF 不觸發，
//   凡是靠 rAF 補種監聽的路徑都會假死（交接單裡記過兩次）。

// ★★ pid 的字元集只有這一份。sources.js 曾經自己寫了一份**漏掉下劃線**的，
//    於是 `AT_abc397_a` / `CF_...` 這類題在資料層被當成非法 pid 直接退出，
//    卡片只剩一句「拿不到這條資料」—— 而介面本身是好的（實測 200、11541 B）。
//    owner 2026-08-14 第五輪報的就是它。同一個判據不許有第二份。
// ★ 定義已下沉到 `problem-color/identity.js`（那邊同時進啟動包與本塊，而本檔案只在本塊裡），
//   這裡只是**再匯出**，好讓既有引用方不必改路徑 —— 判據仍然只有一份。
import { PID_PATTERN } from "../problem-color/identity.js";
export { PID_PATTERN };
// 頭像 URL 形如 https://cdn.luogu.com.cn/upload/usericon/1313427.png
const AVATAR_UID = /\/upload\/usericon\/(\d+)\./;

// ★ 站台框架裡的錨點一律不出卡。owner 2026-08-14 報的三條誤彈裡有兩條落在這裡。
//   下面每一段都是登入態真機 DOM 實測（/problem/P1001 與 /user/{uid}）：
//
//   columba（新版）頁：
//     div.top-bar > div.left  > div.breadcrumb > a          ← 左上角那個題號/使用者名
//     div.top-bar > div.right > div.user-nav > span.avatar > a[/user/{我}]
//     nav.sidebar.lside.bar.hide.nav-scrollbar              ← 左抽屜（題庫等導覽）
//     div.user-nav.rside.hide.nav-scrollbar                 ← 右抽屜（「個人中心」選單）
//   舊版頁（首頁就是）：
//     nav.user-nav < div.container < div.wrapper.header-layout ← 同一個使用者選單，換了套殼
//
// ★★ 右抽屜是 **`.top-bar` 的兄弟節點**（兩者都直掛 `div#app.lfe-body`），
//    它裡面有 `/user/{我}` 與 `/user/{我}/practice`。只排除 `.top-bar` 會整個漏掉它 ——
//    而 owner 說的「選單欄個人中心」正是這個抽屜裡的條目。
// ★★ `.user-nav` 是**三處共用**的類名（新版頂欄的使用者區、新版右抽屜、舊版頁頭選單），
//    單靠 `.top-bar/.lside/.rside` 會漏掉**舊版頁**——首頁實測就漏了（真機掃出來的）。
// ★★ 反過來也別擴大：文章頁的 `header` 裡是**作者**的使用者名，那是要出卡的。
const SITE_CHROME_SELECTOR = ".top-bar, .lside, .rside, .user-nav";

const inSiteChrome = (node) =>
  !!(node && typeof node.closest === "function" && node.closest(SITE_CHROME_SELECTOR));

// ★ pid 判據。canary.13 的教訓是**別用松正則**（`/problem/list` 與
//   `/problem/list?tag=N` 都會被當成 pid=`list`，於是導覽按鈕和 TAG 膠囊到處彈卡）；
//   canary.14 的教訓是**也別全交給 problem-color 的解析器** —— 它額外要求「錨點文字
//   真的顯示該 pid」，那是為**著色**設計的判據，而題庫列表裡題目連結的文字是**題名**，
//   於是題庫裡的題目反而不彈卡了（過度修復）。
//
// 所以這裡自己判，兩條硬要求：
//   1. href 的 **path 必須恰好是 `/problem/{id}`**（允許尾斜槓與 query，
//      所以 `/problem/list?tag=42` 因為 path 是 `/problem/list` 而被 id 形態擋下）；
//   2. id 必須**同時含字母和數字** —— `list` / `solution` / `new` 天然出局。
const looksLikePid = (id) =>
  typeof id === "string" && /[A-Za-z]/.test(id) && /[0-9]/.test(id) && PID_PATTERN.test(id);

const pidFromHref = (href) => {
  if (typeof href !== "string" || !href) return null;
  // 只看 path 段，query 與 hash 一律不參與。
  const path = href.split(/[?#]/)[0];
  const match = path.match(/\/problem\/([A-Za-z0-9_]+)\/?$/);
  return match ? match[1] : null;
};

// ★★★ owner 2026-08-14 第五輪：題庫裡懸停**題號**不該出卡，而且它「和難度著色衝突」。
//    查清了，是同一個根因：題庫每行的題號是 `div.pid[title="P1000"]`（不是連結），
//    而 **problem-color 正是靠這個 `title` 認出這是哪道題**
//    （`identity.js` 的 standaloneIdentity：title 必須是合法 pid 且與文字相同）。
//    我們為了滅掉瀏覽器原生浮泡會 `removeAttribute("title")` —— 一摘，著色當場失效。
//    所以 `.pid[title]` **整個從錨點選擇器裡拿掉**：題號格不出卡、title 不被碰，
//    同一行的**題名連結**照常出卡（那才是 canary.14 修過要保住的那條）。
export function resolveProblemAnchor(node, identity) {
  if (!node || typeof node.closest !== "function") return null;
  const anchor = node.closest('a[href*="/problem/"], a[data-luogusp-pid]');
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
  // owner 要求：使用者名和頭像都出卡。頭像常常不在 <a> 裡（列表項自己處理點擊），
  // 所以先看連結，再退回頭像 URL 裡的 uid。
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

// 當前頁面「講的就是」誰 / 哪道題。★ owner 2026-08-14：個人頁上那個人自己的頭像、
// 題目頁上指回本題的連結，都不該彈卡 —— 卡片是用來預覽**別處**的東西的，
// 在講 P1001 的頁面上再彈一張 P1001 的卡毫無資訊量。而「推薦題目」是別的 pid，照常彈。
//
// 判據掛在 URL 路徑的**形狀**上，不掛具體類名：類名會隨洛谷改版爛掉，
// `/user/{uid}` 與 `/problem/{pid}` 這兩個形狀不會（上一輪已經因為掛類名吃過虧）。
// `/problem/list`、`/problem/solution/...` 這類第一段不是 pid 的，一律沒有主體。
export function readPageSubject(pathname) {
  const path = typeof pathname === "string" ? pathname : "";
  const user = path.match(/^\/user\/(\d+)(?:\/|$)/);
  if (user) {
    const uid = Number(user[1]);
    if (Number.isSafeInteger(uid) && uid > 0)
      return Object.freeze({ kind: "user", uid });
  }
  const problem = path.match(/^\/problem\/([A-Za-z0-9_]+)(?:\/|$)/);
  if (problem && looksLikePid(problem[1]))
    return Object.freeze({ kind: "problem", pid: problem[1] });
  return null;
}

// 私信頁「最近聯繫」列表的備援。★ owner 2026-08-14 第五輪：懸停那裡的**使用者名**沒反應。
// 真機 DOM 實測（/chat，舊版頁）：
//     div.item
//       span.avatar > img{src=.../usericon/2020479.png}
//       div > span > span[使用者名]        ← 純 span，沒有連結，**整行只有頭像帶 uid**
// 所以名字上什麼都解析不出來。這裡從命中元素往上找**最多 4 層**，
// 找一個「正好含一個頭像」的容器，用那個頭像的 uid。
//
// ★★ 故意**只在 `/chat` 上生效**。同樣的形狀在討論區、文章列表裡到處都是
//    （頭像 + 標題 + 作者），在那些地方按行備援會讓「懸停標題彈出作者卡」，
//    那是誤彈 —— owner 這幾輪反覆在清的正是誤彈。要擴大範圍得先有各頁的證據。
const CHAT_ROW_DEPTH = 4;
const chatRowUid = (node, pathname) => {
  if (pathname !== "/chat") return null;
  let cursor = node;
  for (let step = 0; cursor && step < CHAT_ROW_DEPTH; step += 1) {
    const avatars = cursor.querySelectorAll
      ? cursor.querySelectorAll('img[src*="/upload/usericon/"]')
      : [];
    if (avatars.length === 1) {
      const uid = Number((avatars[0].getAttribute("src") || "").match(AVATAR_UID)?.[1]);
      if (Number.isSafeInteger(uid) && uid > 0)
        return Object.freeze({ kind: "user", key: `user:${uid}`, uid, anchor: cursor });
    }
    if (avatars.length > 1) return null;
    cursor = cursor.parentElement;
  }
  return null;
};

export function resolveHoverTarget(node, identity, subject, pathname) {
  // 站台框架（頂欄 / 兩側抽屜）整塊不參與，連解析都不必做。
  if (inSiteChrome(node)) return null;
  // 使用者優先：討論區裡使用者名連結常常也落在含題號的行內，先判使用者不會誤判。
  const target =
    resolveUserAnchor(node) ||
    resolveProblemAnchor(node, identity) ||
    chatRowUid(node, pathname);
  if (!target || !subject || subject.kind !== target.kind) return target;
  if (target.kind === "user") return target.uid === subject.uid ? null : target;
  return target.pid === subject.pid ? null : target;
}

// 當前登入 uid。columba 頁在 `lentille-context`，舊版頁在 `window._feInjection.currentUser`。
// 拿不到就是匿名 —— 匿名不請求提交記錄，也不顯示關注按鈕。
export function readViewerUid(doc, globalScope) {
  try {
    const node = doc && doc.getElementById && doc.getElementById("lentille-context");
    if (node) {
      const ctx = JSON.parse(node.textContent || "null");
      const uid = Number(ctx && ctx.user && ctx.user.uid);
      if (Number.isSafeInteger(uid) && uid > 0) return uid;
    }
  } catch (error) {
    /* 形狀漂移就當匿名 */
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
