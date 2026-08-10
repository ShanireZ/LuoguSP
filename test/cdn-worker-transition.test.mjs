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

test("legacy CDN serves only immutable releases older than 2.13.7", async () => {
  const fixture = assetsFixture();
  const oldRelease = await worker.fetch(
    new Request(
      "https://spcdn.betaoi.cc/releases/2.13.6/compat/runtime.js",
    ),
    fixture.env,
  );
  assert.equal(oldRelease.status, 200);
  assert.equal(fixture.requests.length, 1);
  assert.match(
    oldRelease.headers.get("cache-control"),
    /immutable/,
  );

  for (const path of [
    "/releases/2.13.7/compat/runtime.js",
    "/releases/2.14.0/compat/runtime.js",
    "/channels/canary.json",
    "/",
  ]) {
    const response = await worker.fetch(
      new Request(`https://spcdn.betaoi.cc${path}`),
      fixture.env,
    );
    assert.equal(response.status, 404, path);
  }
  assert.equal(fixture.requests.length, 1);
});

test("legacy policy honors the forwarded Host header", async () => {
  const fixture = assetsFixture();
  const response = await worker.fetch(
    new Request(
      "https://luogusp.round1.cc/releases/2.13.7/compat/runtime.js",
      { headers: { Host: "spcdn.betaoi.cc" } },
    ),
    fixture.env,
  );
  assert.equal(response.status, 404);
  assert.equal(fixture.requests.length, 0);
});

test("new CDN origin serves 2.13.7 and later release paths", async () => {
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
