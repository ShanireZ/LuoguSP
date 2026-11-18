import { Lexer } from "marked";
import { IMAGE_UNAVAILABLE, resolveIntroImageUrl } from "./intro-image.js";
import { createMarkerPrefix } from "./marker-prefix.js";

export function renderMarkdownLite(md, options = {}) {
  const { document } = options;
  const esc = (source) =>
    source.replace(
      /[&<>"]/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
    );
  const url = (value) =>
    /^(https?:)?\/\//i.test(value) || /^\//.test(value) ? value : "";
  const codeLanguageClass = (raw) => {
    const language = (raw || "").trim().split(/\s+/)[0].toLowerCase();
    return /^[a-z0-9_+-]+$/.test(language)
      ? ` class="language-${esc(language)}"`
      : "";
  };
  const katexRenderer = options.katex || null;
  const renderTex = (formula, displayMode) => {
    if (!katexRenderer) return null;
    try {
      return katexRenderer.renderToString(formula, {
        throwOnError: false,
        displayMode,
      });
    } catch (error) {
      return null;
    }
  };
  const spans = [];
  const spanPrefix = createMarkerPrefix("@@LGB");
  const stash = (html) => `${spanPrefix}${spans.push(html) - 1}@@`;
  const spanMarker = new RegExp(`${spanPrefix}(\\d+)@@`, "g");
  const restore = (source) => source.replace(spanMarker, (_, index) => spans[index]);
  const getAttribute = (tag, pattern) => (tag.match(pattern) || [])[1] || "";
  const titleAttribute = (title) => title ? ` title="${esc(title)}"` : "";
  // The renderer inserts this intermediate markup only into an inert template.
  const imageMarkup = (source, alt, title) => {
    const href = resolveIntroImageUrl(source, document.baseURI);
    return href
      ? `<img src="${esc(href)}" alt="${esc(alt)}"${title}>`
      : `<span>${esc(alt.trim() || IMAGE_UNAVAILABLE)}</span>`;
  };
  const inline = (source) =>
    source
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const mathInText = (source) => source
    .replace(/(?<!\\)\$\$((?:\\[\s\S]|[^\\$]|\$(?!\$))+?)\$\$|(?<![\\$])\$((?:\\[^\n]|[^\\\n$])+?)\$(?!\$)/g,
      (match, display, formula) => {
        const html = renderTex(display?.trim() ?? formula, display !== undefined);
        return html ? stash(html) : match;
      })
    .replace(/\\\$/g, "$");
  // Stashed code and attributes end a text context before math is scanned.
  const mathInFragments = (source) => source
    .split(new RegExp(`(${spanPrefix}\\d+@@)`))
    .map((part, index) => index % 2 ? part : mathInText(part))
    .join("");
  const stashCode = (code) => stash(`<code>${esc(code)}</code>`);
  const rewriteInlineTokens = (tokens) => tokens.map((token) => {
    if (token.type === "codespan") return stashCode(token.text);
    if (token.type === "image") return stash(imageMarkup(token.href, token.text, titleAttribute(token.title)));
    if (token.type === "link" && token.raw.startsWith("[")) {
      const safeUrl = url(token.href);
      if (!safeUrl) return stash(esc(token.raw));
      const label = rewriteInlineTokens(token.tokens);
      const text = restore(inline(esc(mathInFragments(label))));
      return stash(`<a href="${esc(safeUrl)}"${titleAttribute(token.title)} target="_blank" rel="noopener noreferrer">${text}</a>`);
    }
    if (["strong", "em", "del"].includes(token.type)) {
      // Preserve the delimiters for Lite's formatting pass.
      const width = (token.raw.length - token.text.length) / 2;
      return token.raw.slice(0, width) + rewriteInlineTokens(token.tokens) + token.raw.slice(-width);
    }
    return token.raw;
  }).join("");
  const inlineLiterals = (source) => {
    if (!source.includes("[") && !source.includes("`")) return source;
    // Reuse inline grammar only. The lightweight block renderer and sanitization
    // still work separately from the full parser and its extensions.
    try {
      return rewriteInlineTokens(Lexer.lexInline(source, { gfm: false }));
    } catch {
      return source.replace(/`([^`]+)`/g, (_, code) => stashCode(code));
    }
  };
  const cells = (row) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  const table = (lines) =>
    `<table><thead><tr>${cells(lines[0])
      .map((cell) => `<th>${inline(cell)}</th>`)
      .join("")}</tr></thead><tbody>${lines
      .slice(2)
      .map(
        (line) =>
          `<tr>${cells(line)
            .map((cell) => `<td>${inline(cell)}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>`;
  const safeInlineTag =
    /^(b|strong|i|em|u|s|del|ins|mark|sub|sup|br|hr|code|kbd|small)$/i;
  let source = md
    .replace(/\r\n?/g, "\n")
    .replace(/^ {0,3}((`|~)\2{2,})([^\n]*)\n([\s\S]*?)(?:^ {0,3}\1\2*[ \t]*(?=\n|$)|(?![\s\S]))/gm,
      (_, _fence, _delimiter, rawLanguage, code) => {
        const className = codeLanguageClass(rawLanguage);
        return stash(
          `<pre${className}><code${className}>${esc(code.replace(/\n$/, ""))}</code></pre>`,
        );
      })
    .replace(/<img(?=[\s/>])(?:"[^"]*"|'[^']*'|[^"'<>])*>/gi, (tag) => {
      const template = document.createElement("template");
      template.innerHTML = tag;
      const image = template.content.firstElementChild;
      return image ? stash(imageMarkup(
        image.getAttribute("src"),
        image.getAttribute("alt") || "",
        titleAttribute(image.getAttribute("title")),
      )) : "";
    })
    .replace(/<a\b[^>]*>/gi, (tag) => {
      const safeUrl = url(getAttribute(tag, /\bhref\s*=\s*["']?([^"'\s>]+)/i));
      const title = titleAttribute(getAttribute(tag, /\btitle\s*=\s*["']([^"']*)["']/i));
      return stash(
        safeUrl
          ? `<a href="${esc(safeUrl)}"${title} target="_blank" rel="noopener noreferrer">`
          : "<span>",
      );
    })
    .replace(/<\/a>/gi, () => stash("</a>"))
    .replace(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, slash, name) =>
      safeInlineTag.test(name) ? stash(`<${slash}${name.toLowerCase()}>`) : tag,
    );
  source = mathInFragments(inlineLiterals(source));
  source = esc(source)
    .replace(/^([^\n]+)\n=+[ \t]*$/gm, "# $1")
    .replace(/^([^\n]+)\n-{2,}[ \t]*$/gm, "## $1")
    .replace(/^(#{1,6}[ \t]+.+)$/gm, "\n\n$1\n\n")
    .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "\n\n$1$1$1\n\n");
  const html = source
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (new RegExp(`^${spanPrefix}\\d+@@$`).test(trimmed)) return trimmed;
      const lines = block.split("\n");
      if (
        lines.length >= 2 &&
        /^\s*\|.*\|\s*$/.test(lines[0]) &&
        /^\s*\|[\s:|-]+\|\s*$/.test(lines[1])
      )
        return table(lines);
      const heading = trimmed.match(/^(#{1,6})[ \t]+(.+)$/);
      if (heading && !trimmed.includes("\n"))
        return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
      if (/^([-*_])\1{2,}$/.test(trimmed)) return "<hr>";
      if (lines.every((line) => /^\s*[-*+]\s+/.test(line)))
        return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`).join("")}</ul>`;
      if (lines.every((line) => /^\s*\d+\.\s+/.test(line)))
        return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
      if (lines.every((line) => /^&gt;\s?/.test(line)))
        return `<blockquote>${inline(lines.map((line) => line.replace(/^&gt;\s?/, "")).join("<br>"))}</blockquote>`;
      return `<p>${inline(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  return restore(html);
}
