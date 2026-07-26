import { defineConfigurableFeature } from "../../app/feature-descriptor.js";

export function createChatShortcutFeature({ storage }) {
  const SELECTORS = {
    chatTrigger: '[slot="trigger"]',
  };

  function addMessageLink() {
    const bound = new WeakSet(); // 去重，避免重复绑定
    const uidCache = new Map(); // username -> uid 缓存
    const cleanups = [];
    const controllers = new Set();
    let active = true;

    const openUser = (uid) => {
      if (uid) window.open(`/user/${uid}`, "_blank");
    };
    // 已在用户链接里的元素，浏览器原生 Ctrl+Click 即可新标签打开，跳过避免重复触发。
    const inUserLink = (el) =>
      el.closest('a[href*="/user/"], a[href*="/space/"]');

    async function getUidByName(username) {
      if (uidCache.has(username)) return uidCache.get(username);
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const res = await fetch(
          `/api/user/search?keyword=${encodeURIComponent(username)}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        const uid = data && data.users && data.users[0] && data.users[0].uid;
        if (active && !controller.signal.aborted) uidCache.set(username, uid);
        return uid;
      } catch (e) {
        if (!controller.signal.aborted) console.error("LuoguSP getUid:", e);
      } finally {
        controllers.delete(controller);
      }
    }
    // 用户名触发点：Ctrl+Click → 按用户名查 uid
    function bindName(trigger) {
      if (bound.has(trigger) || inUserLink(trigger)) return;
      bound.add(trigger);
      const onClick = async (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation(); // Ctrl 时才拦，普通点击不影响洛谷原有行为
        const name = (trigger.textContent || "").trim();
        const uid = name && (await getUidByName(name));
        if (active && uid) openUser(uid);
      };
      trigger.addEventListener("click", onClick);
      cleanups.push(() => trigger.removeEventListener("click", onClick));
    }
    // 头像：Ctrl+Click → 直接从 src（usericon/{uid}）取 uid，无需查接口
    const AVATAR_RE = /\/usericon\/(\d+)/;
    function bindAvatar(img) {
      if (bound.has(img) || inUserLink(img) || !AVATAR_RE.test(img.src || ""))
        return;
      bound.add(img);
      const oldCursor = img.style.cursor;
      img.style.cursor = "pointer";
      const onClick = (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        const m = (img.src || "").match(AVATAR_RE); // 点击时再读，兼容虚拟滚动换头像
        if (m) openUser(m[1]);
      };
      img.addEventListener("click", onClick);
      cleanups.push(() => {
        img.removeEventListener("click", onClick);
        img.style.cursor = oldCursor;
      });
    }
    const scan = (root) => {
      if (!root.querySelectorAll) return;
      root.querySelectorAll(SELECTORS.chatTrigger).forEach(bindName);
      root.querySelectorAll("img").forEach(bindAvatar);
    };
    scan(document);
    const observer = new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes)
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (n.matches && n.matches(SELECTORS.chatTrigger)) bindName(n);
            if (n.matches && n.matches("img")) bindAvatar(n);
            scan(n);
          }
    });
    observer.observe(document, { childList: true, subtree: true });
    return () => {
      active = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      observer.disconnect();
      for (const cleanup of cleanups) cleanup();
    };
  }

  return defineConfigurableFeature({
    id: "chat-shortcut",
    key: "addMessageLink",
    label: "私信 Ctrl+Click 打开用户个人页",
    storage,
    mount: (context) => {
      if (!location.pathname.startsWith("/chat")) return;
      let disposeChat = null;
      const timer = setTimeout(() => {
        if (!context.isCurrent()) return;
        try {
          disposeChat = addMessageLink();
        } catch (error) {
          console.error("LuoguSP lifecycle chat-shortcut:", error);
        }
      }, 500);
      return () => {
        clearTimeout(timer);
        if (disposeChat) disposeChat();
      };
    },
  });
}
