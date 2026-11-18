import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { resolveBootstrapOrigin } from "../cdn/origin-policy.mjs";
import { FIXTURE_HTML } from "./fixture.mjs";

const profileUrl = "https://www.luogu.com.cn/user/42";
const conditionalImage = "https://profile.example.test/conditional.png";
const authorImage = "https://profile.example.test/author.png";
const safeLink = "https://profile.example.test/$literal$";
const heading = "Staged profile introduction";
const introduction = [
  `## ${heading}`,
  `<style>html:has(meta[name=qa-profile][content=fixture-token]) body { background-image: url(${conditionalImage}); }</style>`,
  '<div style="position: fixed; inset: 0; z-index: 2147483647">Author overlay</div>',
  `<a href="${safeLink}" title="$literal$">Profile link</a>`,
  "$x^2$",
  "```cpp\nint main() {}\n```",
  `![Author photo](${authorImage} "Photo title")`,
  '<img src="data:image/png;base64,AAAA" alt="Unavailable photo">',
].join("\n\n");
const user = { uid: 42, introduction };
const profileHtml = FIXTURE_HTML
  .replace(/(<script id="lentille-context"[^>]*>).*?(<\/script>)/s,
    (_, open, close) => open + JSON.stringify({ data: { user } }).replaceAll("<", "\\u003c") + close)
  .replace("</head>", '<meta name="qa-profile" content="fixture-token"></head>')
  .replace(/<main>[\s\S]*?<\/main>/, `<main>
    <button id="native-control" onclick="this.dataset.clicked = 'true'">Native control</button>
    <div class="sidebar-container"><div class="main"></div></div>
  </main>`);

function inputPath(name) {
  const value = process.env[name];
  assert.ok(value && isAbsolute(value), `Set ${name} to an absolute path`);
  return value;
}

async function loadStagedRelease() {
  const installer = inputPath("LUOGUSP_STAGED_INSTALLER");
  const cdnRoot = inputPath("LUOGUSP_STAGED_CDN_ROOT");
  const version = process.env.LUOGUSP_EXPECTED_VERSION;
  assert.match(version || "", /^\d+\.\d+\.\d+$/, "Set LUOGUSP_EXPECTED_VERSION to the stable version under test");

  const [script, manifestText, configText] = await Promise.all([
    readFile(installer, "utf8"),
    readFile(join(cdnRoot, "releases", version, "manifest.json"), "utf8"),
    readFile(new URL("../../config/cdn.json", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const origin = resolveBootstrapOrigin(JSON.parse(configText));
  assert.equal(manifest.release, version);
  assert.equal(manifest.origin, origin);
  assert.equal(manifest.esm.enabled, false);

  const metadata = script.match(/^\/\/ ==UserScript==\r?\n([\s\S]*?)\r?\n\/\/ ==\/UserScript==/);
  assert.ok(metadata, "Expected a userscript metadata header");
  const metadataValues = (name) => [...metadata[1].matchAll(new RegExp(`^//[ \\t]+@${name}\\b(.*)$`, "gm"))]
    .map(([, value]) => value.trim());
  assert.deepEqual(metadataValues("version"), [manifest.release]);
  assert.deepEqual(metadataValues("run-at"), ["document-start"]);
  assert.deepEqual(metadataValues("sandbox"), ["raw"]);
  assert.deepEqual(metadataValues("grant"), ["GM_xmlhttpRequest"]);
  assert.deepEqual(metadataValues("connect"), [new URL(origin).hostname]);

  async function readAsset(record, prefix) {
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    const path = `releases/${version}/${prefix}.${record.sha256.slice(0, 16)}.js`;
    assert.equal(record.path, path);
    const body = await readFile(join(cdnRoot, path));
    assert.equal(body.length, record.bytes, `Wrong byte count for ${path}`);
    assert.equal(createHash("sha256").update(body).digest("hex"), record.sha256, `Wrong digest for ${path}`);
    return { body, url: new URL(path, origin).href, sha256: record.sha256 };
  }

  const [earlyGate, runtime, renderer] = await Promise.all([
    readAsset(manifest.compat.earlyGate, "compat/early-gate"),
    readAsset(manifest.compat.runtime, "compat/runtime"),
    readAsset(manifest.optionalBundles.markdownRenderer, "render/markdown-renderer"),
  ]);
  assert.deepEqual(metadataValues("require"), [earlyGate, runtime].map(({ url, sha256 }) => `${url}#sha256=${sha256}`));
  const payload = [earlyGate.body.toString("utf8"), runtime.body.toString("utf8"), script].join("\n;\n");
  return { payload, renderer, version, apiVersion: manifest.loaderApiVersion };
}

// The shim carries the real runtime request through Playwright's offline routes.
const gmShim = `globalThis.GM_xmlhttpRequest = (request) => {
  const controller = new AbortController();
  fetch(request.url, { method: request.method, credentials: "omit", signal: controller.signal })
    .then(async response => request.onload({ status: response.status, response: await response.arrayBuffer() }))
    .catch(error => request.onerror({ error: error.message }));
  return { abort: () => controller.abort() };
};`;

async function openProfile(t, browser, release, { corruptFirstResponse = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const errors = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "The staged startup and renderer must execute without page errors");
  });
  const rendererRequests = [];
  const imageAttempts = [];
  const photoNavigations = [];
  let firstRendererResponse = release.renderer.body;
  if (corruptFirstResponse) {
    // Keep the module valid and the byte count unchanged while changing the digest.
    firstRendererResponse = Buffer.from(release.renderer.body);
    assert.equal(firstRendererResponse.at(-1), 0x0a, "Expected a trailing newline in the renderer bundle");
    firstRendererResponse[firstRendererResponse.length - 1] = 0x20;
  }
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url === profileUrl && request.method() === "GET" && request.isNavigationRequest())
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: profileHtml });
    if (url === release.renderer.url) {
      rendererRequests.push(request.method());
      if (request.method() === "GET")
        return route.fulfill({
          contentType: "text/javascript; charset=utf-8",
          headers: { "access-control-allow-origin": "*" },
          body: rendererRequests.length === 1 ? firstRendererResponse : release.renderer.body,
        });
    }
    if (url === conditionalImage || url === authorImage)
      imageAttempts.push({ url, method: request.method() });
    if (url === authorImage && request.isNavigationRequest()) {
      photoNavigations.push({ method: request.method(), referer: await request.headerValue("referer") });
      return route.fulfill({ contentType: "text/html", body: "<title>Requested photo fixture</title>" });
    }
    return route.abort();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().startsWith("LuoguSP")) errors.push(message.text());
  });
  await page.addInitScript({ content: `${gmShim}\n${release.payload}` });
  await page.goto(profileUrl);
  assert.deepEqual(await page.evaluate(() => globalThis.__LUOGUSP_CDN_RUNTIME__), {
    apiVersion: release.apiVersion,
    release: release.version,
  });
  return { page, intro: page.locator(".luogusp-intro-card .lfe-marked"), rendererRequests, imageAttempts, photoNavigations };
}

