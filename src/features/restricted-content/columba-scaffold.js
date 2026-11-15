import { serializeJsonForScript } from "./document-committer.js";
import { rstEscapeHtmlText, rstSafeCsrf, rstTrustedCdnUrl } from "./presentation.js";

function readJson(node) {
  if (!node?.matches('script[type="application/json"]:not([src])')) return undefined;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return undefined;
  }
}

function readVersion(source, assignment, valid) {
  const literal = source.match(assignment)?.[1];
  if (!literal) return null;
  try {
    const value = JSON.parse(`"${literal}"`);
    return valid.test(value) ? value : null;
  } catch {
    return null;
  }
}

function assetUrl(node, attribute, pathPattern) {
  const value = node.getAttribute(attribute);
  if (!rstTrustedCdnUrl(value)) return null;
  const url = new URL(value);
  return !url.username && !url.password && pathPattern.test(url.pathname) ? url.href : null;
}

export function parseColumbaScaffold(scaffold, document, template) {
  // Parse head and body in the inert template document, where resources cannot load.
  const root = document.createElement("template").content.ownerDocument.createElement("html");
  root.innerHTML = scaffold;
  const head = root.querySelector(":scope > head");
  if (!head || !root.querySelector(":scope > body > div#app")) return null;

  const [contextNode, duplicateContext] = head.querySelectorAll(":scope > #lentille-context");
  const context = readJson(contextNode);
  const viewer = context?.user;
  if (
    duplicateContext || context?.instance !== "main" || context.template !== template || context.status !== 200 ||
    (viewer !== null && (!Number.isSafeInteger(viewer?.uid) || viewer.uid <= 0))
  ) return null;

  const [csrfNode, duplicateCsrf] = head.querySelectorAll(':scope > meta[name="csrf-token"]');
  const csrf = csrfNode?.getAttribute("content");
  if (duplicateCsrf || !csrf || !rstSafeCsrf(csrf)) return null;

  const [themeNode, duplicateTheme] = head.querySelectorAll(":scope > #luogu-theme");
  const theme = themeNode ? readJson(themeNode) : null;
  if (duplicateTheme || (theme !== null && (typeof theme !== "object" || Array.isArray(theme))))
    return { invalidTheme: true };

  const scriptNodes = [...head.querySelectorAll(":scope > script[src]")];
  const scripts = scriptNodes.map(node =>
    node.matches(':not([type]), [type="text/javascript" i]')
      ? assetUrl(node, "src", /^\/columba\/[\w.-]+\.js$/) : null);
  const cssLinks = [...head.querySelectorAll(':scope > link[rel~="stylesheet"]')]
    .map(node => assetUrl(node, "href", /^\/columba\/[\w.-]+\.css$/));
  if (scripts.includes(null) || cssLinks.includes(null) ||
      !scripts.some(url => /^\/columba\/loader(?:\.[\w-]+)?\.js$/.test(new URL(url).pathname))) return null;

  const inline = [...head.querySelectorAll(":scope > script:not([src]):not([type])")]
    .map(node => node.textContent).join("\n");
  const configVersion = readVersion(inline, /\bwindow\.__feConfigVersion\s*=\s*'([^'\r\n]*)'\s*;/, /^[\w-]+$/);
  const tagVersion = readVersion(inline, /\bwindow\.__luoguTagVersion\s*=\s*'([^'\r\n]*)'\s*;/, /^[\w-]+\/[\w-]+$/);
  return { viewer, csrf, scripts, cssLinks, themeJson: themeNode ? serializeJsonForScript(theme) : "", configVersion, tagVersion };
}

const escapeAttribute = (text) => rstEscapeHtmlText(text).replaceAll('"', "&quot;");

export function buildColumbaDocument({
  title,
  csrf,
  configVersion,
  tagVersion,
  contextJson,
  scripts,
  cssLinks,
  themeJson,
  extraCss,
  bodySuffix,
}) {
  return (
    `<!DOCTYPE html><html lang="zh-CN" class="no-js"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="csrf-token" content="${escapeAttribute(csrf)}">` +
    `<title>${title}</title>` +
    `<link rel="icon" href="https://fecdn.luogu.com.cn/favicon.ico">` +
    `<script>window.__feInitLocalTime = Date.now() / 1000;` +
    (configVersion ? `window.__feConfigVersion = ${serializeJsonForScript(configVersion)};` : "") +
    (tagVersion ? `window.__luoguTagVersion = ${serializeJsonForScript(tagVersion)};` : "") +
    `<\/script>` +
    `<script id="lentille-context" type="application/json">${contextJson}<\/script>` +
    scripts
      .map((src) => `<script src="${escapeAttribute(src)}" charset="utf-8" defer><\/script>`)
      .join("") +
    cssLinks
      .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}" />`)
      .join("") +
    `<script id="luogu-theme" type="application/json">${themeJson}<\/script>` +
    `<style>${extraCss}</style>` +
    `</head><body><div id="app"></div>${bodySuffix || ""}</body></html>`
  );
}
