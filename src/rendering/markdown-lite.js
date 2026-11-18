import { Lexer } from "marked";
import { IntroTokenizer, tokenizeDisplayMath } from "./intro-tokenizer.js";
import { IMAGE_UNAVAILABLE, resolveIntroHttpUrl } from "./intro-image.js";
import { createMarkerPrefix } from "./marker-prefix.js";

export function renderMarkdownLite(md, options = {}) {
  const { document, renderMath } = options;
  const esc = (source) =>
    source.replace(
      /[&<>"]/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
    );
  const codeLanguageClass = (raw) => {
    const language = (raw || "").trim().split(/\s+/)[0].toLowerCase();
    return /^[a-z0-9_+-]+$/.test(language)
      ? ` class="language-${esc(language)}"`
      : "";
  };
  const spans = [];
  const spanPrefix = createMarkerPrefix("@@LGB");
  const stash = (html) => `${spanPrefix}${spans.push(html) - 1}@@`;
  const spanMarker = new RegExp(`${spanPrefix}(\\d+)@@`, "g");
  const standaloneSpan = new RegExp(`^${spanPrefix}\\d+@@$`);
  const restore = (source) => source.replace(spanMarker, (_, index) => spans[index]);
  const titleAttribute = (title) => title ? ` title="${esc(title)}"` : "";
  const anchorStart = (href, title) =>
    `<a href="${esc(href)}"${titleAttribute(title)} target="_blank" rel="noopener noreferrer">`;
  let template;
  const readInertTag = (markup) => {
    template ??= document.createElement("template");
    template.innerHTML = markup;
    return template.content.firstElementChild;
  };
  const decodeAttribute = (value) => {
    if (!value?.includes("&")) return value;
    const quoted = value.replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    return readInertTag(`<span title="${quoted}"></span>`).title;
  };
  // The renderer inserts this intermediate markup only into an inert template.
  const imageMarkup = (source, alt, title) => {
    const href = resolveIntroHttpUrl(source, document.baseURI);
    return href
      ? `<img src="${esc(href)}" alt="${esc(alt)}"${title}>`
      : `<span>${esc(alt.trim() || IMAGE_UNAVAILABLE)}</span>`;
  };
  const safeInlineTag = /^(b|strong|i|em|u|s|del|ins|mark|sub|sup|br|hr|code|kbd|small)$/;
  const rewriteHtmlTag = (raw) => {
    const element = /^<(\/?)([a-z][a-z0-9]*)(?=[ \t\n\f\r/>])/i.exec(raw);
    if (!element) return raw;
    const [, closing, name] = element;
    const tag = name.toLowerCase();
    if (tag === "img" && !closing) {
      const image = readInertTag(raw);
      return image ? stash(imageMarkup(
        image.getAttribute("src"), image.getAttribute("alt") || "",
        titleAttribute(image.getAttribute("title")),
      )) : "";
    }
    if (tag === "a") {
      if (closing) return /^<\/a[ \t\n\f\r]*>$/i.test(raw) ? stash("</a>") : raw;
      const anchor = readInertTag(raw);
      const href = anchor?.getAttribute("href");
      return stash(resolveIntroHttpUrl(href, document.baseURI)
        ? anchorStart(href, anchor.getAttribute("title"))
        : "<span>");
    }
    return safeInlineTag.test(tag) ? stash(`<${closing}${tag}>`) : raw;
  };
  const inline = (source) =>
    source
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const mathInText = (source) => source
    .replace(/(?<!\\)\$\$((?:\\[\s\S]|[^\\$]|\$(?!\$))+?)\$\$|(?<![\\$])\$((?:\\[^\n]|[^\\\n$])+?)\$(?!\$)/g,
      (match, display, formula) => {
        const html = renderMath?.(match, display?.trim() ?? formula, display !== undefined);
        return html ? stash(html) : match;
      })
    .replace(/\\\$/g, "$");
  // Stashed code and attributes end a text context before math is scanned.
  const mathInFragments = (source) => source
    .split(new RegExp(`(${spanPrefix}\\d+@@)`))
    .map((part, index) => index % 2 ? part : mathInText(part))
    .join("");
  const stashCode = (code) => stash(`<code>${esc(code)}</code>`);
  const renderBlockCode = (rawLanguage, code) => {
    const className = codeLanguageClass(rawLanguage);
    return `<pre${className}><code${className}>${esc(code)}</code></pre>`;
  };
  const rewriteInlineTokens = (tokens) => tokens.map((token) => {
    if (token.type === "codespan") return stashCode(token.text);
    if (token.type === "html") return rewriteHtmlTag(token.raw);
    if (token.type === "image")
      return stash(imageMarkup(decodeAttribute(token.href), decodeAttribute(token.text),
        titleAttribute(decodeAttribute(token.title))));
    if (token.type === "link" && token.raw.startsWith("[")) {
      const href = decodeAttribute(token.href);
      if (!resolveIntroHttpUrl(href, document.baseURI)) return stash(esc(token.raw));
      const label = rewriteInlineTokens(token.tokens);
      const text = restore(inline(esc(mathInFragments(label))));
      return stash(`${anchorStart(href, decodeAttribute(token.title))}${text}</a>`);
    }
    if (["strong", "em", "del"].includes(token.type)) {
      // Preserve the delimiters for Lite's formatting pass.
      const width = (token.raw.length - token.text.length) / 2;
      return token.raw.slice(0, width) + rewriteInlineTokens(token.tokens) + token.raw.slice(-width);
    }
    return token.raw;
  }).join("");
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
  const lexer = new Lexer({
    gfm: false,
    tokenizer: new IntroTokenizer(),
    extensions: { block: [tokenizeDisplayMath] },
  });
  const blocks = lexer.lex(md);
  const markupLexer = new Lexer({ gfm: false });
  markupLexer.tokens.links = blocks.links;
  const readMarkup = (source) => {
    markupLexer.state.inLink = markupLexer.state.inRawBlock = false;
    return markupLexer.inlineTokens(source);
  };

  // Each leaf's inline tokens are confined to its paragraph, list item, or quote.
  const renderBlocks = (tokens, tight = false) => tokens.map((block) => {
    if (block.type === "space" || block.type === "def") return "";
    if (block.type === "code") return renderBlockCode(block.lang, block.text);
    if (block.type === "math") {
      const raw = block.raw.trimEnd();
      return renderMath?.(raw, block.text.trim(), block.displayMode) ??
        `<p>${esc(raw).replaceAll("\n", "<br>")}</p>`;
    }
    if (block.type === "hr") return "<hr>";
    if (block.type === "blockquote") {
      const body = renderBlocks(block.tokens);
      return body ? `<blockquote>${body}</blockquote>` : "";
    }
    if (block.type === "list") {
      let nextIndex = 0;
      const items = block.items.map((item, index) => {
        const body = renderBlocks(item.tokens, !block.loose);
        // A duplicate definition can have no tokens, but its source text is nonempty.
        if (!body && item.text.trim()) return "";
        const value = block.ordered && index !== nextIndex ? ` value="${block.start + index}"` : "";
        nextIndex = index + 1;
        return `<li${value}>${body}</li>`;
      }).join("");
      if (!items) return "";
      const tag = block.ordered ? "ol" : "ul";
      const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
      return `<${tag}${start}>${items}</${tag}>`;
    }

    const content = esc(mathInFragments(rewriteInlineTokens(block.tokens ?? readMarkup(block.text))));
    if (block.type === "heading") return `<h${block.depth}>${inline(content)}</h${block.depth}>`;
    if (standaloneSpan.test(content.trim())) return content.trim();
    const lines = content.split("\n");
    if (/^\s*\|.*\|\s*$/.test(lines[0]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1] ?? ""))
      return table(lines);
    const text = inline(content).replaceAll("\n", "<br>");
    return tight ? text : `<p>${text}</p>`;
  }).join("");

  // Preserve the existing empty paragraph at either end of a top-level heading.
  const before = blocks[0]?.type === "heading" ? "<p></p>" : "";
  const after = blocks.at(-1)?.type === "heading" ? "<p></p>" : "";
  return restore(before + (renderBlocks(blocks) || "<p></p>") + after);
}