test("staged stable install chain", { timeout: 30_000 }, async (t) => {
  const release = await loadStagedRelease();
  let browser;
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      browser = await chromium.launch({ channel });
      console.log(`Staged ${release.version}: ${channel ?? "chromium"} ${browser.version()} · renderer SHA-256 ${release.renderer.sha256}`);
      break;
    } catch (error) {
      if (!channel) throw error;
    }
  }
  t.after(() => browser.close());

  await t.test("pinned renderer preserves native controls and makes no automatic author requests", async (t) => {
    const { page, intro, rendererRequests, imageAttempts, photoNavigations } = await openProfile(t, browser, release);
    await intro.getByRole("heading", { name: heading }).waitFor();
    assert.deepEqual(rendererRequests, ["GET"], "The compatibility runtime must request the manifest renderer");

    // Let the browser apply author CSS and schedule any image requests before inspecting the result.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const button = page.locator("#native-control");
    const bounds = await button.boundingBox();
    assert.ok(bounds, "Expected a visible native control");
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    assert.deepEqual({
      nativeClick: await button.getAttribute("data-clicked"),
      authorCss: await intro.locator("style, [style*='position']").count(),
      authorImages: await intro.locator("img, [srcset]").count(),
      imageAttempts,
    }, { nativeClick: "true", authorCss: 0, authorImages: 0, imageAttempts: [] });

    assert.equal(await intro.locator(".katex").count(), 1);
    assert.ok(await intro.locator(".katex [style]").count(), "Preserve the generated formula styles");
    assert.equal(await intro.locator("pre code.language-cpp").textContent(), "int main() {}\n");
    const link = intro.getByRole("link", { name: "Profile link" });
    assert.equal(await link.getAttribute("href"), safeLink);
    assert.equal(await link.getAttribute("title"), "$literal$");
    const photo = intro.getByRole("link", { name: "Author photo" });
    await photo.waitFor();
    assert.equal(await photo.getAttribute("href"), authorImage);
    assert.equal(await photo.getAttribute("title"), "Photo title");
    assert.equal(await photo.getAttribute("target"), "_blank");
    assert.equal(await photo.getAttribute("rel"), "noopener noreferrer");
    assert.equal(await intro.getByText("Unavailable photo", { exact: true }).count(), 1);
    assert.equal(await intro.getByRole("link", { name: "Unavailable photo" }).count(), 0);
    await photo.focus();
    const [tab] = await Promise.all([page.waitForEvent("popup"), page.keyboard.press("Enter")]);
    await tab.waitForLoadState();
    assert.equal(tab.url(), authorImage);
    assert.deepEqual(imageAttempts, [{ url: authorImage, method: "GET" }]);
    assert.deepEqual(photoNavigations, [{ method: "GET", referer: null }]);
  });

  await t.test("runtime rejects altered renderer bytes and retries with the pinned asset", async (t) => {
    const { page, intro, rendererRequests } = await openProfile(t, browser, release, { corruptFirstResponse: true });
    const retry = page.locator(".luogusp-intro-card .luogusp-intro-retry");
    await retry.waitFor();
    assert.deepEqual(rendererRequests, ["GET"]);
    assert.equal(await intro.getByRole("heading", { name: heading }).count(), 0);
    await retry.click();
    await intro.getByRole("heading", { name: heading }).waitFor();
    assert.deepEqual(rendererRequests, ["GET", "GET"]);
  });
});
