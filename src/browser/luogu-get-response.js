export const SAME_ORIGIN_GET = Object.freeze({
  mode: "same-origin",
  credentials: "same-origin",
  redirect: "error",
});

export function matchesGetUrl(response, expectedUrl) {
  return response?.redirected === false && response.url === expectedUrl;
}

export function getMediaType(response) {
  return response.headers?.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
}
