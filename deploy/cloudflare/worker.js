const LEGACY_HOSTNAME = "spcdn.betaoi.cc";
const FIRST_NEW_ORIGIN_RELEASE = Object.freeze([2, 13, 7]);

function releaseVersion(pathname) {
  const match = pathname.match(
    /^\/releases\/(\d+)\.(\d+)\.(\d+)(?:-[^/]+)?(?:\/|$)/,
  );
  return match
    ? match.slice(1).map((part) => Number(part))
    : null;
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index])
      return left[index] - right[index];
  }
  return 0;
}

function isAllowedLegacyPath(pathname) {
  const version = releaseVersion(pathname);
  return (
    version !== null &&
    compareVersion(version, FIRST_NEW_ORIGIN_RELEASE) < 0
  );
}

function requestHostname(request) {
  return (
    request.headers.get("host")?.split(":", 1)[0] ||
    new URL(request.url).hostname
  );
}

function withCdnHeaders(request, response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  const path = new URL(request.url).pathname;
  if (response.ok && path.startsWith("/releases/"))
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
  else if (path.startsWith("/channels/"))
    headers.set(
      "Cache-Control",
      "no-cache, no-store, must-revalidate",
    );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Max-Age": "86400",
        },
      });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD, OPTIONS" },
      });
    const url = new URL(request.url);
    if (
      requestHostname(request) === LEGACY_HOSTNAME &&
      !isAllowedLegacyPath(url.pathname)
    )
      return withCdnHeaders(
        request,
        new Response(
          request.method === "HEAD" ? null : "Not Found",
          { status: 404 },
        ),
      );
    return withCdnHeaders(request, await env.ASSETS.fetch(request));
  },
};
