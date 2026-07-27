import createDOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import katex from "katex";
import { marked } from "marked";
import {
  apiVersion,
  createMarkdownRenderer,
  dependencyVersions,
} from "./markdown-renderer-api.js";

const browserWindow = globalThis.window;
if (!browserWindow?.document)
  throw new Error("Markdown renderer requires a browser document");

for (const [name, language] of [
  ["plaintext", plaintext],
  ["c", c],
  ["cpp", cpp],
  ["python", python],
  ["javascript", javascript],
  ["typescript", typescript],
  ["java", java],
  ["bash", bash],
  ["json", json],
  ["css", css],
  ["xml", xml],
  ["go", go],
  ["rust", rust],
])
  hljs.registerLanguage(name, language);

const renderer = createMarkdownRenderer({
  marked,
  sanitizer: createDOMPurify(browserWindow),
  katex,
  document: browserWindow.document,
  highlighter: hljs,
});

export { apiVersion, dependencyVersions };

export function renderMarkdown(source, options) {
  return renderer.renderMarkdown(source, options);
}

export function enhanceCodeBlocks(root, options) {
  return renderer.enhanceCodeBlocks(root, options);
}
