export const IMAGE_UNAVAILABLE = "图片不可用";

export function resolveIntroImageUrl(source, base) {
  if (!source?.trim()) return null;
  try {
    const url = new URL(source, base);
    if ((url.protocol === "https:" || url.protocol === "http:") &&
        !url.username && !url.password) return url.href;
  } catch (error) {
    // An invalid destination has no image link.
  }
  return null;
}
