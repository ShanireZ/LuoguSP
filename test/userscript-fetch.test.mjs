import test from "node:test";
import assert from "node:assert/strict";
import {
  createUserscriptFetch,
} from "../src/cdn/userscript-fetch.js";

test("userscript fetch adapts GM_xmlhttpRequest to the verified loader contract", async () => {
  const expected = new TextEncoder().encode("renderer").buffer;
  const calls = [];
  const transport = createUserscriptFetch({
    gmRequest(details) {
      calls.push(details);
      queueMicrotask(() =>
        details.onload({
          status: 200,
          response: expected,
          responseHeaders:
            "Content-Type: text/javascript\r\nAccess-Control-Allow-Origin: *",
        }),
      );
      return { abort: () => {} };
    },
  });

  const response = await transport.fetchImpl(
    "https://spcdn.betaoi.cc/renderer.js",
  );

  assert.equal(transport.transport, "gm-xhr");
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "text/javascript",
  );
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array(expected),
  );
  assert.equal(calls[0].anonymous, true);
  assert.equal(calls[0].responseType, "arraybuffer");
});

test("userscript fetch aborts the owned GM request", async () => {
  let aborted = false;
  const transport = createUserscriptFetch({
    gmRequest() {
      return {
        abort() {
          aborted = true;
        },
      };
    },
  });
  const controller = new AbortController();
  const pending = transport.fetchImpl("https://spcdn.betaoi.cc/renderer.js", {
    signal: controller.signal,
  });

  controller.abort();

  await assert.rejects(() => pending, { name: "AbortError" });
  assert.equal(aborted, true);
});
