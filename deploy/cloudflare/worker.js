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
    return withCdnHeaders(request, await env.ASSETS.fetch(request));
  },
};
