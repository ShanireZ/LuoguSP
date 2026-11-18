import { IntroTokenizer, tokenizeDisplayMath } from "./intro-tokenizer.js";
import { IMAGE_UNAVAILABLE, resolveIntroHttpUrl } from "./intro-image.js";
import { renderMarkdownLite } from "./markdown-lite.js";
import { createMarkerPrefix } from "./marker-prefix.js";

const AUTHOR_MARKUP = {
  ALLOWED_TAGS: [
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "dd", "del",
    "details", "div", "dl", "dt", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "i", "input", "ins", "kbd", "li", "mark", "ol", "p", "pre",
    "s", "samp", "small", "span", "strong", "sub", "summary", "sup", "table",
    "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
  ],
  ALLOWED_ATTR: [
    "align", "checked", "class", "colspan", "disabled", "href", "open",
    "rowspan", "start", "title", "type",
  ],
  ADD_ATTR: (name, tag) => tag === "li" && name === "value",
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

function replaceImages(content, document) {
  // The template is inert. Even a same-origin image can redirect elsewhere,
  // so no author image source is copied into a fetch-capable element.
  const lastLinkByAnchor = new Map();
  for (const image of content.querySelectorAll("img")) {
    const alt = image.getAttribute("alt")?.trim();
    const href = resolveIntroHttpUrl(image.getAttribute("src"), document.baseURI);
    if (!href) {
      const fallback = document.createElement("span");
      fallback.textContent = alt || IMAGE_UNAVAILABLE;
      image.replaceWith(fallback);
      continue;
    }
    const link = document.createElement("a");
    link.setAttribute("href", href);
    const title = image.getAttribute("title");
    if (title) link.setAttribute("title", title);
    link.textContent = alt || "打开图片";
    const enclosing = image.closest("a");
    if (enclosing) {
      // Retain a linked image's original destination without nesting links.
      image.replaceWith(document.createTextNode(alt || "图片"));
      if (alt) link.textContent = `打开图片：${alt}`;
      const after = lastLinkByAnchor.get(enclosing) || enclosing;
      after.after(document.createTextNode(" "), link);
      lastLinkByAnchor.set(enclosing, link);
    } else image.replaceWith(link);
  }
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
    replaceImages(template.content, document);
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
      const mathPrefix = createMarkerPrefix("%%LGMATH");
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
          tokenizer: new IntroTokenizer(),
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
            document,
            renderMath: hold,
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
