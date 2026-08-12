import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import plaintext from "highlight.js/lib/languages/plaintext";
import katex from "katex";
import { marked } from "marked";
import {
  apiVersion,
  createMarkdownRenderer,
  dependencyVersions,
} from "../src/rendering/markdown-renderer-api.js";

function createRenderer() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const highlighter = hljs.newInstance();
  highlighter.registerLanguage("cpp", cpp);
  highlighter.registerLanguage("plaintext", plaintext);
  return {
    dom,
    renderer: createMarkdownRenderer({
      marked,
      sanitizer: createDOMPurify(dom.window),
      katex,
      document: dom.window.document,
      highlighter,
    }),
  };
}

test("markdown renderer exposes the versioned data-only API", () => {
  const { renderer } = createRenderer();
  const result = renderer.renderMarkdown("**safe**");

  assert.equal(apiVersion, 1);
  assert.deepEqual(dependencyVersions, {
    katex: "0.18.1",
    marked: "18.0.7",
    dompurify: "3.4.13",
    highlight: "11.11.1",
  });
  assert.deepEqual(result, {
    html: "<p><strong>safe</strong></p>\n",
    mode: "full",
    warnings: [],
  });
});

test("markdown renderer highlights only explicitly registered languages", () => {
  const { dom, renderer } = createRenderer();
  const root = dom.window.document.createElement("div");
  root.innerHTML =
    '<pre><code class="language-c++">int main() { return 0; }</code></pre><pre><code class="language-unknown">plain text</code></pre>';

  renderer.enhanceCodeBlocks(root);

  const [cppCode, unknownCode] = root.querySelectorAll("pre code");
  assert.equal(cppCode.classList.contains("language-cpp"), true);
  assert.equal(cppCode.classList.contains("hljs"), true);
  assert.equal(cppCode.dataset.luoguspHighlighted, "true");
  assert.equal(unknownCode.dataset.luoguspHighlighted, undefined);
  assert.equal(unknownCode.textContent, "plain text");
});
