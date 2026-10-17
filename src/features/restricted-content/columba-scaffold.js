// 洛谷 columba 頁的殼：#lentille-context、csrf、主題、當前前端指令碼。
// 文章和剪貼板都從 /ranking、/discuss 收同一份殼，只替換 template 和 data。
// 舊剪貼板走 lfe 的 window._feInjection；2026-09 實測 /image 401、/theme/list 404，
// 那條殼已經收不到。

export function parseColumbaScaffold(scaffold) {
  if (typeof scaffold !== "string") return null;
  const pick = (pattern) => {
    const result = scaffold.match(pattern);
    return result ? result[1] : null;
  };
  const ctxRaw = pick(
    /<script id="lentille-context" type="application\/json">([\s\S]*?)<\/script>/,
  );
  const themeRaw =
    pick(
      /<script id="luogu-theme" type="application\/json">([\s\S]*?)<\/script>/,
    ) || "";
  const csrf = pick(/<meta name="csrf-token" content="([^"]+)"/) || "";
  const globalsRaw =
    pick(/<script>\s*(window\.__feInitLocalTime[\s\S]*?)<\/script>/) || "";
  const scripts = [
    ...scaffold.matchAll(
      /<script src="(https:\/\/fecdn\.luogu\.com\.cn\/[^"]+)"[^>]*><\/script>/g,
    ),
  ].map((match) => match[1]);
  const cssLinks = [
    ...scaffold.matchAll(
      /<link rel="stylesheet" href="(https:\/\/fecdn\.luogu\.com\.cn\/[^"]+)"/g,
    ),
  ].map((match) => match[1]);
  // globals 會原樣嵌進 <script>。出現 </script> 會把殼文件截斷。
  if (!ctxRaw || !scripts.length || /<\/script/i.test(globalsRaw)) return null;
  let context;
  try {
    context = JSON.parse(ctxRaw);
  } catch (error) {
    return null;
  }
  if (!context || typeof context !== "object") return null;
  let theme = null;
  if (themeRaw) {
    try {
      theme = JSON.parse(themeRaw);
    } catch (error) {
      return { invalidTheme: true };
    }
  }
  return {
    context,
    csrf,
    globalsRaw,
    scripts,
    cssLinks,
    themeRaw,
    theme,
  };
}

export function columbaScaffoldProblem(parsed, policy) {
  const isTrustedUrl = policy && policy.isTrustedUrl;
  const isSafeCsrf = policy && policy.isSafeCsrf;
  if (typeof isTrustedUrl !== "function" || typeof isSafeCsrf !== "function")
    throw new TypeError("Columba scaffold policy is invalid");
  if (parsed && parsed.invalidTheme) return "theme";
  if (
    !parsed ||
    !Array.isArray(parsed.scripts) ||
    parsed.scripts.length === 0 ||
    !parsed.scripts.every((url) => isTrustedUrl(url)) ||
    !Array.isArray(parsed.cssLinks) ||
    !parsed.cssLinks.every((url) => isTrustedUrl(url)) ||
    !isSafeCsrf(parsed.csrf)
  )
    return "scaffold";
  return null;
}

export function buildColumbaDocument({
  title,
  csrf,
  globalsRaw,
  contextJson,
  scripts,
  cssLinks,
  themeJson,
  extraCss,
  bodySuffix,
}) {
  return (
    `<!DOCTYPE html><html lang="zh-CN" class="no-js"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">` +
    `<meta name="csrf-token" content="${csrf}">` +
    `<title>${title}</title>` +
    `<link rel="icon" href="https://fecdn.luogu.com.cn/favicon.ico">` +
    `<script>${globalsRaw}<\/script>` +
    `<script id="lentille-context" type="application/json">${contextJson}<\/script>` +
    scripts
      .map((src) => `<script src="${src}" charset="utf-8" defer><\/script>`)
      .join("") +
    cssLinks
      .map((href) => `<link rel="stylesheet" href="${href}" />`)
      .join("") +
    `<script id="luogu-theme" type="application/json">${themeJson}<\/script>` +
    `<style>${extraCss}</style>` +
    `</head><body><div id="app"></div>${bodySuffix || ""}</body></html>`
  );
}
