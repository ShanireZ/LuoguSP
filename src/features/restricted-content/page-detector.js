export function createRestrictedPageDetector(config) {
  const { path, title, target, urlPolicy } = config || {};
  if (
    typeof path !== "function" ||
    typeof title !== "function" ||
    typeof target !== "function" ||
    !urlPolicy ||
    typeof urlPolicy.originalUrl !== "function"
  )
    throw new TypeError("Restricted Page Detector configuration is invalid");
  const detect = () => {
    const pathname = path();
    const match = pathname.match(
      /^\/(article|paste)\/([A-Za-z0-9]+)\/?$/,
    );
    if (!match || !title().includes("安全访问中心")) return null;
    const originalAnchor = String(target() || "").trim();
    if (
      !new RegExp(`/${match[1]}/${match[2]}(?:[/?#]|$)`).test(
        originalAnchor,
      )
    )
      return null;
    return Object.freeze({
      type: match[1],
      id: match[2],
      path: pathname,
      origUrl: urlPolicy.originalUrl(match[1], match[2]),
    });
  };
  return Object.freeze({ detect });
}
