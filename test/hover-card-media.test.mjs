import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createUserMedia } from "../src/features/hover-card/user-media.js";

const cdn = "https://cdn.luogu.com.cn";
const custom = `${cdn}/upload/image_hosting/fixture.png`;
const fallback = `${cdn}/images/bg/fe/DSCF0530-shrink.jpg`;
const turn = () => new Promise(resolve => setImmediate(resolve));

function mediaHarness(t, respond) {
  const { window } = new JSDOM("<header><img><img></header>");
  const header = window.document.querySelector("header");
  const { Blob: nativeBlob, FileReader: nativeReader } = globalThis;
  globalThis.Blob = window.Blob;
  globalThis.FileReader = window.FileReader;
  const owner = new AbortController();
  const requests = [];
  const cover = header.firstElementChild;
  const ready = new Promise(resolve => {
    const observer = new window.MutationObserver(() => {
      if (cover.hasAttribute("src")) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(cover, { attributeFilter: ["src"] });
  });
  t.after(() => {
    owner.abort();
    window.close();
    globalThis.Blob = nativeBlob;
    if (nativeReader) globalThis.FileReader = nativeReader;
    else delete globalThis.FileReader;
  });
  const apply = createUserMedia((url, signal) => {
    requests.push({ url, signal });
    const body = url === custom ? respond : new Uint8Array([1]);
    return Promise.resolve({ ok: true, url, headers: new Headers({ "content-type": "image/png" }),
      body: new Response(body).body });
  }, owner.signal);
  return { requests, owner, cover, ready,
    show: () => apply(header, { background: custom }) };
}

test("preview cover stops reading an oversized stream without Content-Length and uses its safe fallback", async (t) => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  const { requests, cover, ready, show } = mediaHarness(t, stream);
  show();
  await ready;
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
  assert.deepEqual(requests.map(({ url }) => url), [custom, fallback]);
  assert.equal(cover.src, "data:image/png;base64,AQ==");
});

test("a stalled media body times out while the preview remains open", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const { requests, owner, cover, ready, show } = mediaHarness(t, stream);
  show();
  await turn();
  assert.deepEqual(requests.map(({ url }) => url), [custom]);
  t.mock.timers.tick(2500);
  await ready;
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(owner.signal.aborted, false);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
  assert.deepEqual(requests.map(({ url }) => url), [custom, fallback]);
  assert.equal(cover.src, "data:image/png;base64,AQ==");
  owner.abort();
  assert.equal(cover.hasAttribute("src"), false);
});
