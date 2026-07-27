import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  createFallbackIntroController,
} from "../src/features/hidden-intro/fallback-intro-controller.js";

async function waitFor(predicate, message) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test("fallback controller shows safe retry UI and recovers without raw HTML", async () => {
  const dom = new JSDOM(
    '<!doctype html><body><div class="sidebar-container"><div class="main"></div></div></body>',
  );
  const states = [];
  let renders = 0;
  const controller = createFallbackIntroController({
    document: dom.window.document,
    fetchImpl: async () => new Response("{}"),
    diagnostics: { set: (...args) => states.push(args) },
    makeCopyButtonImpl: () => dom.window.document.createElement("button"),
    rendererClient: {
      async renderInto(root) {
        renders++;
        if (renders === 1)
          throw Object.assign(new Error("offline"), {
            kind: "cdn-unavailable",
          });
        root.innerHTML =
          '<pre><code class="language-cpp">int main(){}</code></pre>';
        return { mode: "lite", warnings: ["full-render-failed"] };
      },
    },
  });
  const column = dom.window.document.querySelector(".main");
  const mounted = controller.mount({
    column,
    introduction: '<img src=x onerror="globalThis.pwned=true">',
  });
  await mounted.ready;

  assert.equal(
    mounted.card.textContent.includes("个人介绍渲染组件暂不可用。"),
    true,
  );
  assert.equal(mounted.card.innerHTML.includes("onerror"), false);
  assert.deepEqual(states.at(-1), [
    "fallback-unavailable",
    "cdn-unavailable",
  ]);

  mounted.card.querySelector(".luogusp-intro-retry").click();
  await waitFor(
    () => states.at(-1)?.[0] === "fallback-lite",
    "retry did not render",
  );
  assert.equal(renders, 2);
  assert.equal(
    mounted.card.querySelectorAll(".code-container").length,
    1,
  );
  assert.deepEqual(states.at(-1), [
    "fallback-lite",
    "full-render-failed",
  ]);
});

test("fallback controller removes a pending card when navigation aborts", () => {
  const dom = new JSDOM(
    '<!doctype html><body><div class="main"></div></body>',
  );
  const abortController = new dom.window.AbortController();
  const controller = createFallbackIntroController({
    document: dom.window.document,
    fetchImpl: async () => new Response("{}"),
    rendererClient: {
      renderInto: () => new Promise(() => {}),
    },
  });
  controller.mount({
    column: dom.window.document.querySelector(".main"),
    introduction: "pending",
    signal: abortController.signal,
  });
  assert.equal(controller.hasCard(), true);

  abortController.abort();

  assert.equal(controller.hasCard(), false);
});
