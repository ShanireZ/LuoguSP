import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildInjection } from "../scripts/qa/build-injection.mjs";

const artifact = await readFile(new URL("../LuoguSP.user.js", import.meta.url), "utf8");
const requireUrls = [...artifact.matchAll(/^\/\/ @require\s+(\S+)$/gm)]
  .map((match) => match[1]);

test("browser QA assembles the exact pinned startup files in metadata order", async () => {
  const fetched = [];
  const contents = [];
  const result = await buildInjection({ fetchImpl: async (url, options) => {
    const requested = new URL(url);
    assert.equal(options?.redirect, "error");
    assert.equal(options?.credentials, "omit");
    assert.equal(requested.hash, "");
    fetched.push(requested.href);
    const body = await readFile(new URL(`../cdn${requested.pathname}`, import.meta.url));
    contents.push(body.toString("utf8"));
    return {
      status: 200, ok: true, redirected: false, url: requested.href,
      arrayBuffer: async () => body,
    };
  } });
  assert.deepEqual(result.requireUrls, requireUrls);
  assert.deepEqual(fetched, requireUrls.map((url) => url.split("#")[0]));
  const [early, runtime] = contents.map((text) => result.payload.indexOf(text));
  assert.ok(early > 0 && runtime > early && result.payload.indexOf(artifact) > runtime);
});

test("browser QA rejects a different body before building an injection payload", async () => {
  await assert.rejects(buildInjection({
    fetchImpl: async (url) => ({
      status: 200, ok: true, redirected: false, url: url.split("#")[0],
      arrayBuffer: async () => Buffer.from("Different fixture bytes"),
      text: async () => "Different fixture bytes",
    }),
  }), /SHA-256 mismatch/);
});

test("browser QA rejects invalid provenance before reading a startup file", async () => {
  for (const properties of [
    { redirected: true }, { url: "https://example.invalid/different-file.js" }, { status: 206 },
  ]) {
    let read = false;
    await assert.rejects(buildInjection({ fetchImpl: async (url) => ({
      status: 200, ok: true, redirected: false, url: url.split("#")[0],
      async arrayBuffer() { read = true; return new ArrayBuffer(0); },
      async text() { read = true; return ""; },
      ...properties,
    }) }), /Unexpected @require response/);
    assert.equal(read, false);
  }
});

test("browser QA validates both installer pins before sending any requests", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "luogusp-qa-pins-20261118-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = join(directory, "LuoguSP.user.js");
  await writeFile(artifactPath, artifact.replace(requireUrls[1], requireUrls[1].split("#")[0]));
  let fetched = false;
  await assert.rejects(buildInjection({ artifactPath, fetchImpl: async () => {
    fetched = true;
    throw new Error("Unexpected request");
  } }), /HTTPS @require with SHA-256/);
  assert.equal(fetched, false);
});
