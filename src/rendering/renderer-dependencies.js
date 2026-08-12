export const MARKDOWN_RENDERER_API_VERSION = 1;

export const rendererStackDependencies = Object.freeze({
  katex: "0.18.1",
  marked: "18.0.7",
  dompurify: "3.4.13",
  "highlight.js": "11.11.1",
});

export const rendererDependencyVersions = Object.freeze({
  katex: rendererStackDependencies.katex,
  marked: rendererStackDependencies.marked,
  dompurify: rendererStackDependencies.dompurify,
  highlight: rendererStackDependencies["highlight.js"],
});
