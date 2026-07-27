import { createCodeHighlighter } from "./code-highlight.js";
import { createMarkdownFullRenderer } from "./markdown-full.js";
import {
  MARKDOWN_RENDERER_API_VERSION,
  rendererDependencyVersions,
} from "./renderer-dependencies.js";

export const apiVersion = MARKDOWN_RENDERER_API_VERSION;
export const dependencyVersions = rendererDependencyVersions;

export function createMarkdownRenderer(dependencies) {
  const fullRenderer = createMarkdownFullRenderer(dependencies);
  const codeHighlighter = createCodeHighlighter({
    highlighter: dependencies?.highlighter,
  });
  return Object.freeze({
    renderMarkdown(source, options) {
      return fullRenderer.renderMarkdown(source, options);
    },
    enhanceCodeBlocks(root, options) {
      return codeHighlighter.enhanceCodeBlocks(root, options);
    },
  });
}
