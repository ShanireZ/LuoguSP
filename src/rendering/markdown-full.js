import { renderMarkdownLite } from "./markdown-lite.js";

const AUTHOR_MARKUP = {
  ALLOWED_TAGS: [
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "dd", "del",
    "details", "div", "dl", "dt", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "i", "img", "input", "ins", "kbd", "li", "mark", "ol", "p", "pre",
    "s", "samp", "small", "span", "strong", "sub", "summary", "sup", "table",
    "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
  ],
  ALLOWED_ATTR: [
    "align", "alt", "checked", "class", "colspan", "disabled", "href", "open",
    "rowspan", "src", "start", "title", "type",
  ],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
};

const MAX_MATH_FORMULAS = 64;
const MAX_MATH_LENGTH = 4096;
const MAX_MATH_SIZE_EM = 64;

function tokenizeInlineMath(source) {
  if (this.lexer.state.inRawBlock || !source.startsWith("$")) return;
  const displayMode = source.startsWith("$$");
  const match = displayMode
    ? /^\$\$((?:\\[\s\S]|[^\\$]|\$(?!\$))+?)\$\$/.exec(source)
    : /^\$((?:\\[^\n]|[^\\\n$])+?)\$(?!\$)/.exec(source);
  if (match)
    return { type: "math", raw: match[0], text: match[1], displayMode };
}

function tokenizeDisplayMath(source) {
  const match = /^ {0,3}\$\$[ \t]*\n((?:(?! {0,3}(?:```|~~~))[^\n]*\n)*?) {0,3}\$\$[ \t]*(?:\n|$)/.exec(source);
  if (match)
    return { type: "math", raw: match[0], text: match[1], displayMode: true };
}

function escapeHtml(source) {
  return source.replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );
}

function validateDependencies({ marked, sanitizer, katex, document }) {
  if (
    typeof marked?.parse !== "function" ||
    typeof sanitizer?.sanitize !== "function" ||
    typeof katex?.renderToString !== "function" ||
    typeof document?.createElement !== "function"
  )
    throw new TypeError("Invalid markdown renderer dependencies");
}

export function createMarkdownFullRenderer(dependencies) {
  const { marked, sanitizer, katex, document } = dependencies || {};
  validateDependencies({ marked, sanitizer, katex, document });

  const renderMath = (formula, displayMode) => {
    try {
      return sanitizer.sanitize(
        katex.renderToString(formula, {
          throwOnError: false,
          displayMode,
          maxSize: MAX_MATH_SIZE_EM,
          maxExpand: 1000,
          trust: false,
        }),
        { FORBID_TAGS: ["style"] },
      );
    } catch (error) {
      return null;
    }
  };
  const renderSafeHtml = (html, marker, math) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    // Put literal math delimiters back into attributes before checking URLs.
    for (const node of template.content.querySelectorAll("*")) {
      for (const attr of node.attributes) {
        const literal = attr.value.replace(marker, (match, index) => math[index]?.raw ?? match);
        if (literal !== attr.value) attr.value = literal;
      }
    }
    template.innerHTML = sanitizer.sanitize(template.innerHTML, AUTHOR_MARKUP);
    for (const node of template.content.querySelectorAll("[class]")) {
      const language = node.matches("pre > code") &&
        [...node.classList].find((name) => /^language-[\w+-]+$/.test(name));
      if (language) node.className = language;
      else node.removeAttribute("class");
    }
    for (const input of template.content.querySelectorAll("input")) {
      if (input.type === "checkbox") input.disabled = true;
      else input.remove();
    }
    for (const link of template.content.querySelectorAll("a[href]")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
    for (const image of template.content.querySelectorAll("img"))
      image.style.maxWidth = "100%";

    // KaTeX styles belong to generated formula fragments. Only text nodes
    // can receive those fragments, after author markup has been sanitized.
    const walker = document.createTreeWalker(template.content, 4); // SHOW_TEXT
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    let remaining = MAX_MATH_FORMULAS;
    for (const node of textNodes) {
      const source = node.data;
      const matches = [...source.matchAll(marker)];
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      const literal = node.parentElement?.closest("pre, code, kbd, samp");
      let offset = 0;
      for (const [match, index] of matches) {
        const start = source.indexOf(match, offset);
        fragment.append(document.createTextNode(source.slice(offset, start)));
        const formula = math[index];
        const renderable = formula && !literal && remaining > 0 &&
          formula.text.length <= MAX_MATH_LENGTH;
        const rendered = renderable && renderMath(formula.text, formula.displayMode);
        if (renderable) remaining--;
        if (rendered) {
          const element = document.createElement("template");
          element.innerHTML = rendered;
          fragment.append(element.content);
        } else fragment.append(document.createTextNode(formula?.raw ?? match));
        offset = start + match.length;
      }
      fragment.append(document.createTextNode(source.slice(offset)));
      node.replaceWith(fragment);
    }
    return template.innerHTML;
  };

  return Object.freeze({
    renderMarkdown(source, options = {}) {
      const markdown = String(source ?? "");
      const math = [];
      let mathPrefix = "%%LGMATH";
      while (markdown.includes(mathPrefix)) mathPrefix += "X";
      const marker = new RegExp(`${mathPrefix}(\\d+)%%`, "g");
      const hold = (raw, text, displayMode) =>
        `${mathPrefix}${math.push({ raw, text: displayMode ? text.trim() : text, displayMode }) - 1}%%`;

      try {
        if (options.forceFullFailure === true)
          throw new Error("Full renderer failure was requested");
        const parsed = marked.parse(markdown, {
          async: false,
          gfm: true,
          breaks: true,
          extensions: {
            block: [tokenizeDisplayMath],
            inline: [tokenizeInlineMath],
            startInline: [(source) => source.indexOf("$")],
            renderers: {
              math: ({ raw, text, displayMode }) => hold(raw, text, displayMode),
            },
          },
        });
        if (typeof parsed !== "string")
          throw new TypeError("Marked returned a non-string result");
        const html = renderSafeHtml(parsed, marker, math);
        return { html, mode: "full", warnings: [] };
      } catch (error) {
        math.length = 0;
        try {
          const lite = renderMarkdownLite(markdown, {
            katex: { renderToString(text, { displayMode }) {
              const delimiter = displayMode ? "$$" : "$";
              return hold(delimiter + text + delimiter, text, displayMode);
            } },
          });
          return { html: renderSafeHtml(lite, marker, math), mode: "lite", warnings: ["full-render-failed"] };
        } catch (error) {
          return {
            html: `<p>${escapeHtml(markdown)}</p>`,
            mode: "lite",
            warnings: ["full-render-failed", "lite-render-failed"],
          };
        }
      }
    },
  });
}
