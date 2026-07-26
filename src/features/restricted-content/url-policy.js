export function createRestrictedUrlPolicy() {
  const validate = (type, id) =>
    (type === "article" || type === "paste") &&
    typeof id === "string" &&
    /^[A-Za-z0-9]+$/.test(id);
  return Object.freeze({
    originalUrl: (type, id) => {
      if (!validate(type, id))
        throw new TypeError("Restricted original URL target is invalid");
      return `https://www.luogu.com/${type}/${id}`;
    },
  });
}
