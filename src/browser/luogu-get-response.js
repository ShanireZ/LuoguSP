export const SAME_ORIGIN_GET = Object.freeze({
  mode: "same-origin",
  credentials: "same-origin",
  redirect: "manual",
});

export function matchesGetUrl(response, expectedUrl) {
  return response?.redirected === false && response.url === expectedUrl;
}

export function getMediaType(response) {
  return mediaType(response.headers?.get("content-type"));
}

const mediaType = (value) => value?.split(";", 1)[0].trim().toLowerCase();

export function readJsonXhr(xhr, expectedUrl) {
  if (xhr.status !== 200 || xhr.responseURL !== expectedUrl ||
      mediaType(xhr.getResponseHeader("content-type")) !== "application/json") return null;
  if (xhr.responseType === "json") return xhr.response;
  return !xhr.responseType || xhr.responseType === "text" ? JSON.parse(xhr.responseText) : null;
}
