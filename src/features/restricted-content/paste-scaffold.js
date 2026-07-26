export function parseRestrictedPasteScaffold(scaffold) {
  if (typeof scaffold !== "string") return null;
  const match = (pattern) => {
    const result = scaffold.match(pattern);
    return result ? result[1] : null;
  };
  const encodedInjection = match(
    /_feInjection\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/,
  );
  const configVersionLiteral = match(
    /window\._feConfigVersion\s*=\s*((?:["']\d+["'])|\d+)\s*;/,
  );
  const tagVersionLiteral = match(
    /window\._tagVersion\s*=\s*((?:["']\d+["'])|\d+)\s*;/,
  );
  const csrf = match(/<meta name="csrf-token" content="([^"]+)"/);
  const loaderCss = match(
    /<link rel="stylesheet" href="(https:\/\/fecdn\.luogu\.com\.cn\/[^"]+loader\.css[^"]*)"/,
  );
  const loaderJs = match(
    /<script src="(https:\/\/fecdn\.luogu\.com\.cn\/[^"]+loader\.js[^"]*)"/,
  );
  if (
    !encodedInjection ||
    !configVersionLiteral ||
    !tagVersionLiteral ||
    !loaderJs ||
    !loaderCss
  )
    return null;
  let injection;
  try {
    injection = JSON.parse(decodeURIComponent(encodedInjection)) || {};
  } catch (error) {
    return null;
  }
  return Object.freeze({
    injection,
    configVersionLiteral,
    tagVersionLiteral,
    csrf: csrf || "",
    loaderCss,
    loaderJs,
  });
}
