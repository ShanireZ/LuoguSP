import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";
import { createMarkdownFullRenderer } from "../src/rendering/markdown-full.js";

function createRenderer(markedApi = marked) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://www.luogu.com.cn/",
    runScripts: "dangerously",
  });
  return {
    dom,
    renderer: createMarkdownFullRenderer({
      marked: markedApi,
      sanitizer: createDOMPurify(dom.window),
      katex,
      document: dom.window.document,
    }),
  };
}

test("full markdown renderer parses GFM, KaTeX, links, and images", () => {
  const { dom, renderer } = createRenderer();
  const result = renderer.renderMarkdown(
    "# Heading\n\n- [x] done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$\\frac{1}{2}$\n\n[link](https://example.test)\n\n![image](https://example.test/image.png)",
  );

  assert.equal(result.mode, "full");
  assert.deepEqual(result.warnings, []);
  const root = dom.window.document.createElement("div");
  root.innerHTML = result.html;
  assert.equal(root.querySelector("h1")?.textContent, "Heading");
  assert.equal(root.querySelector("input[type=checkbox]")?.checked, true);
  assert.equal(root.querySelectorAll("table tbody td").length, 2);
  assert.equal(root.querySelector(".katex") !== null, true);
  const link = root.querySelector("a");
  assert.equal(link?.target, "_blank");
  assert.equal(link?.rel, "noopener noreferrer");
  assert.equal(root.querySelector("img")?.style.maxWidth, "100%");
});

test("full markdown renderer removes executable HTML while retaining safe text", () => {
  const { dom, renderer } = createRenderer();
  const result = renderer.renderMarkdown(
    'safe <strong>text</strong>\n\n<script>window.__xss = true</script>\n\n<img src=x onerror="window.__xss = true">\n\n<a href="javascript:window.__xss = true">bad</a>\n\n<svg><g onload="window.__xss = true"></g></svg>\n\n<form id="attributes"><input name="action"></form>',
  );

  assert.equal(result.mode, "full");
  const root = dom.window.document.createElement("div");
  root.innerHTML = result.html;
  assert.equal(dom.window.__xss, undefined);
  assert.equal(root.querySelector("script"), null);
  assert.equal(root.querySelector("[onerror], [onload]"), null);
  assert.equal(root.querySelector('a[href^="javascript:"]'), null);
  assert.equal(root.textContent.includes("safe text"), true);
});

test("full markdown renderer falls back to MarkdownLite when Marked fails", () => {
  const { renderer } = createRenderer({
    parse() {
      throw new Error("synthetic failure");
    },
  });
  const result = renderer.renderMarkdown("# Lite heading\n\n**safe**");

  assert.equal(result.mode, "lite");
  assert.deepEqual(result.warnings, ["full-render-failed"]);
  assert.equal(
    result.html,
    "<p></p><h1>Lite heading</h1><p><strong>safe</strong></p>",
  );
});

test("full markdown renderer exposes a deterministic QA failure injection", () => {
  const { renderer } = createRenderer();
  const result = renderer.renderMarkdown("# Lite heading", {
    forceFullFailure: true,
  });

  assert.equal(result.mode, "lite");
  assert.deepEqual(result.warnings, ["full-render-failed"]);
  assert.equal(
    result.html,
    "<p></p><h1>Lite heading</h1><p></p>",
  );
});
