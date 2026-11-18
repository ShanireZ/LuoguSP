import { makeCopyControls } from "../../browser/copy-button.js";
import { createRendererClient } from "./renderer-client.js";

function digIntroduction(object, wantedUid) {
  let result = null;
  (function walk(value, depth) {
    if (result || !value || typeof value !== "object" || depth > 6) return;
    if (
      String(value.uid) === String(wantedUid) &&
      typeof value.introduction === "string"
    ) {
      result = value.introduction;
      return;
    }
    for (const nested of Object.values(value))
      if (nested && typeof nested === "object") walk(nested, depth + 1);
  })(object, 0);
  return result;
}

function normalizeCodeLanguageClass(code) {
  const language = [...code.classList].find((name) =>
    name.startsWith("language-"),
  );
  const pre = code.closest("pre");
  if (language && pre) pre.classList.add(language);
}

export function createFallbackIntroController(options = {}) {
  const {
    document = globalThis.document,
    fetchImpl = globalThis.fetch,
    diagnostics,
    rendererClient = createRendererClient(options.rendererConfig || {}),
    makeCopyButtonImpl = makeCopyControls,
  } = options;
  if (!document?.createElement || typeof fetchImpl !== "function")
    throw new TypeError("Fallback intro controller requires browser APIs");

  const cards = () => [
    ...document.querySelectorAll(".luogusp-intro-card"),
  ];
  const removeCards = () => cards().forEach((card) => card.remove());

  async function getIntroduction(uid, signal) {
    for (const script of document.querySelectorAll("script")) {
      const text = (script.textContent || "").trim();
      if (text[0] !== "{" || !text.includes('"introduction"')) continue;
      try {
        const introduction = digIntroduction(JSON.parse(text), uid);
        if (introduction != null) return introduction;
      } catch (error) {
        // Non-JSON scripts are not Lentille state.
      }
    }
    try {
      const expectedUrl = new URL(`/user/${uid}`, document.URL).href;
      const response = await fetchImpl(expectedUrl, {
        headers: { "x-lentille-request": "content-only" },
        mode: "same-origin", credentials: "same-origin", redirect: "error",
        signal,
      });
      if (response.status !== 200 || response.redirected !== false || response.url !== expectedUrl ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers?.get("content-type")?.trim())) return null;
      const introduction = digIntroduction(await response.json(), uid);
      if (introduction != null) return introduction;
    } catch (error) {
      if (!signal?.aborted)
        console.error("LuoguSP intro fetch:", error);
    }
    return null;
  }

  function createCard() {
    const nativeCard = document.querySelector(".l-card");
    const card = nativeCard
      ? nativeCard.cloneNode(false)
      : document.createElement("div");
    card.className = "l-card luogusp-intro-card luogusp-mdstyle";
    card.removeAttribute("id");
    card.removeAttribute("style");
    card.style.setProperty("--l-card--padding", "20.8px");

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("h3");
    title.textContent = "个人介绍";
    title.style.margin = "0px";
    header.appendChild(title);

    const body = document.createElement("div");
    body.className = "lfe-marked-wrap introduction";
    body.style.cssText =
      "overflow-wrap:break-word;word-break:break-word;";
    const content = document.createElement("div");
    content.className = "lfe-marked";
    body.appendChild(content);
    card.append(header, body);
    title.tabIndex = -1;
    return { card, content, title, body };
  }

  function enhanceCopyButtons(root) {
    root.querySelectorAll("pre code").forEach(normalizeCodeLanguageClass);
    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.closest(".code-container")) return;
      const code = pre.querySelector("code");
      if (!code) return;
      const box = document.createElement("div");
      box.className = "code-container";
      pre.parentNode.insertBefore(box, pre);
      box.append(pre, makeCopyButtonImpl(code));
    });
  }

  function mount({ column, introduction, signal, isCurrent = () => true }) {
    if (!column || typeof introduction !== "string")
      throw new TypeError("Fallback intro mount request is invalid");
    const { card, content, title, body } = createCard();
    const announcement = document.createElement("span");
    announcement.className = "luogusp-intro-status";
    announcement.setAttribute("role", "status");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "luogusp-intro-retry";
    retry.textContent = "重试渲染";
    retry.hidden = true;
    body.append(announcement, retry);
    let rendering = false;
    column.appendChild(card);
    const removeIfOwned = () => {
      if (card.isConnected) card.remove();
    };
    if (signal)
      signal.addEventListener("abort", removeIfOwned, { once: true });

    const render = async () => {
      if (rendering) return;
      rendering = true;
      content.setAttribute("aria-busy", "true");
      retry.setAttribute("aria-disabled", "true");
      announcement.textContent = "正在加载个人介绍…";
      content.textContent = "正在加载个人介绍渲染组件…";
      try {
        const result = await rendererClient.renderInto(
          content,
          introduction,
          { signal },
        );
        if (signal?.aborted || !isCurrent()) {
          removeIfOwned();
          return Object.freeze({ status: "cancelled" });
        }
        enhanceCopyButtons(content);
        if (document.activeElement === retry) title.focus({ preventScroll: true });
        retry.hidden = true;
        announcement.textContent = "个人介绍已加载。";
        const status =
          result.mode === "lite" ? "fallback-lite" : "fallback-rendered";
        diagnostics?.set(status, result.warnings.join(",") || null);
        return Object.freeze({ status, mode: result.mode });
      } catch (error) {
        if (signal?.aborted || error?.kind === "cancelled" || !isCurrent()) {
          removeIfOwned();
          return Object.freeze({ status: "cancelled" });
        }
        content.replaceChildren();
        const message = document.createElement("p");
        message.textContent = "个人介绍渲染组件暂不可用。";
        content.append(message);
        retry.hidden = false;
        announcement.textContent = "个人介绍加载失败，可重试。";
        diagnostics?.set(
          "fallback-unavailable",
          error?.kind || error?.message || "renderer-unavailable",
        );
        return Object.freeze({
          status: "fallback-unavailable",
          error,
        });
      } finally {
        rendering = false;
        content.setAttribute("aria-busy", "false");
        retry.setAttribute("aria-disabled", "false");
      }
    };
    retry.addEventListener("click", () => {
      render().catch((error) => console.error("LuoguSP intro retry:", error));
    });

    return Object.freeze({
      card,
      ready: render(),
      dispose() {
        if (signal)
          signal.removeEventListener("abort", removeIfOwned);
        removeIfOwned();
      },
    });
  }

  return Object.freeze({
    getIntroduction,
    mount,
    removeCards,
    hasCard: () => cards().length > 0,
  });
}
