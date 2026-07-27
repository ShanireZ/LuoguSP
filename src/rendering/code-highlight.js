const languageAliases = Object.freeze({
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  css: "css",
  go: "go",
  html: "xml",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  plaintext: "plaintext",
  python: "python",
  py: "python",
  rust: "rust",
  sh: "bash",
  shell: "bash",
  text: "plaintext",
  ts: "typescript",
  typescript: "typescript",
  xml: "xml",
});

function languageFromCodeElement(code) {
  const className = [...code.classList].find((value) =>
    value.startsWith("language-"),
  );
  if (!className) return null;
  const language =
    languageAliases[className.slice("language-".length).toLowerCase()] || null;
  return language ? { className, language } : null;
}

export function createCodeHighlighter({ highlighter } = {}) {
  if (
    typeof highlighter?.getLanguage !== "function" ||
    typeof highlighter?.highlightElement !== "function"
  )
    throw new TypeError("Invalid Highlight.js instance");

  return Object.freeze({
    enhanceCodeBlocks(root) {
      if (typeof root?.querySelectorAll !== "function") return;
      for (const code of root.querySelectorAll("pre code")) {
        const resolvedLanguage = languageFromCodeElement(code);
        if (
          !resolvedLanguage ||
          !highlighter.getLanguage(resolvedLanguage.language)
        )
          continue;
        const normalizedClass = `language-${resolvedLanguage.language}`;
        if (resolvedLanguage.className !== normalizedClass)
          code.classList.remove(resolvedLanguage.className);
        code.classList.add(normalizedClass);
        code.closest("pre")?.classList.add(normalizedClass);
        if (code.dataset.luoguspHighlighted === "true") continue;
        try {
          highlighter.highlightElement(code);
          code.dataset.luoguspHighlighted = "true";
        } catch {}
      }
    },
  });
}
