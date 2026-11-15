export function renderMarkdownLite(md, options = {}) {
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
  let spanPrefix = "@@LGB";
  while (md.includes(spanPrefix)) spanPrefix += "X";
  const stash = (html) => `${spanPrefix}${spans.push(html) - 1}@@`;
  const getAttribute = (tag, pattern) => (tag.match(pattern) || [])[1] || "";
  const inline = (source) =>
    source
      .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (match, alt, value) => {
        const safeUrl = url(value);
        return safeUrl
          ? `<img src="${safeUrl}" alt="${alt}" style="max-width:100%">`
          : match;
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (match, text, value) => {
        const safeUrl = url(value);
        return safeUrl
          ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`
          : match;
      })
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
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
    .replace(/```([^\n]*)\n?([\s\S]*?)```/g, (_, rawLanguage, code) => {
      const className = codeLanguageClass(rawLanguage);
      return stash(
        `<pre${className}><code${className}>${esc(code.replace(/\n$/, ""))}</code></pre>`,
      );
    })
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const safeUrl = url(getAttribute(tag, /\bsrc\s*=\s*["']?([^"'\s>]+)/i));
      return safeUrl
        ? stash(
            `<img src="${esc(safeUrl)}" alt="${esc(getAttribute(tag, /\balt\s*=\s*["']([^"']*)["']/i))}" style="max-width:100%">`,
          )
        : "";
    })
    .replace(/<a\b[^>]*>/gi, (tag) => {
      const safeUrl = url(getAttribute(tag, /\bhref\s*=\s*["']?([^"'\s>]+)/i));
      return stash(
        safeUrl
          ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">`
          : "<span>",
      );
    })
    .replace(/<\/a>/gi, () => stash("</a>"))
    .replace(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, slash, name) =>
      safeInlineTag.test(name) ? stash(`<${slash}${name.toLowerCase()}>`) : tag,
    )
    .replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
      const html = renderTex(formula.trim(), true);
      return html ? stash(html) : match;
    })
    .replace(/(?<!\\)\$([^\n$]+?)\$/g, (match, formula) => {
      const html = renderTex(formula, false);
      return html ? stash(html) : match;
    });
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
  return html.replace(
    new RegExp(`${spanPrefix}(\\d+)@@`, "g"),
    (_, index) => spans[index],
  );
}
