import { renderMarkdownLite } from "./markdown-lite.js";

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

  const sanitize = (html) => sanitizer.sanitize(html, { ADD_ATTR: ["target"] });
  const renderMath = (formula, displayMode) => {
    try {
      return sanitize(
        katex.renderToString(formula, {
          throwOnError: false,
          displayMode,
        }),
      );
    } catch (error) {
      return null;
    }
  };
  const applyDisplayPolicies = (html) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const link of template.content.querySelectorAll("a[href]")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
    for (const image of template.content.querySelectorAll("img"))
      image.style.maxWidth = "100%";
    return template.innerHTML;
  };
  const renderLite = (source, warnings) => {
    try {
      return {
        html: renderMarkdownLite(source, { katex }),
        mode: "lite",
        warnings,
      };
    } catch (error) {
      return {
        html: `<p>${escapeHtml(source)}</p>`,
        mode: "lite",
        warnings: [...warnings, "lite-render-failed"],
      };
    }
  };

  return Object.freeze({
    renderMarkdown(source, options = {}) {
      const markdown = String(source ?? "");
      const math = [];
      let mathPrefix = "%%LGMATH";
      while (markdown.includes(mathPrefix)) mathPrefix += "X";
      const hold = (html) => `${mathPrefix}${math.push(html) - 1}%%`;

      try {
        if (options.forceFullFailure === true)
          throw new Error("Full renderer failure was requested");
        const parsed = marked.parse(
          markdown
            .replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
              const html = renderMath(formula.trim(), true);
              return html ? hold(html) : match;
            })
            .replace(/(?<!\\)\$([^\n$]+?)\$/g, (match, formula) => {
              const html = renderMath(formula, false);
              return html ? hold(html) : match;
            }),
          { async: false, gfm: true, breaks: true },
        );
        if (typeof parsed !== "string")
          throw new TypeError("Marked returned a non-string result");
        const html = applyDisplayPolicies(
          sanitize(parsed).replace(
            new RegExp(`${mathPrefix}(\\d+)%%`, "g"),
            (_, index) => math[index],
          ),
        );
        return { html, mode: "full", warnings: [] };
      } catch (error) {
        return renderLite(markdown, ["full-render-failed"]);
      }
    },
  });
}
