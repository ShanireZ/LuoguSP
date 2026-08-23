import test from "node:test";
import assert from "node:assert/strict";
import worker from "../deploy/cloudflare/worker.js";

function assetsFixture() {
  const requests = [];
  return {
    requests,
    env: {
      ASSETS: {
        async fetch(request) {
          requests.push(request.url);
          return new Response("asset", {
            headers: { "content-type": "text/javascript" },
          });
        },
      },
    },
  };
}

test("configured CDN origin serves immutable release paths", async () => {
  const fixture = assetsFixture();
  const response = await worker.fetch(
    new Request(
      "https://luogusp.round1.cc/releases/2.13.7/compat/runtime.js",
    ),
    fixture.env,
  );
  assert.equal(response.status, 200);
  assert.equal(fixture.requests.length, 1);
  assert.match(
    response.headers.get("cache-control"),
    /immutable/,
  );
});
