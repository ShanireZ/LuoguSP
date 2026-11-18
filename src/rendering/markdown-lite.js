import { Lexer } from "marked";
import { IMAGE_UNAVAILABLE, resolveIntroHttpUrl } from "./intro-image.js";
import { createMarkerPrefix } from "./marker-prefix.js";

function rewriteBlocks(blocks, { quoteInline, blockCode }, quoted = false) {
  return blocks.map((block) => {
    if (block.type === "def") return "";
    if (quoted && block.type === "code") return blockCode(block.lang, block.text) + block.raw.match(/\n*$/)[0];
    if (block.type === "blockquote") {
      const body = rewriteBlocks(block.tokens, { quoteInline, blockCode }, true);
      if (body === block.text) return block.raw;
      return body.trim()
        ? body.trimEnd().replace(/^/gm, "> ") + block.raw.match(/\n*$/)[0]
        : "";
    }
    // These block tokens already exclude quote markers and list continuation indentation.
    if (block.type !== "list") return quoted ? quoteInline(block.raw) : block.raw;
    const items = block.items.map((item) => {
      const body = rewriteBlocks(item.tokens, { quoteInline, blockCode }, quoted);
      if (body === item.text) return item.raw;
      if (!body.trim()) return "";
      const marker = item.raw.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]*/)[0];
      const indent = " ".repeat(marker.length);
      return marker + body.trimEnd().replaceAll("\n", "\n" + indent) + item.raw.match(/\n*$/)[0];
    });
    if (items.every((raw, index) => raw === block.items[index].raw)) return block.raw;
    const retained = items.join("");
    // A removed final item can expose its predecessor's line terminator.
    return retained && retained.replace(/\n*$/, block.raw.match(/\n*$/)[0]);
  }).join("");
}

export function renderMarkdownLite(md, options = {}) {
  const { document } = options;
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
  const stashBlockCode = (rawLanguage, code) => {
    const className = codeLanguageClass(rawLanguage);
    return stash(`<pre${className}><code${className}>${esc(code)}</code></pre>`);
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
  const inlineLiterals = (source) => {
    const hasQuote = /^[ \t]*>/m.test(source);
    if (!hasQuote && !/[`[<]/.test(source)) return source;
    try {
      const lexer = new Lexer({ gfm: false });
      if (hasQuote || source.includes("]:")) {
        const blocks = lexer.blockTokens(source);
        source = rewriteBlocks(blocks, {
          blockCode: stashBlockCode,
          quoteInline(body) {
            if (!body.includes("`")) return body;
            const quoteLexer = new Lexer({ gfm: false });
            quoteLexer.tokens.links = lexer.tokens.links;
            return rewriteInlineTokens(quoteLexer.inlineTokens(body));
          },
        });
      }
      return rewriteInlineTokens(lexer.inlineTokens(source));
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
  let source = md
    .replace(/\r\n?/g, "\n")
    .replace(/^ {0,3}((`|~)\2{2,})([^\n]*)\n([\s\S]*?)(?:^ {0,3}\1\2*[ \t]*(?=\n|$)|(?![\s\S]))/gm,
      (_, _fence, _delimiter, rawLanguage, code) => stashBlockCode(rawLanguage, code.replace(/\n$/, "")));
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
      const lines = block.replace(/\n$/, "").split("\n");
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
