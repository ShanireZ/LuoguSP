import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, before, test as nodeTest } from "node:test";
import { chromium } from "playwright";
import { buildLocalUserscript } from "./build-local-userscript.mjs";
import { FIXTURE_HTML } from "./fixture.mjs";

const origin = "https://www.luogu.com.cn";
const test = (name, fn) => nodeTest(name, { timeout: 12_000 }, fn);
const viewer = { uid: 42 };
const problem = { pid: "P1000", name: "Native preview", difficulty: 2, totalAccepted: 120, tags: [1] };
const fixtureHtml = (body, data = {}, context = {}) => FIXTURE_HTML
  .replace(/(<script id="lentille-context"[^>]*>).*?(<\/script>)/s,
    (_, open, close) => open + JSON.stringify({ user: viewer, ...context, data }).replaceAll("<", "\\u003c") + close)
  .replace(/<main>[\s\S]*?<\/main>/, () => `<main>${body}</main>`);

let browser;
let payload;
before(async () => {
  payload = process.env.LUOGUSP_QA_USERSCRIPT
    ? await readFile(process.env.LUOGUSP_QA_USERSCRIPT, "utf8") : await buildLocalUserscript();
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      browser = await chromium.launch({ channel });
      console.log(`Browser fixture: ${channel ?? "chromium"} ${browser.version()}`);
      break;
    } catch (error) {
      if (!channel) throw error;
    }
  }
});
after(() => browser?.close());

async function fixture(t, {
  html, path = "/", reply = () => {}, waitForSettings = true, gm = false,
  initScript = "", useClock = false, expectedConsoleError, ...options
}) {
  const page = await browser.newPage(options);
  const errors = [];
  let expectedErrors = 0;
  const requests = [];
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
    assert.equal(expectedErrors, expectedConsoleError ? 1 : 0);
  });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const value = message.text();
    if (message.type() !== "error" || !value.startsWith("LuoguSP")) return;
    if (expectedConsoleError?.test(value)) expectedErrors++;
    else errors.push(value);
  });
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ origin: url.origin, path: url.pathname, query: url.search, type: request.resourceType() });
    if (request.isNavigationRequest() && url.origin === origin && url.pathname === path.split(/[?#]/)[0])
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return reply(route, url) ?? route.abort();
  });
  const gmShim = gm ? `
    globalThis.GM_xmlhttpRequest = (request) => {
      const controller = new AbortController();
      fetch(request.url, { credentials: "omit", signal: controller.signal })
        .then(async response => request.onload({
          status: response.status, response: await response.arrayBuffer(), responseHeaders: ""
        }))
        .catch(error => request.onerror({ error: error.message }));
      return { abort: () => controller.abort() };
    };
  ` : "";
  if (useClock) {
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
  }
  await page.addInitScript({ content: initScript + gmShim + payload });
  await page.goto(origin + path);
  if (waitForSettings) await page.locator(".luogusp-setting-entry").waitFor();
  return { page, requests };
}

function responseGate(t) {
  const { promise, resolve } = Promise.withResolvers();
  t.after(resolve);
  return { promise, release: resolve };
}

const focused = (locator) => locator.evaluate(node => node === document.activeElement);
const card = (page) => page.locator("#luogusp-hover-card");

for (const fault of ["redirect", "html", "partial", "wrong-url"]) {
  test(`introduction fallback rejects ${fault} before decoding and recovers after reload`, async (t) => {
    const gate = responseGate(t);
    const hits = [];
    const external = createServer((req, res) => {
      hits.push(req.method);
      res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "x-lentille-request",
        "Access-Control-Allow-Private-Network": "true", "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { user: { uid: 123, introduction: "## Untrusted text" } } }));
    });
    external.listen(0, "127.0.0.1");
    await once(external, "listening");
    t.after(() => external.close());
    let attempts = 0;
    const { page } = await fixture(t, {
      path: "/user/123", html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>'),
      initScript: `
        const rawIntroFetch = window.fetch.bind(window);
        window.introDecoded = 0; window.introSettled = false;
        window.fetch = async (input, init) => {
          if (new URL(input, location.href).pathname !== '/user/123') return rawIntroFetch(input, init);
          try {
            const response = await rawIntroFetch(input, init);
            if (${JSON.stringify(fault)} === 'wrong-url' && response.headers.get('x-audit-fault')) Object.defineProperty(response, 'url', {value: location.origin + '/user/999'});
            const json = response.json.bind(response);
            response.json = () => { introDecoded++; return json(); };
            return response;
          } finally { window.introSettled = true; }
        };`,
      expectedConsoleError: fault === "redirect" ? /^LuoguSP intro fetch:/ : undefined,
      reply(route, url) {
        if (url.pathname !== "/user/123") return;
        if (++attempts === 1) return gate.promise.then(() => fault === "redirect"
          ? route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:${external.address().port}/untrusted` } })
          : route.fulfill({ status: fault === "partial" ? 206 : 200, headers: { "x-audit-fault": "true" }, contentType: fault === "html" ? "text/html" : "application/json",
            body: JSON.stringify({ data: { user: { uid: 123, introduction: "## Untrusted text" } } }) }));
        return route.fulfill({ json: { data: { user: { uid: 123, introduction: "## Trusted text" } } } });
      },
    });
    await page.context().grantPermissions(["local-network-access"], { origin });
    gate.release();
    await page.waitForFunction(() => introSettled);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => introDecoded), 0);
    assert.equal(await page.locator(".luogusp-intro-card").count(), 0);
    assert.deepEqual(hits, []);
    await page.reload();
    await page.locator(".luogusp-intro-card").getByRole("heading", { name: "Trusted text" }).waitFor();
  });
}

for (const key of ["Enter", "Space"]) {
  test(`introduction retry preserves keyboard focus with ${key}`, async (t) => {
    const { page } = await fixture(t, {
      path: "/user/123", html: fixtureHtml('<button id="outside-intro">Outside</button><div class="sidebar-container"><div class="main"></div></div>',
        { user: { uid: 123, introduction: "## Recovered introduction" } }),
      initScript: `const introBlob = URL.createObjectURL; let introFailures = 2;
        URL.createObjectURL = function(...args) { if (introFailures-- > 0) throw new Error('Synthetic renderer failure'); return introBlob.apply(this,args); };`,
    });
    const retry = page.locator(".luogusp-intro-retry");
    await retry.waitFor(); await retry.focus(); await page.keyboard.press(key);
    await page.waitForFunction(() => document.querySelector('.luogusp-intro-retry')?.getAttribute('aria-disabled') === 'false');
    assert.ok(await focused(retry));
    await page.keyboard.press(key);
    await page.locator(".luogusp-intro-card h2").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "个人介绍");
    assert.equal(await page.locator('.luogusp-intro-status[role="status"]').textContent(), "个人介绍已加载。");
    assert.equal(await retry.isVisible(), false);
  });
}

for (const ending of ["focus moved", "navigation"]) {
  test(`introduction retry does not steal focus after ${ending}`, async (t) => {
    const { page } = await fixture(t, {
      path: "/user/123", html: fixtureHtml('<button id="outside-intro">Outside</button><div class="sidebar-container"><div class="main"></div></div>',
        { user: { uid: 123, introduction: "## Late introduction" } }),
      initScript: `const introBlob = URL.createObjectURL; let failIntroBlob = true;
        URL.createObjectURL = function(...args) { if (failIntroBlob) { failIntroBlob = false; throw new Error('Synthetic first load failure'); } return introBlob.apply(this,args); };
        const introDigest = crypto.subtle.digest.bind(crypto.subtle); let introDigestCalls = 0;
        crypto.subtle.digest = async (...args) => { if (++introDigestCalls > 1) await new Promise(resolve => window.releaseIntroDigest = resolve); return introDigest(...args); };`,
    });
    await page.locator(".luogusp-intro-retry").press("Enter");
    await page.waitForFunction(() => typeof releaseIntroDigest === "function");
    await page.locator("#outside-intro").focus();
    if (ending === "navigation") await page.evaluate(() => history.pushState({}, "", "/problem/P1000"));
    await page.evaluate(() => releaseIntroDigest());
    if (ending === "focus moved") await page.locator(".luogusp-intro-card h2").waitFor();
    else {
      await page.waitForFunction(() => !document.querySelector(".luogusp-intro-card"));
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
      assert.equal(await page.locator(".luogusp-intro-card").count(), 0);
    }
    assert.ok(await focused(page.locator("#outside-intro")));
  });
}

test("introduction rendering fails closed when secure marker generation is unavailable", async (t) => {
  const { page } = await fixture(t, {
    path: "/user/123", html: fixtureHtml('<button id="native-control">Native control</button><div class="sidebar-container"><div class="main"></div></div>',
      { user: { uid: 123, introduction: "## Author text" } }),
    initScript: 'Object.defineProperty(crypto, "getRandomValues", {value: undefined});',
  });
  await page.locator(".luogusp-intro-retry").waitFor();
  assert.equal(await page.locator(".luogusp-intro-card h2").count(), 0);
  await page.locator("#native-control").click();
});

test("introduction normalization preserves marker-like literals and link attributes", async (t) => {
  const introduction = '%%LGMATH0&#58;0%%\n\n%%LGMATH0\\:0%%\n\n%%LGMATH&#48;:0%%\n\n[literal](https://example.test/%%LGMATH0&#58;0%%)\n\n$x$';
  const { page } = await fixture(t, {
    path: "/user/123", html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>', { user: { uid: 123, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  await intro.locator(".katex").waitFor();
  assert.equal(await intro.locator(".katex").count(), 1);
  assert.equal(await intro.getByText("%%LGMATH0:0%%", { exact: true }).count(), 3);
  assert.equal(await intro.getByRole("link").getAttribute("href"), "https://example.test/%%LGMATH0:0%%");
});

for (const mode of ["full", "lite"]) {
  test(`introduction marker input keeps ${mode} rendering responsive`, async (t) => {
    for (const marker of [false, true]) {
      const stem = mode === "full" ? "%%LGMATH" : "@@LGB";
      const introduction = (marker ? stem : "Ordinary ") + "X".repeat(100000);
      const { page } = await fixture(t, {
        path: "/user/123" + (mode === "lite" ? "?luogusp-qa=fallback-lite" : ""),
        html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>', { user: { uid: 123, introduction } }),
        initScript: `window.introLongTasks = []; new PerformanceObserver(list => introLongTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask', buffered:true});`,
      });
      await page.waitForFunction(() => document.querySelector(".luogusp-intro-card .lfe-marked")?.textContent.length > 100000);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const maxTask = await page.evaluate(() => Math.max(0, ...introLongTasks));
      console.log(`Introduction ${mode} ${marker ? "marker" : "ordinary"}: longest task ${Math.round(maxTask)}ms`);
      assert.ok(maxTask < 750, `${mode} blocked the main thread for ${maxTask}ms`);
      await page.close();
    }
  });
}

test("profile introduction renders math and removes author CSS before page insertion", async (t) => {
  const introduction = [
    "## Safe introduction",
    '<style>html:has(meta[name=csrf-token][content=fixture-token]) body { background-image: url(/audit-style-probe); }</style>',
    '<div style="position: fixed; inset: 0; z-index: 2147483647">Author content</div>',
    '<a href="https://example.test/$literal$" title="$literal$">Safe link</a>',
    "$x^2$",
    "```cpp\nint main() {}\n```",
  ].join("\n\n");
  const { page, requests } = await fixture(t, {
    gm: true, path: "/user/42",
    html: fixtureHtml('<button id="native-control">Native control</button><div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }).replace("</head>", '<meta name="csrf-token" content="fixture-token"></head>'),
  });
  await page.locator(".luogusp-intro-card h2").waitFor();
  const hitNative = await page.locator("#native-control").evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button;
  });
  assert.equal(hitNative, true);
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  assert.equal(await intro.locator("style, [style*='position']").count(), 0);
  assert.equal(await intro.locator("a").getAttribute("href"), "https://example.test/$literal$");
  assert.equal(await intro.locator("a").getAttribute("title"), "$literal$");
  assert.equal(await intro.locator(".katex").count(), 1);
  assert.ok(await intro.locator(".katex [style]").count());
  assert.equal(await intro.locator("pre code.language-cpp").count(), 1);
  assert.equal(requests.some((r) => r.path === "/audit-style-probe"), false);
});

test("the embedded renderer can safely render the lightweight fallback without GM", async (t) => {
  const introduction = '<div style="position:fixed; inset:0">Text</div>\n\n## Safe fallback\n\n$x^2$';
  const { page, requests } = await fixture(t, {
    path: "/user/42?luogusp-qa=fallback-lite",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  await intro.getByText("Safe fallback", { exact: true }).waitFor();
  assert.equal(await intro.locator("style, [style*='position']").count(), 0);
  assert.equal(await intro.locator(".katex").count(), 1);
  assert.equal(requests.some((r) => r.path.includes("/render/markdown-renderer.")), false);
});

for (const mode of ["full", "lite"]) {
  test(`profile introduction opens images only on request in ${mode} rendering`, async (t) => {
    const imageOrigin = "https://images.example.test";
    const photo = imageOrigin + "/intro-images/markdown(800).png";
    const redirect = origin + "/intro-images/redirect.png";
    const introduction = [
      "## Image privacy",
      `![Markdown photo](${photo} "Photo title")`,
      '[![Project screenshot](../intro-images/project(2).png "Screenshot title")](/article/fixture "Article title")',
      '[![Diagram](../intro-images/diagram(2).png "Diagram title")](./gallery "Gallery title")',
      '[![Map](../intro-images/map.png "Map title")](#chapter "Chapter title")',
      '[![Query illustration](../intro-images/query.png?theme=normal&amp;size=2 "Query &quot;image&quot;")](./gallery?mode=one&amp;page=2 "Gallery &amp; list")',
      '[![Reference illustration][cover-image]][cover-page]',
      '[cover-page]: #references "References"\n[cover-image]: ../intro-images/reference.png "Reference image"',
      '<picture><source srcset="https://images.example.test/intro-images/source.png"><img src="//images.example.test/intro-images/raw.png" srcset="https://images.example.test/intro-images/srcset.png" alt="Raw &amp; safe"></picture>',
      '<a href="https://example.test/gallery"><img src="https://images.example.test/intro-images/badge.png" alt="Badge"></a>',
      '<a href="./gallery?mode=raw&amp;page=2" title="HTML &gt; gallery"><img src="../intro-images/html.png" title="HTML image" alt="HTML cover"></a>',
      '<a href="./end-tag-gallery"><img src="../intro-images/end-tag.png" alt="End tag image"></a > trailing words',
      'Plain follow-up paragraph',
      "![Luogu photo](/intro-images/redirect.png)",
      "![Relative photo](../intro-images/relative.png)",
      "![](https://images.example.test/intro-images/untitled.png)",
      '![No scheme access](data:image/png;base64,AAAA)',
      '<img alt="An unsafe source" src="javascript&#58;alert(1)">',
      '<img alt="An image with only srcset" srcset="https://images.example.test/intro-images/only-srcset.png">',
      '<img alt="A URL with credentials" src="https://user:pass@images.example.test/intro-images/credentialed.png">',
      '<iframe src="https://images.example.test/intro-images/frame"></iframe><link rel="prefetch" href="https://images.example.test/intro-images/prefetch.png">',
      '<input type="image" src="https://images.example.test/intro-images/input.png">',
    ].join("\n\n");
    const { page, requests } = await fixture(t, {
      path: "/user/42?luogusp-qa=fallback" + (mode === "lite" ? "-lite" : ""),
      html: fixtureHtml('<button id="before-intro">Before introduction</button><div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
      reply(route, url) {
        if (url.href === redirect) return route.fulfill({
          status: 302, headers: { location: imageOrigin + "/intro-images/redirected.png" },
        });
      },
    });
    const status = mode === "lite" ? "fallback-lite" : "fallback-rendered";
    await page.locator(`#luogusp-qa-hidden-intro[data-fallback-status="${status}"]`).waitFor({ state: "attached" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(requests.filter((request) => request.path.includes("/intro-images/")), [], "Rendering must not request an author image or start a redirect");

    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    assert.equal(await intro.locator("img, picture, source, iframe, link, [src], [srcset]").count(), 0);
    const photoLink = intro.getByRole("link", { name: "Markdown photo", exact: true });
    assert.equal(await photoLink.getAttribute("href"), photo);
    assert.equal(await photoLink.getAttribute("title"), "Photo title");
    const linkedScreenshot = intro.getByRole("link", { name: "Project screenshot", exact: true });
    assert.equal(await linkedScreenshot.getAttribute("href"), "/article/fixture");
    assert.equal(await linkedScreenshot.getAttribute("title"), "Article title");
    const screenshotImage = intro.getByRole("link", { name: "打开图片：Project screenshot", exact: true });
    assert.equal(await screenshotImage.getAttribute("href"), origin + "/intro-images/project(2).png");
    assert.equal(await screenshotImage.getAttribute("title"), "Screenshot title");
    for (const [label, outer, outerTitle, image, imageTitle] of [
      ["Diagram", "./gallery", "Gallery title", "diagram(2).png", "Diagram title"],
      ["Map", "#chapter", "Chapter title", "map.png", "Map title"],
      ["Query illustration", "./gallery?mode=one&page=2", "Gallery & list", "query.png?theme=normal&size=2", 'Query "image"'],
      ["Reference illustration", "#references", "References", "reference.png", "Reference image"],
      ["HTML cover", "./gallery?mode=raw&page=2", "HTML > gallery", "html.png", "HTML image"],
    ]) {
      const link = intro.getByRole("link", { name: label, exact: true });
      assert.equal(await link.getAttribute("href"), outer);
      assert.equal(await link.getAttribute("title"), outerTitle);
      const imageLink = intro.getByRole("link", { name: `打开图片：${label}`, exact: true });
      assert.equal(await imageLink.getAttribute("href"), origin + "/intro-images/" + image);
      assert.equal(await imageLink.getAttribute("title"), imageTitle);
      assert.equal(await imageLink.getAttribute("rel"), "noopener noreferrer");
    }
    assert.equal(await intro.getByRole("link", { name: "Raw & safe", exact: true }).getAttribute("href"), imageOrigin + "/intro-images/raw.png");
    assert.equal(await intro.getByRole("link", { name: "Badge", exact: true }).getAttribute("href"), "https://example.test/gallery");
    assert.equal(await intro.getByRole("link", { name: "打开图片：Badge", exact: true }).getAttribute("href"), imageOrigin + "/intro-images/badge.png");
    assert.deepEqual(await intro.locator('a[href="./end-tag-gallery"]').allTextContents(), ["End tag image"]);
    assert.equal(await intro.getByRole("link", { name: "打开图片：End tag image", exact: true }).getAttribute("href"),
      origin + "/intro-images/end-tag.png");
    assert.equal(await intro.getByText("Plain follow-up paragraph", { exact: true }).count(), 1);
    assert.doesNotMatch(await intro.textContent(), /<\/a\s+>/);
    assert.equal(await intro.getByRole("link", { name: "Luogu photo", exact: true }).getAttribute("href"), redirect);
    assert.equal(await intro.getByRole("link", { name: "Relative photo", exact: true }).getAttribute("href"), origin + "/intro-images/relative.png");
    assert.equal(await intro.getByRole("link", { name: "打开图片", exact: true }).getAttribute("href"), imageOrigin + "/intro-images/untitled.png");
    for (const alt of ["No scheme access", "An unsafe source", "An image with only srcset", "A URL with credentials"]) {
      assert.equal(await intro.getByText(alt, { exact: true }).count(), 1);
      assert.equal(await intro.getByRole("link", { name: alt, exact: true }).count(), 0);
    }

    let navigation;
    await page.context().route((url) => url.href === photo, async (route) => {
      navigation = { isNavigation: route.request().isNavigationRequest(), referer: await route.request().headerValue("referer") };
      await route.fulfill({ contentType: "text/html", body: "<title>Photo fixture</title>" });
    });
    await page.locator("#before-intro").focus();
    await page.keyboard.press("Tab");
    assert.equal(await focused(photoLink), true);
    const [tab] = await Promise.all([page.waitForEvent("popup"), page.keyboard.press("Enter")]);
    await tab.waitForLoadState();
    assert.equal(tab.url(), photo);
    assert.deepEqual(navigation, { isNavigation: true, referer: null });
    assert.equal(await tab.evaluate(() => window.opener), null);
  });
}

for (const [context, wrap, title, alt, end] of [
  ["a div", (anchor) => `<div>\n${anchor}\n</div>`, "Gallery </a >", "Map </a >", "</a\n\n>"],
  ["a standalone anchor", (anchor) => anchor, "Gallery </a >", "Map </a >", "</a\n\n>"],
  ["a div with a multiline title", (anchor) => `<div>\n${anchor}\n</div>`,
    "Example </a\n\n> in title", "Map </a\n\n> in alt", "</a\n\n>"],
  ["a paragraph with a blank line before the end tag", (anchor) => `Before ${anchor}`,
    "Gallery </a >", "Map </a >", "\n\n</a\n\n>"],
]) {
  test(`Full profile introduction confines a split raw HTML image anchor in ${context}`, async (t) => {
    const introduction = [
      wrap(`<a href="./gallery" title="${title}">\n` +
        `<img src="../intro-images/cover.png" alt="${alt}" title="Cover </a >">${end}`),
      "Expected separate paragraph.",
    ].join("\n\n");
    const { page, requests } = await fixture(t, {
      path: "/user/42?luogusp-qa=fallback",
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    const paragraph = intro.getByText("Expected separate paragraph.", { exact: true });
    await intro.waitFor();
    const links = intro.locator("a[href]");
    assert.deepEqual(await links.evaluateAll((nodes) => nodes.map((node) =>
      [node.textContent.trim(), node.getAttribute("href"), node.title, node.tabIndex])), [
      [alt, "./gallery", title, 0],
      [`打开图片：${alt}`, origin + "/intro-images/cover.png", "Cover </a >", 0],
    ]);
    assert.equal(await paragraph.evaluate((node) => node.closest("a[href]") === null && node.tabIndex === -1), true);
    await links.first().focus();
    await page.keyboard.press("Tab");
    assert.equal(await links.last().evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("Tab");
    assert.equal(await intro.evaluate((node) => node.contains(document.activeElement)), false);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await intro.locator("img").count(), 0);
    assert.deepEqual(requests.filter(({ path }) => path.includes("/intro-images/")), []);
  });
}

for (const mode of ["full", "lite"]) {
  test(`profile introduction confines a multiline HTML image anchor in ${mode}`, async (t) => {
    const introduction = [
      '<a href="./gallery"><img src="../intro-images/cover.png" alt="Map"></a\n>',
      "Expected separate paragraph.",
    ].join("\n\n");
    const { page, requests } = await fixture(t, {
      path: "/user/42?luogusp-qa=fallback" + (mode === "lite" ? "-lite" : ""),
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.getByText("Expected separate paragraph.", { exact: true }).waitFor();
    const links = await intro.locator("a[href]").evaluateAll((nodes) =>
      nodes.map((node) => [node.textContent, node.getAttribute("href"), node.tabIndex]));
    assert.deepEqual(links, [
      ["Map", "./gallery", 0],
      ["打开图片：Map", origin + "/intro-images/cover.png", 0],
    ]);
    assert.equal(await intro.getByText("Expected separate paragraph.", { exact: true })
      .evaluate((node) => node.closest("a[href]") === null && node.tabIndex === -1), true);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await intro.locator("img").count(), 0);
    assert.deepEqual(requests.filter(({ path }) => path.includes("/intro-images/")), []);
  });

  test(`profile introduction keeps nested definitions and tag-shaped literals out of HTML processing in ${mode}`, async (t) => {
    const introduction = [
      "[![<b>Diagram</b>][picture]][gallery]",
      '> Quoted text\n>\n> [gallery]: ./gallery "Album <b>title</b>"',
      '- List text\n- [picture]: ../intro-images/nested.png "Image <b>title</b>"',
      'Literal `<img src="../intro-images/example.png" alt="Example">` in code.',
      '<b title="actual">Actual raw tag</b>',
    ].join("\n\n");
    const { page, requests } = await fixture(t, {
      path: "/user/42?luogusp-qa=fallback" + (mode === "lite" ? "-lite" : ""),
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.getByText("Actual raw tag", { exact: true }).waitFor();
    const links = await intro.locator("a[href]").evaluateAll((nodes) =>
      nodes.map((node) => [node.textContent, node.getAttribute("href"), node.title]));
    assert.deepEqual(links, [
      ["<b>Diagram</b>", "./gallery", "Album <b>title</b>"],
      ["打开图片：<b>Diagram</b>", origin + "/intro-images/nested.png", "Image <b>title</b>"],
    ]);
    assert.equal(await intro.locator("code").textContent(), '<img src="../intro-images/example.png" alt="Example">');
    assert.equal(await intro.locator("b").textContent(), "Actual raw tag");
    assert.match(await intro.textContent(), /Quoted text[\s\S]*List text/);
    assert.doesNotMatch(await intro.textContent(), /@@LGB|\[gallery\]:|\[picture\]:/);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await intro.locator("img").count(), 0);
    assert.deepEqual(requests.filter(({ path }) => path.includes("/intro-images/")), []);
  });
}

test("Lite profile introduction hides an EOF definition and keeps the remaining list item", async (t) => {
  const { page } = await fixture(t, {
    path: "/user/42?luogusp-qa=fallback-lite",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction: '[Book][go]\n\n- First step\n- [go]: ./album "Title"' } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  const link = intro.getByRole("link", { name: "Book", exact: true });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), "./album");
  assert.equal(await link.getAttribute("title"), "Title");
  assert.deepEqual(await intro.getByRole("listitem").allTextContents(), ["First step"]);
  assert.doesNotMatch(await intro.textContent(), /\[go\]:|\.\/album/);
});

for (const [ending, newline, first, second, listTag] of [
  ["LF", "\n", "-", "-", "ul"], ["CRLF", "\r\n", "1.", "2.", "ol"],
]) {
  test(`Lite profile introduction preserves a list with a hidden definition before a terminal ${ending}`, async (t) => {
    const introduction = ["[Book][go]", "", `${first} First step`, `${second} [go]: ./album "Title"`, ""].join(newline);
    const { page } = await fixture(t, {
      path: "/user/42?luogusp-qa=fallback-lite",
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    const link = intro.getByRole("link", { name: "Book", exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), "./album");
    assert.equal(await link.getAttribute("title"), "Title");
    assert.deepEqual(await intro.locator(`${listTag} > li`).allTextContents(), ["First step"]);
    assert.doesNotMatch(await intro.textContent(), /\[go\]:|\.\/album/);
  });
}

for (const [name, introduction, text, selector] of [
  ["a quoted fence before terminal LF", '> ~~~html\n> <img src="../intro-images/fence.png" alt="Literal">\n> ~~~\n',
    '<img src="../intro-images/fence.png" alt="Literal">', "blockquote pre code"],
  ["a quoted code span before terminal CRLF", "> Show `<b>one\r\n> two</b>`.\r\n",
    "<b>one two</b>", "blockquote code"],
  ["quoted indented code without unrelated markers", '>     <b>Example</b>\n>     <img src="../intro-images/indent.png" alt="Literal">',
    '<b>Example</b>\n<img src="../intro-images/indent.png" alt="Literal">', "blockquote pre code"],
]) {
  test(`Lite profile introduction preserves ${name}`, async (t) => {
    const { page, requests } = await fixture(t, {
      path: "/user/42?luogusp-qa=fallback-lite",
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.waitFor();
    assert.deepEqual(await intro.locator(selector).allTextContents(), [text]);
    assert.equal(await intro.locator("b, img, a[href*='/intro-images/']").count(), 0);
    assert.deepEqual(requests.filter(({ path }) => path.includes("/intro-images/")), []);
  });
}

test("Lite profile introduction excludes quoted list indentation from a multiline code span", async (t) => {
  const introduction = '> - Show `<b>one\n>   two</b>` and [link][go].\n>\n> [go]: ./album "Title"';
  const { page } = await fixture(t, {
    path: "/user/42?luogusp-qa=fallback-lite",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  await intro.waitFor();
  assert.deepEqual(await intro.locator("blockquote code").allTextContents(), ["<b>one two</b>"]);
  const link = intro.locator("blockquote a");
  assert.equal(await link.getAttribute("href"), "./album");
  assert.equal(await link.getAttribute("title"), "Title");
  assert.equal(await intro.locator("blockquote b").count(), 0);
});

test("Lite profile introduction preserves quoted fences and multiline inline code", async (t) => {
  const introduction = [
    '> ~~~html\n> <b>Example</b>\n> <img src="../intro-images/quoted-example.png" alt="Literal">\n> ~~~',
    '> Show `<b>one\n> two</b>`.',
  ].join("\n\n");
  const { page, requests } = await fixture(t, {
    path: "/user/42?luogusp-qa=fallback-lite",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  await intro.getByText("Show", { exact: false }).waitFor();
  assert.deepEqual(await intro.locator("blockquote pre code.language-xml.hljs").allTextContents(),
    ['<b>Example</b>\n<img src="../intro-images/quoted-example.png" alt="Literal">']);
  assert.deepEqual(await intro.locator("blockquote code:not(.language-xml)").allTextContents(), ["<b>one two</b>"]);
  assert.equal(await intro.locator("blockquote b, img, a[href*='quoted-example.png']").count(), 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(requests.filter(({ path }) => path.includes("/intro-images/")), []);
});

for (const [kind, introduction, links, code] of [
  ["multiline linked image titles in a quote",
    '> [![Map](../intro-images/cover.png\n> "Cover title")](./gallery\n> "Gallery title")',
    [["Map", "./gallery", "Gallery title"], ["打开图片：Map", origin + "/intro-images/cover.png", "Cover title"]]],
  ["a split raw anchor end in a quote",
    '> <a href="./gallery" title="Gallery title">Map</a\n> >\n> Outside the link.',
    [["Map", "./gallery", "Gallery title"]]],
  ["a quoted fence between unmatched backticks",
    'Before `\n\n> ~~~html\n> <img src="../intro-images/fence.png" alt="Literal">\n> ~~~\n\nAfter `',
    [], '<img src="../intro-images/fence.png" alt="Literal">'],
]) {
  test(`Lite profile introduction preserves ${kind}`, async (t) => {
    const { page, requests } = await fixture(t, {
      path: "/user/42?luogusp-qa=fallback-lite",
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.waitFor();
    assert.deepEqual(await intro.locator("blockquote a").evaluateAll((nodes) =>
      nodes.map((node) => [node.textContent, node.getAttribute("href"), node.title])), links);
    assert.deepEqual(await intro.locator("blockquote pre code").allTextContents(), code ? [code] : []);
    if (code) assert.deepEqual(await intro.locator(":scope > p").allTextContents(), ["Before `", "After `"]);
    else assert.doesNotMatch(await intro.textContent(), /[>]|\]\(/);
    assert.doesNotMatch(await intro.textContent(), /@@LGB/);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await intro.locator("img, a a").count(), 0);
    assert.deepEqual(requests.filter(({ path }) => path.includes("/intro-images/")), []);
  });
}

test("Lite profile introduction keeps continued and loose numbered lists", async (t) => {
  const introduction = [
    "[Book][go]", '- First step\n  Continued detail.\n- [local]: ./other "Other"',
    '3. First numbered step\n\n4. Second numbered step\n\n5. [go]: ./album "Title"',
  ].join("\n\n");
  const { page } = await fixture(t, {
    path: "/user/42?luogusp-qa=fallback-lite",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  const link = intro.getByRole("link", { name: "Book", exact: true });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), "./album");
  assert.equal(await link.getAttribute("title"), "Title");
  assert.deepEqual(await intro.locator("ul > li").allTextContents(), ["First stepContinued detail."]);
  assert.deepEqual(await intro.locator("ol").evaluateAll((lists) => lists.map((list) => list.start)), [3]);
  assert.deepEqual(await intro.locator("ol > li > p").allTextContents(), ["First numbered step", "Second numbered step"]);
  assert.doesNotMatch(await intro.textContent(), /\[(?:go|local)\]:|\.\/(?:album|other)/);
});

test("Lite profile introduction preserves empty numbered items and hides definitions", async (t) => {
  const introduction = '[Book][go]\n\n7. Step one\n8.\n9. Step three\n10. [go]: ./album "Title"';
  const { page } = await fixture(t, {
    path: "/user/42?luogusp-qa=fallback-lite",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  const link = intro.getByRole("link", { name: "Book", exact: true });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), "./album");
  assert.equal(await link.getAttribute("title"), "Title");
  assert.equal(await intro.locator("ol").evaluate((list) => list.start), 7);
  assert.deepEqual(await intro.locator("ol > li").allTextContents(), ["Step one", "", "Step three"]);
  assert.doesNotMatch(await intro.textContent(), /\[go\]:|\.\/album/);
});

for (const query of ["", "?luogusp-qa=fallback-lite"]) test(`profile introduction preserves numbered positions across hidden definitions in ${query ? "lite" : "full"} mode`, async (t) => {
  const introduction = [
    "[Book][go]",
    '> 7. [head]: ./first\n> 8. Step eight\n> 9. [go]: ./album "Title"\n> 10.\n> 11. Step eleven\n> 12. [end]: ./last',
    "- One\n- [go]: ./duplicate\n-\n- Four",
  ].join("\n\n");
  const { page } = await fixture(t, {
    path: "/user/42" + query,
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  const link = intro.getByRole("link", { name: "Book", exact: true });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), "./album");
  assert.equal(await link.getAttribute("title"), "Title");
  assert.deepEqual(await intro.locator("ol").evaluateAll((lists) => lists.map((list) => list.start)), [7]);
  assert.deepEqual(await intro.locator("blockquote > ol > li").evaluateAll((items) => items.map((item) =>
    [item.textContent, item.getAttribute("value")])), [["Step eight", "8"], ["", "10"], ["Step eleven", null]]);
  assert.deepEqual(await intro.locator("ul > li").allTextContents(), ["One", "", "Four"]);
  assert.equal(await intro.locator("ul > li[value]").count(), 0);
  assert.doesNotMatch(await intro.textContent(), /\[(?:head|go|end)\]:|\.\/(?:first|album|last|duplicate)/);
});

test("Lite profile introduction keeps a list with a fence and a nested quote inside a quote", async (t) => {
  const introduction = "> - Item\n>   ~~~html\n>   <b>Literal</b>\n>   ~~~\n>\n> > Nested quote.";
  const { page } = await fixture(t, {
    path: "/user/42?luogusp-qa=fallback-lite",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  await intro.waitFor();
  assert.deepEqual(await intro.locator("blockquote > ul > li > .code-container > pre > code").allTextContents(),
    ["<b>Literal</b>"]);
  assert.deepEqual(await intro.locator("blockquote > blockquote").allTextContents(), ["Nested quote."]);
  assert.equal(await intro.locator("blockquote b").count(), 0);
});

test("profile introduction preserves a Bash fence before display math", async (t) => {
  const introduction = '## Code and math\n\n```bash\necho "$$"\n```\n\n$$\nx^2\n$$';
  const { page } = await fixture(t, {
    path: "/user/42",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  await intro.getByRole("heading", { name: "Code and math" }).waitFor();
  const code = intro.locator("pre code.language-bash");
  assert.equal(await code.count(), 1);
  assert.equal((await code.textContent()).trim(), 'echo "$$"');
  assert.equal(await intro.locator("pre code.language-bash.hljs").count(), 1);
  assert.equal(await intro.locator(".katex-display").count(), 1);
});

test("Lite profile introduction keeps blank lines and negative terms in display math", async (t) => {
  const fence = "$$\n- c\n$$";
  const introduction = [
    "$$\na +\n\nb\n$$",
    "$$\n- x\n$$",
    "$$\nx^2\n$$",
    `~~~text\n${fence}\n~~~`,
    '`$$literal$$` and [Link](./$path$ "$title$").',
  ].join("\n\n");
  const { page } = await fixture(t, {
    path: "/user/42?luogusp-qa=fallback-lite",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction } }),
  });
  const intro = page.locator(".luogusp-intro-card .lfe-marked");
  const link = intro.getByRole("link", { name: "Link", exact: true });
  await link.waitFor();
  assert.deepEqual(await intro.locator(".katex-display .katex-html").allTextContents(), ["a+b", "−x", "x2"]);
  assert.equal(await intro.locator("ul, ol").count(), 0);
  assert.equal((await intro.locator("pre > code").textContent()).trimEnd(), fence);
  assert.equal(await intro.locator("p > code").textContent(), "$$literal$$");
  assert.equal(await link.getAttribute("href"), "./$path$");
  assert.equal(await link.getAttribute("title"), "$title$");
});

for (const query of ["", "?luogusp-qa=fallback-lite"]) {
  test(`profile introduction renders display math after prose in ${query ? "lite" : "full"} mode`, async (t) => {
    const literal = "inside\n$$\na+b\n$$\nafter";
    const introduction = [
      "Prose before a blank formula line.\n$$\na +\n\nb\n$$",
      "Prose before a negative term.\n$$\n- x\n$$",
      "> Quoted prose.\n> $$\n> - y\n> $$",
      `\`${literal}\` is code.`,
      `[Markdown link](./$path$ "${literal}")`,
      `Prose with a <a href="./$raw$" title="${literal}">raw link</a>.`,
      `~~~text\n${literal}\n~~~`,
      "Incomplete display.\n$$\nz",
    ].join("\n\n");
    const { page } = await fixture(t, {
      path: "/user/42" + query,
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.getByRole("link", { name: "Markdown link", exact: true }).waitFor();
    assert.deepEqual(await intro.locator(".katex-display .katex-html").allTextContents(), ["a+b", "−x", "−y"]);
    assert.deepEqual(await intro.locator("blockquote .katex-display .katex-html").allTextContents(), ["−y"]);
    assert.equal(await intro.locator("p .katex-display, ul, ol").count(), 0);
    assert.equal(await intro.locator("p > code").textContent(), literal.replaceAll("\n", " "));
    assert.equal((await intro.locator("pre > code").textContent()).trimEnd(), literal);
    assert.deepEqual(await intro.locator("a[href]").evaluateAll((links) => links.map((link) =>
      [link.getAttribute("href"), link.title])), [["./$path$", literal], ["./$raw$", literal]]);
    assert.match(await intro.textContent(), /Incomplete display\.\s*\$\$\s*z\s*$/);
  });

  test(`profile introduction preserves complete inline literals across paragraph breaks in ${query ? "lite" : "full"} mode`, async (t) => {
    const minus = "inside\n$$\n- x\n$$\nafter";
    const blank = "inside\n$$\na +\n\nb\n$$\nafter";
    const markdownTitle = "inside\n$$\na +\n\nb\n$$\n\nafter";
    const rawTitle = "inside\n$$\n- x\n$$\n\nafter";
    const introduction = [
      `Code: \`${minus}\`.`,
      `[Markdown link](./path "${markdownTitle}")`,
      `Raw <a href="./raw" title="${rawTitle}">raw link</a\n\n> stays outside.`,
      `~~~text\n${blank}\n~~~`,
      'Ordinary <a href="./missing" title="unfinished\n$$\n- y\n$$\n\nFollowing paragraph.',
      "Incomplete.\n$$\nz",
    ].join("\n\n");
    const { page } = await fixture(t, {
      path: "/user/42" + query,
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.waitFor();
    assert.deepEqual(await intro.locator(".katex-display .katex-html").allTextContents(), ["−y"]);
    assert.deepEqual(await intro.locator("p > code").allTextContents(), [minus.replaceAll("\n", " ")]);
    assert.equal((await intro.locator("pre > code").textContent()).trimEnd(), blank);
    assert.deepEqual(await intro.locator("a[href]").evaluateAll((links) => links.map((link) =>
      [link.getAttribute("href"), link.title, link.textContent])),
    [["./path", markdownTitle, "Markdown link"], ["./raw", rawTitle, "raw link"]]);
    assert.match(await intro.textContent(), /stays outside\./);
    assert.match(await intro.textContent(), /Incomplete\.\s*\$\$\s*z\s*$/);
  });

  test(`profile introduction preserves list literals, repeated regions, and quoted definitions in ${query ? "lite" : "full"} mode`, async (t) => {
    const single = "line\n$$\nx\n$$\nafter";
    const first = "first\n$$\n- x\n$$\nafter";
    const second = "second\n$$\n- y\n$$\nend";
    const repeated = first + "\n" + second;
    const indented = single.replaceAll("\n", "\n  ");
    const introduction = [
      [
        `- Code: \`${indented}\`.`,
        `- [List Markdown](./list-md "${indented}").`,
        `- <a href="./list-raw" title="${indented}">List raw</a>.`,
        "- Actual formula.\n  $$\n  w\n  $$\n  - Nested item.",
        "- Sibling.",
      ].join("\n"),
      `Code: \`${repeated}\`.`,
      `First \`${first}\` and \`${second}\`.\nContinued prose.\n$$\n- z\n$$`,
      `Before [Repeated Markdown](./repeated-md "${repeated}").`,
      `Before <a href="./repeated-raw" title="${first}\n\n${second}">Repeated raw</a>.`,
      '7. First\n8. > [go]: ./notes "Notes"\n9. Next [go].\n10.',
    ].join("\n\n");
    const { page } = await fixture(t, {
      path: "/user/42" + query,
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.waitFor();
    assert.deepEqual(await intro.locator(".katex-display .katex-html").allTextContents(), ["w", "−z"]);
    assert.deepEqual(await intro.locator("code").allTextContents(),
      [single, repeated, first, second].map(text => text.replaceAll("\n", " ")));
    assert.equal(await intro.locator("p").filter({ hasText: "Continued prose." }).locator("code").count(), 2);
    assert.equal(await intro.locator("ul ul li").textContent(), "Nested item.");
    assert.equal((await intro.locator(":scope > ul > li:last-child").textContent()).trim(), "Sibling.");
    assert.deepEqual(await intro.locator("a").evaluateAll((links) => links.map(link =>
      [link.getAttribute("href"), link.title])), [
      ["./list-md", single], ["./list-raw", single], ["./repeated-md", repeated],
      ["./repeated-raw", first + "\n\n" + second], ["./notes", "Notes"],
    ]);
    assert.deepEqual(await intro.locator("ol > li").evaluateAll((items) => items.map(item =>
      [item.textContent.trim(), item.getAttribute("value")])), [["First", null], ["Next go.", "9"], ["", null]]);
  });

  test(`profile introduction keeps nested ordinals, split anchors, and standalone math in ${query ? "lite" : "full"} mode`, async (t) => {
    const title = "First\n$$\n- x\n$$\nThen\n$$\n- y\n$$\nEnd";
    const lone = "First\n$$\n- x\nEnd";
    const introduction = [
      "- Code: `line\n  $$\n  x\n  $$\n  after`.\n  2. Nested ordered.\n  3. Next nested.\n- Sibling.",
      "Before <a href='./first'>anchor</a\n> then `first\n$$\n- x\n$$\nend`\n- Next",
      `Before <a href="./raw" title="${title}">Notes</a\n\n> Outside.\n$$\n- z\n$$\nAfter formula.`,
      `Before \`${lone}\`.\n$$\na\n$$`,
      `Before [Markdown notes](./md "${lone}").\n$$\nb\n$$`,
      `Before <a href="./single" title="${lone}">Raw notes</a>.\n$$\nc\n$$`,
    ].join("\n\n");
    const { page } = await fixture(t, {
      path: "/user/42" + query,
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.waitFor();
    assert.deepEqual(await intro.locator(".katex-display .katex-html").allTextContents(), ["−z", "a", "b", "c"]);
    assert.deepEqual(await intro.locator("code").allTextContents(),
      ["line $$ x $$ after", "first $$ - x $$ end", "First $$ - x End"]);
    assert.equal(await intro.locator("li > ol").evaluate(list => list.start), 2);
    assert.deepEqual(await intro.locator("li > ol > li").allTextContents(), ["Nested ordered.", "Next nested."]);
    assert.deepEqual(await intro.locator("ul").last().locator("li").allTextContents(), ["Next"]);
    assert.deepEqual(await intro.locator("a").evaluateAll(links => links.map(link =>
      [link.getAttribute("href"), link.title, link.textContent])), [
      ["./first", "", "anchor"], ["./raw", title, "Notes"], ["./md", lone, "Markdown notes"], ["./single", lone, "Raw notes"],
    ]);
    assert.equal(await intro.locator('a[href="./raw"]').evaluate(link => link.parentElement.textContent.trim()), "Before Notes Outside.");
  });

  for (const [marker, padding, closer = ""] of [[1, ""], [2, ""], [1, "   "], [2, "   "], [1, "   ", "   "], [2, "   ", "   "]])
  test(`profile introduction keeps ordered marker ${marker} in literals in ${query ? "lite" : "full"} mode (${padding.length}/${closer.length})`, async (t) => {
    const literal = `line\n${marker}. Within literal\n${padding}$$\n${padding}- x\n${padding}$$\n${closer}after`;
    const indent = literal.replaceAll("\n", "\n  ");
    const introduction = [
      `- Example \`${indent}\`.`,
      `- Example [Notes](./md "${indent}").`,
      `- Example <a href="./raw" title="${indent}">Notes</a>.\n  2. Actual sublist\n     $$\n     y\n     $$\n  3. Next item`,
      "- Sibling.",
    ].join("\n");
    const { page } = await fixture(t, {
      path: "/user/42" + query,
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.waitFor();
    assert.deepEqual(await intro.locator("li > code").allTextContents(), [literal.replaceAll("\n", " ")]);
    assert.deepEqual(await intro.locator("a").evaluateAll(links => links.map(link =>
      [link.getAttribute("href"), link.title])), [["./md", literal], ["./raw", literal]]);
    assert.equal(await intro.locator("li > ol, li > ul").count(), 1);
    assert.equal(await intro.locator("li > ol").evaluate(list => list.start), 2);
    assert.equal(await intro.locator("li > ol > li").count(), 2);
    assert.deepEqual(await intro.locator(".katex-display .katex-html").allTextContents(), ["y"]);
    assert.equal((await intro.locator(":scope > ul > li:last-child").textContent()).trim(), "Sibling.");
  });

  for (const dedented of [false, true])
  test(`profile introduction keeps real child math after a stray parent backtick in ${query ? "lite" : "full"} mode (dedented: ${dedented})`, async (t) => {
    const continuation = dedented ? "     Child continued\n  More prose " : "     ";
    const introduction = `- Before \`unmatched prose.\n  2. Real sublist\n     $$\n     - x\n     $$\n${continuation}\`nested code\`.\n  3. Next nested.\n- Sibling.`;
    const { page } = await fixture(t, {
      path: "/user/42" + query,
      html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
        { user: { ...viewer, introduction } }),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.waitFor();
    assert.equal(await intro.locator("li > ol").evaluate(list => list.start), 2);
    assert.equal(await intro.locator("li > ol > li").count(), 2);
    assert.deepEqual(await intro.locator("code").allTextContents(), ["nested code"]);
    assert.deepEqual(await intro.locator("li > ol .katex-display .katex-html").allTextContents(), ["−x"]);
  });

  test(`profile introduction contains wide math in ${query ? "lite" : "full"} rendering`, async (t) => {
    const introduction = String.raw`$$\rule{1000000em}{1000000em}$$

$$\rule{48em}{1em}$$

| Formula in a table |
| --- |
| $\rule{1000000em}{1em}$ |

After the formulas`;
    const katexCss = await readFile(new URL("../../node_modules/katex/dist/katex.min.css", import.meta.url), "utf8");
    const { page } = await fixture(t, {
      viewport: { width: 900, height: 720 },
      path: "/user/42" + query,
      html: fixtureHtml('<div class="sidebar-container" style="display:flex;width:320px"><div class="main" style="flex:1"></div></div>',
        { user: { ...viewer, introduction } }).replace("</head>", () => `<style>${katexCss}</style></head>`),
    });
    const intro = page.locator(".luogusp-intro-card .lfe-marked");
    await intro.getByText("After the formulas", { exact: true }).waitFor();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.equal(width, 900);
    assert.equal(await page.locator(".sidebar-container .main").evaluate((node) => node.clientWidth), 320);
    assert.equal(await intro.locator("td .katex").count(), 1);
    const math = intro.locator(".katex-display");
    assert.equal(await math.count(), 2);
    const large = await math.first().evaluate((node) => node.scrollWidth);
    assert.ok(large < 4_000, `Oversized rule produced ${large}px of content`);
    const scroll = await math.nth(1).evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
      return { left: node.scrollLeft, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
    });
    assert.ok(scroll.left > 0, `A wide formula must scroll locally: ${JSON.stringify(scroll)}`);
  });
}

function nativeScaffold(path, { token = "fixture-token", uid = viewer.uid, entry = "loader.fixture.js" } = {}) {
  const context = {
    instance: "main", template: path === "/ranking" ? "rank.gu" : "discuss.list", status: 200, user: { uid },
  };
  return `<!doctype html><html><head>
    <meta name="csrf-token" content="${token}">
    <script id="lentille-context" type="application/json">${JSON.stringify(context)}</script>
    <script id="luogu-theme" type="application/json">{"dark":false}</script>
    <script>window.__feInitLocalTime = new Date().getTime() / 1000;
      window.__feConfigVersion = 'fixture-config'; window.__feConfigRequest = '\\/_lfe\\/config';
      window.__luoguTagVersion = 'zh\\u002DCN\\/fixture'; window.__luoguTagRequest = '\\/_lfe\\/tags';</script>
    <script src="https://fecdn.luogu.com.cn/columba/${entry}" defer></script>
    </head><body><div id="app"></div></body></html>`;
}

function restrictedFixture(t, type, id, data, options = {}) {
  const path = `/${type}/${id}`;
  const saver = "https://api.luogu.me";
  const assets = "https://fecdn.luogu.com.cn";
  const headers = { "access-control-allow-origin": "*" };
  const {
    nativeScript = "", commentsPayload = { code: 200, data: { comments: [] } },
    reply: customReply, ...pageOptions
  } = options;
  return fixture(t, {
    path, waitForSettings: false, ...pageOptions,
    html: `<!doctype html><meta charset="utf-8"><title>安全访问中心</title><pre id="url">${origin}${path}</pre>`,
    reply(route, url) {
      const custom = customReply?.(route, url);
      if (custom) return custom;
      if (url.origin === saver && url.pathname === `/${type}/query/${id}`)
        return route.fulfill({ headers, json: { code: 200, data } });
      if (url.origin === saver && url.pathname === `/article/comments/${id}`)
        return route.fulfill({ headers, json: commentsPayload });
      if (url.origin === origin && ["/ranking", "/discuss"].includes(url.pathname))
        return route.fulfill({ body: nativeScaffold(url.pathname), contentType: "text/html" });
      if (url.origin === assets && url.pathname === "/columba/loader.fixture.js")
        return route.fulfill({ body: nativeScript, contentType: "text/javascript" });
    },
  });
}

for (const [type, id, archive] of [
  ["article", "123", { id: "654", title: "Wrong article", content: "Wrong ID" }],
  ["paste", "abc", { id: "xyz", content: "Wrong ID" }],
]) {
  test(`restricted ${type} rejects a Saver response for a different ID`, async (t) => {
    const { page, requests } = await restrictedFixture(t, type, id, archive);
    await page.getByText("保存站返回的内容与请求目标不匹配。", { exact: false }).waitFor();
    assert.equal(await page.locator("#lentille-context").count(), 0);
    assert.equal(requests.some((r) => r.path === "/ranking" || r.path.startsWith("/workflow/")), false);
  });
}

test("restricted article keeps public archive counts without trusting archive viewer state", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", {
    id: "123", title: "Archived article", content: "Saved text", upvote: 10,
    favorCount: 3, voted: 1, favored: true, canReply: true, canEdit: true,
  });
  const context = page.locator("#lentille-context");
  await context.waitFor({ state: "attached" });
  const { data } = JSON.parse(await context.textContent());
  assert.equal(data.article.lid, "123");
  assert.equal(data.article.content, "Saved text");
  assert.equal(data.article.upvote, 10);
  assert.equal(data.article.favorCount, 3);
  assert.deepEqual([data.voted, data.favored, data.canReply, data.canEdit], [null, null, false, false]);
  assert.deepEqual([data.article.voted, data.article.canReply, data.article.canEdit], [null, false, false]);
});

const archiveArticle = { id: "123", title: "Archived article", content: "Saved text" };
const nativeArticle = `
  document.querySelector("#app").innerHTML = '<article class="article-content"><p>Saved text</p><div class="actions"><button type="button">Native action</button></div></article>';
  document.querySelector(".article-content button").onclick = (event) => {
    event.currentTarget.textContent = "Clicked";
  };
`;
const nativePaste = `document.querySelector("#app").innerHTML = '<article class="paste-show-card"><pre>Saved paste</pre></article>';`;

const rankingEntry = "/columba/loader.ranking-fixture.js";
const rankingScaffold = nativeScaffold("/ranking", { token: "ranking-token", uid: 99, entry: "loader.ranking-fixture.js" });
const archivePaste = { id: "abc", content: "Saved paste" };
const brokenRankingScaffolds = {
  context: rankingScaffold.replace(/(<script id="lentille-context"[^>]*>)[^<]+/, "$1{"),
  theme: rankingScaffold.replace('{"dark":false}', "{"),
  resources: rankingScaffold.replace("https://fecdn.luogu.com.cn", "https://example.invalid"),
  "body lookalikes": rankingScaffold.replace(/<head>([\s\S]*?)<\/head><body>/, "<head></head><body>$1"),
  "missing mount": rankingScaffold.replace('<div id="app"></div>', "<main></main>"),
  "wrong template": rankingScaffold.replace('"rank.gu"', '"problem.list"'),
  "error context": rankingScaffold.replace('"status":200', '"status":403'),
};
const scaffoldAttempts = (requests) => requests.filter(({ origin: site, path }) =>
  site === origin && ["/ranking", "/discuss"].includes(path)).map(({ path }) => path);

for (const [type, id, archive, nativeScript, title, problems] of [
  ["article", "123", archiveArticle, nativeArticle, "Saved text", ["context", "theme", "body lookalikes", "error context"]],
  ["paste", "abc", archivePaste, nativePaste, "Saved paste", ["context", "resources", "missing mount", "wrong template"]],
]) {
  for (const problem of problems) {
    test(`restricted ${type} uses discussion after invalid ranking ${problem}`, async (t) => {
      const { page, requests } = await restrictedFixture(t, type, id, archive, {
        nativeScript,
        reply(route, url) {
          if (url.origin === origin && url.pathname === "/ranking")
            return route.fulfill({ body: brokenRankingScaffolds[problem], contentType: "text/html" });
          if (url.pathname === rankingEntry)
            return route.fulfill({ body: nativeScript, contentType: "text/javascript" });
        },
      });
      const outcome = page.getByText(title, { exact: true }).or(page.getByRole("heading", { name: "未能获取内容" }));
      await outcome.waitFor();
      assert.deepEqual(scaffoldAttempts(requests), ["/ranking", "/discuss"]);
      assert.equal(await outcome.textContent(), title);
      const context = JSON.parse(await page.locator("#lentille-context").textContent());
      assert.equal(context.template, `${type}.show`);
      assert.equal(context.user.uid, viewer.uid);
      assert.equal(await page.locator('meta[name="csrf-token"]').getAttribute("content"), "fixture-token");
      assert.equal(requests.some(({ path }) => path === rankingEntry), false);
      await page.locator("#luogusp-rst-loader").waitFor({ state: "detached" });
    });
  }
}

for (const [problem, response, type] of [
  ["HTTP 206", { status: 206, contentType: "text/html" }, "article"],
  ["wrong content type", { contentType: "text/plain" }, "paste"],
  ["wrong final URL", { contentType: "text/html", headers: { "x-fixture-final-path": "/ranking?shifted=1" } }, "article"],
]) {
  test(`restricted ${type} uses discussion after ranking ${problem}`, async (t) => {
    const article = type === "article";
    const { page, requests } = await restrictedFixture(t, type, article ? "123" : "abc", article ? archiveArticle : archivePaste, {
      nativeScript: article ? nativeArticle : nativePaste,
      initScript: `{
        const fetchPage = window.fetch;
        window.fetch = (...args) => fetchPage(...args).then(reply => {
          const finalPath = reply.headers.get("x-fixture-final-path");
          if (finalPath) Object.defineProperty(reply, "url", { value: new URL(finalPath, location.origin).href });
          return reply;
        });
      }`,
      reply(route, url) {
        if (url.origin === origin && url.pathname === "/ranking")
          return route.fulfill({ ...response, body: rankingScaffold });
        if (url.pathname === rankingEntry)
          return route.fulfill({ contentType: "text/javascript", body: article ? nativeArticle : nativePaste });
      },
    });
    await page.getByText(article ? "Saved text" : "Saved paste", { exact: true }).waitFor();
    assert.deepEqual(scaffoldAttempts(requests), ["/ranking", "/discuss"]);
    assert.equal(await page.locator('meta[name="csrf-token"]').getAttribute("content"), "fixture-token");
    assert.equal(requests.some(({ path }) => path === rankingEntry), false);
  });
}

test("restricted paste rejects a ranking redirect before contacting its target", async (t) => {
  const pending = responseGate(t);
  let redirectHits = 0;
  const server = createServer((req, res) => {
    redirectHits++;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Content-Type", "text/html");
    res.end(rankingScaffold);
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  t.after(() => server.close());
  const redirectUrl = `http://127.0.0.1:${server.address().port}/fixture-scaffold`;
  const { page, requests } = await restrictedFixture(t, "paste", "abc", archivePaste, {
    nativeScript: nativePaste,
    reply(route, url) {
      if (url.origin === origin && url.pathname === "/ranking")
        return pending.promise.then(() => route.fulfill({ status: 302, headers: { location: redirectUrl } }));
      if (url.pathname === rankingEntry)
        return route.fulfill({ contentType: "text/javascript", body: nativePaste });
    },
  });
  await page.context().grantPermissions(["local-network-access"], { origin });
  pending.release();
  await page.getByText("Saved paste", { exact: true }).waitFor();
  assert.equal(redirectHits, 0);
  assert.deepEqual(scaffoldAttempts(requests), ["/ranking", "/discuss"]);
  assert.equal(requests.some(({ path }) => path === rankingEntry), false);
});

test("restricted article rebuilds native bootstrap data without running shell code or loading shell body resources", async (t) => {
  const scaffold = nativeScaffold("/ranking")
    .replace("</script>\n    <script src", `
      window.__feConfigRequest = '/fixture-config-probe';
      window.scaffoldProbe = localStorage.getItem('scaffold-fixture-value');</script>
    <script src`)
    .replace("</body>", '<iframe src="/fixture-scaffold-probe"></iframe></body>');
  const { page, requests } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    initScript: `localStorage.setItem('scaffold-fixture-value', 'private fixture value');`,
    reply(route, url) {
      if (url.origin === origin && url.pathname === "/ranking")
        return route.fulfill({ body: scaffold, contentType: "text/html; charset=UTF-8" });
    },
  });
  await page.getByText("Saved text", { exact: true }).waitFor();
  const bootstrap = await page.evaluate(() => ({
    config: window.__feConfigVersion, tags: window.__luoguTagVersion,
    safeConfig: window.__feConfigRequest === undefined || window.__feConfigRequest === "/_lfe/config",
    time: Number.isFinite(window.__feInitLocalTime), executed: "scaffoldProbe" in window,
  }));
  assert.deepEqual(bootstrap, {
    config: "fixture-config", tags: "zh-CN/fixture", safeConfig: true, time: true, executed: false,
  });
  assert.deepEqual(scaffoldAttempts(requests), ["/ranking"]);
  assert.equal(requests.some(({ path }) => path === "/fixture-scaffold-probe"), false);
});

test("restricted article shows the preparation failure when both scaffolds are invalid", async (t) => {
  const { page, requests } = await restrictedFixture(t, "article", "123", archiveArticle, {
    expectedConsoleError: /^LuoguSP restricted boot: Error: 洛谷主题数据解析失败（结构可能已改版）。/,
    reply(route, url) {
      if (url.origin === origin && ["/ranking", "/discuss"].includes(url.pathname))
        return route.fulfill({ body: brokenRankingScaffolds.theme, contentType: "text/html" });
    },
  });
  await page.getByText("洛谷主题数据解析失败（结构可能已改版）。", { exact: true }).waitFor();
  assert.deepEqual(scaffoldAttempts(requests), ["/ranking", "/discuss"]);
  assert.equal(await page.locator("#luogusp-rst-loader, #lentille-context").count(), 0);
  assert.equal(await page.locator(".luogusp-rst-original").getAttribute("href"), "https://www.luogu.com/article/123");
  assert.equal(requests.some(({ path }) => path === rankingEntry), false);
});

const readArticleInteraction = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("luogusp.article-interaction.v2") ?? "{}")["42:123"]);

for (const first of ["vote", "favor"]) {
  const second = first === "vote" ? "favor" : "vote";
  test(`restricted article keeps count freshness separate for ${first} then ${second}`, async (t) => {
    const now = Date.now();
    const initialCache = { voted: 0, favored: false, upvote: 5, favorCount: 7, at: now - 60_000 };
    const legacyStorage = JSON.stringify({ "42:123": initialCache });
    const archive = {
      ...archiveArticle, upvote: 10, favorCount: 20, updatedAt: new Date(now - 30_000).toISOString(),
    };
    const { page } = await restrictedFixture(t, "article", "123", archive, {
      nativeScript: nativeArticle,
      initScript: `
        if (localStorage.getItem("luogusp.article-interaction.v2") === null)
          localStorage.setItem("luogusp.article-interaction.v2", ${JSON.stringify(legacyStorage)});
      `,
      reply(route, url) {
        if (url.origin !== origin || route.request().method() !== "POST") return;
        if (url.pathname === "/article/123/vote" && url.search === "?vote=1")
          return route.fulfill({ json: { upvotes: archive.upvote + 1, voted: 1 } });
        if (url.pathname === "/article/123/favor" && !url.search)
          return route.fulfill({ status: 204 });
      },
    });
    const rendered = async () => {
      await page.getByRole("button", { name: "Native action" }).waitFor();
      const { data } = JSON.parse(await page.locator("#lentille-context").textContent());
      return [data.article.upvote, data.article.favorCount, data.voted, data.favored];
    };
    const confirm = async (action) => {
      const path = action === "vote" ? "/article/123/vote?vote=1" : "/article/123/favor";
      assert.ok(await page.evaluate(async path => (await fetch(path, { method: "POST" })).ok, path));
      await page.waitForFunction((action) => {
        const record = JSON.parse(localStorage.getItem("luogusp.article-interaction.v2"))["42:123"];
        return action === "vote" ? record?.voted === 1 : record?.favored === true;
      }, action);
    };

    assert.deepEqual(await rendered(), [10, 20, 0, false]);
    await page.clock.setFixedTime(now);
    await confirm(first);
    await page.reload();
    assert.deepEqual(await rendered(), first === "vote" ? [11, 20, 1, false] : [10, 21, 0, true]);

    Object.assign(archive, { upvote: 13, favorCount: 23, updatedAt: new Date(now + 2_000).toISOString() });
    await page.clock.setFixedTime(now + 4_000);
    await page.reload();
    assert.deepEqual(await rendered(), first === "vote" ? [13, 23, 1, false] : [13, 23, 0, true]);
    await confirm(second);
    await page.reload();
    assert.deepEqual(await rendered(), second === "vote" ? [14, 23, 1, true] : [13, 24, 1, true]);
  });
}

for (const transport of ["fetch", "xhr"]) {
  test(`restricted article ${transport} persists only confirmed votes and favorites`, async (t) => {
    // Playwright routes only the first request of a redirect chain.
    const redirectHits = [];
    let protectedWrites = 0;
    const redirectTarget = createServer((req, res) => {
      redirectHits.push(req.method);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "x-csrf-token");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Content-Type", "application/json");
      res.end(req.method === "OPTIONS" ? "" : '{"_empty":true}');
    });
    const listening = once(redirectTarget, "listening");
    redirectTarget.listen(0, "127.0.0.1");
    await listening;
    t.after(() => redirectTarget.close());
    const { page } = await restrictedFixture(t, "article", "123", {
      ...archiveArticle, favorCount: 3, upvote: 10,
    }, {
      nativeScript: nativeArticle,
      reply(route, url) {
        if (url.origin !== origin) return;
        if (url.pathname === "/article/123/vote") {
          const expectCancel = url.searchParams.get("vote") === "0";
          return route.fulfill({
            json: { upvotes: 10, voted: expectCancel || !url.search ? 0 : null },
          });
        }
        if (url.pathname !== "/article/123/favor") return;
        if (!url.search) {
          if (route.request().headers()["x-csrf-token"] === "fixture-token") protectedWrites++;
          return route.fulfill({
            status: 302, headers: { location: `http://127.0.0.1:${redirectTarget.address().port}/fixture-redirect` },
          });
        }
        if (route.request().headers()["x-fixture-response"] === "html")
          return route.fulfill({ contentType: "text/html", body: "<html>Sign in</html>" });
        if (route.request().headers()["x-fixture-response"] === "error")
          return route.fulfill({ json: { success: false, data: {} } });
        return route.fulfill({ status: 204 });
      },
    });
    await page.context().grantPermissions(["local-network-access"], { origin });
    await page.getByRole("button", { name: "Native action" }).waitFor();
    const post = (path, responseKind) => page.evaluate(async ({ path, transport, responseKind }) => {
      if (transport === "fetch") {
        const response = await fetch(path, {
          method: "POST",
          headers: responseKind ? { "x-fixture-response": responseKind } : {},
        });
        return { status: response.status, body: await response.text() };
      }
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", path);
        if (responseKind) xhr.setRequestHeader("x-fixture-response", responseKind);
        xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
        xhr.onerror = reject;
        xhr.send();
      });
    }, { path, transport, responseKind });
    const voteNotice = page.locator("#luogusp-rst-write-vote-unconfirmed");
    const favorNotice = page.locator("#luogusp-rst-write-favor-unconfirmed");
    if (transport === "fetch") {
      await assert.rejects(post("/article/123/favor"), /Failed to fetch/);
      assert.equal(protectedWrites, 1);
      assert.deepEqual(redirectHits, []);
      assert.equal(await favorNotice.count(), 0);
    } else {
      assert.deepEqual(await post("/article/123/favor"), { status: 200, body: '{"_empty":true}' });
      assert.equal(protectedWrites, 0);
      assert.equal(redirectHits.filter((method) => method === "GET").length, 1);
      await favorNotice.waitFor();
    }
    const cases = [
      ["/article/123/vote?vote=1", undefined, '{"upvotes":10,"voted":null}'],
      ["/article/123/vote", undefined, '{"upvotes":10,"voted":0}'],
      ["/article/123/favor?remove=1", "html", "<html>Sign in</html>"],
      ["/article/123/favor?remove=1", "error", '{"success":false,"data":{}}'],
    ];
    for (const [path, responseKind, body] of cases) {
      assert.deepEqual(await post(path, responseKind), { status: 200, body });
      await (path.includes("/vote") ? voteNotice : favorNotice).waitFor();
      assert.equal(await readArticleInteraction(page), undefined);
    }
    assert.equal((await post("/article/123/favor?remove=1")).status, 204);
    await favorNotice.waitFor({ state: "detached" });
    assert.equal(await voteNotice.count(), 1);
    assert.equal((await post("/article/123/vote?vote=0")).status, 200);
    await page.waitForFunction(() => {
      const entry = JSON.parse(localStorage.getItem("luogusp.article-interaction.v2") ?? "{}")["42:123"];
      return entry?.favored === false && entry.voted === 0;
    });
    const { at, voteAt, favorAt, ...state } = await readArticleInteraction(page);
    assert.ok(Number.isFinite(voteAt) && Number.isFinite(favorAt));
    assert.equal(at, Math.max(voteAt, favorAt));
    assert.deepEqual(state, { voted: 0, favored: false, upvote: 10, favorCount: 2 });
    await voteNotice.waitFor({ state: "detached" });
  });
}

async function reorderedArticleWrites(t, responses) {
  const older = responseGate(t);
  const received = Promise.withResolvers();
  const { page } = await restrictedFixture(t, "article", "123", {
    ...archiveArticle, upvote: 10, favorCount: 3,
  }, {
    nativeScript: nativeArticle,
    initScript: `
      window.articleWrites = {};
      window.observedArticleWrites = [];
      const clone = Response.prototype.clone;
      Response.prototype.clone = function () {
        const copy = clone.call(this);
        const slot = this.headers.get("x-fixture-write");
        if (slot) {
          const text = copy.text.bind(copy);
          copy.text = () => text().then(body => {
            setTimeout(() => observedArticleWrites.push(slot), 0);
            return body;
          });
        }
        return copy;
      };
      const at = Date.now();
      if (!localStorage.getItem("luogusp.article-interaction.v2"))
        localStorage.setItem("luogusp.article-interaction.v2", JSON.stringify({ "42:123": {
        voted: 0, upvote: 10, favored: false, favorCount: 3, voteAt: at, favorAt: at, at,
      } }));
    `,
    reply(route, url) {
      if (url.origin !== origin || route.request().method() !== "POST") return;
      const slot = route.request().headers()["x-fixture-write"];
      if (!Object.hasOwn(responses, slot)) return;
      const fulfill = () => {
        const response = typeof responses[slot] === "function" ? responses[slot]() : { json: responses[slot] };
        return route.fulfill({ ...response, headers: { "x-fixture-write": slot } });
      };
      if (slot === "older") {
        received.resolve();
        return older.promise.then(fulfill);
      }
      return fulfill();
    },
  });
  await page.getByRole("button", { name: "Native action" }).waitFor();
  const start = (slot, transport, path) => page.evaluate(({ slot, transport, path }) => {
    if (transport === "fetch") {
      articleWrites[slot] = fetch(path, { method: "POST", headers: { "x-fixture-write": slot } })
        .then(response => response.text());
    } else {
      articleWrites[slot] = new Promise((resolve, reject) => {
        const xhr = slot === "newer" && window.preparedVote ? preparedVote : new XMLHttpRequest();
        if (xhr !== window.preparedVote) xhr.open("POST", path);
        xhr.setRequestHeader("x-fixture-write", slot);
        xhr.onload = () => {
          observedArticleWrites.push(slot);
          resolve(xhr.responseText);
        };
        xhr.onerror = reject;
        xhr.send();
      });
    }
  }, { slot, transport, path });
  const finish = async (slot) => {
    await page.evaluate(slot => articleWrites[slot], slot);
    await page.waitForFunction(slot => observedArticleWrites.includes(slot), slot);
  };
  return { page, start, finish, received: received.promise, release: older.release };
}

for (const transport of ["fetch", "xhr"]) {
  test(`restricted article ${transport} leaves accepted and partial favorites unconfirmed until completion`, async (t) => {
    const { page, start, finish } = await reorderedArticleWrites(t, {
      pending: () => ({ status: 202, body: "", contentType: "text/plain" }),
      "pending-json": () => ({ status: 202, json: { _empty: true } }),
      "pending-state": () => ({ status: 202, json: { favored: true, favorCount: 4 } }),
      partial: () => ({ status: 206, body: "", contentType: "text/plain" }),
      "partial-state": () => ({ status: 206, json: { favored: true, favorCount: 4 } }),
      complete: () => ({ status: 204 }),
      reset: () => ({ status: 205 }),
      "empty-ok": () => ({ status: 200, body: "", contentType: "text/plain" }),
      json: () => ({ status: 200, json: { favored: false, favorCount: 3 } }),
      created: () => ({ status: 201, json: { favored: true, favorCount: 4 } }),
    });
    const initial = await readArticleInteraction(page);
    const notice = page.locator("#luogusp-rst-write-favor-unconfirmed");
    assert.equal(await notice.count(), 0);
    for (const slot of ["partial-state", "pending", "pending-json", "pending-state", "partial"]) {
      await start(slot, transport, "/article/123/favor");
      await finish(slot);
      assert.deepEqual(await readArticleInteraction(page), initial);
      assert.equal(await notice.count(), 1);
    }
    for (const [slot, remove, expected] of [
      ["complete", false, true], ["reset", true, false], ["empty-ok", false, true],
      ["json", true, false], ["created", false, true],
    ]) {
      await start(slot, transport, `/article/123/favor${remove ? "?remove=1" : ""}`);
      await finish(slot);
      const state = await readArticleInteraction(page);
      assert.equal(state.favored, expected);
      assert.equal(state.favorCount, expected ? 4 : 3);
      assert.equal(state.voteAt, initial.voteAt);
      assert.equal(await notice.count(), 0);
    }
  });
}

for (const [transport, status] of [["fetch", 202], ["xhr", 202], ["fetch", 206], ["xhr", 206]]) {
  test(`restricted article ${transport} leaves a vote with HTTP ${status} unconfirmed until completion`, async (t) => {
    const completed = { upvotes: 11, voted: 1 };
    const { page, start, finish } = await reorderedArticleWrites(t, {
      "favor-pending": () => ({ status: 202, json: { favored: true, favorCount: 4 } }),
      pending: () => ({ status, json: completed }),
      complete: completed,
    });
    const initial = await readArticleInteraction(page);
    const voteNotice = page.locator("#luogusp-rst-write-vote-unconfirmed");
    const favorNotice = page.locator("#luogusp-rst-write-favor-unconfirmed");

    await start("favor-pending", transport, "/article/123/favor");
    await finish("favor-pending");
    await start("pending", transport, "/article/123/vote?vote=1");
    await finish("pending");
    assert.deepEqual(await readArticleInteraction(page), initial);
    assert.equal(await favorNotice.count(), 1);
    assert.equal(await voteNotice.count(), 1);

    await start("complete", transport, "/article/123/vote?vote=1");
    await finish("complete");
    const state = await readArticleInteraction(page);
    assert.equal(state.voted, 1);
    assert.equal(state.upvote, 11);
    assert.ok(state.voteAt > initial.voteAt);
    assert.equal(state.favorAt, initial.favorAt);
    assert.equal(await voteNotice.count(), 0);
    assert.equal(await favorNotice.count(), 1);
  });
}

for (const [olderTransport, newerTransport] of [["fetch", "fetch"], ["xhr", "xhr"], ["fetch", "xhr"], ["xhr", "fetch"]]) {
  test(`restricted article keeps the newer vote after an older ${olderTransport} completes behind ${newerTransport}`, async (t) => {
    const { page, start, finish, received, release } = await reorderedArticleWrites(t, {
      older: { upvotes: 11, voted: 1 }, newer: { upvotes: 10, voted: 0 },
    });
    if (newerTransport === "xhr") await page.evaluate(() => {
      window.preparedVote = new XMLHttpRequest();
      preparedVote.open("POST", "/article/123/vote?vote=0");
    });
    await start("older", olderTransport, "/article/123/vote?vote=1");
    await received;
    await start("newer", newerTransport, "/article/123/vote?vote=0");
    await finish("newer");
    const latest = await readArticleInteraction(page);
    assert.equal(latest.voted, 0);
    assert.equal(latest.upvote, 10);
    release();
    await finish("older");
    assert.deepEqual(await readArticleInteraction(page), latest);
    await page.reload();
    await page.getByRole("button", { name: "Native action" }).waitFor();
    const { data } = JSON.parse(await page.locator("#lentille-context").textContent());
    assert.equal(data.voted, 0);
    assert.equal(data.article.upvote, 10);
  });
}

for (const latestConfirmed of [true, false]) {
  test(`restricted article ignores an older vote when the newer result is ${latestConfirmed ? "confirmed" : "uncertain"}`, async (t) => {
    const success = { upvotes: 11, voted: 1 };
    const invalid = { success: false };
    const { page, start, finish, received, release } = await reorderedArticleWrites(t, {
      older: latestConfirmed ? invalid : success, newer: latestConfirmed ? success : invalid,
    });
    await start("older", "xhr", "/article/123/vote?vote=1");
    await received;
    await start("newer", "fetch", "/article/123/vote?vote=1");
    await finish("newer");
    const latest = await readArticleInteraction(page);
    const notice = page.locator("#luogusp-rst-write-vote-unconfirmed");
    assert.equal(await notice.count(), latestConfirmed ? 0 : 1);
    release();
    await finish("older");
    assert.deepEqual(await readArticleInteraction(page), latest);
    assert.equal(await notice.count(), latestConfirmed ? 0 : 1);
  });
}

test("a synchronously rejected XHR send preserves the earlier vote and permits retry", async (t) => {
  const { page, start, finish, received, release } = await reorderedArticleWrites(t, {
    older: { upvotes: 11, voted: 1 }, newer: { upvotes: 10, voted: 0 },
  });
  await start("older", "xhr", "/article/123/vote?vote=1");
  await received;
  const failure = await page.evaluate(() => {
    window.preparedVote = new XMLHttpRequest();
    preparedVote.open("POST", "/article/123/vote?vote=0");
    try {
      preparedVote.send(Symbol("Invalid XHR body"));
    } catch (error) {
      return error.name;
    }
  });
  assert.equal(failure, "TypeError");
  release();
  await finish("older");
  assert.equal((await readArticleInteraction(page)).voted, 1);
  await start("newer", "xhr", "/article/123/vote?vote=0");
  await finish("newer");
  assert.equal((await readArticleInteraction(page)).voted, 0);
});

test("restricted article keeps vote and favorite ordering independent", async (t) => {
  const { page, start, finish, received, release } = await reorderedArticleWrites(t, {
    older: { favored: true, favorCount: 4 }, newer: { upvotes: 11, voted: 1 },
  });
  await start("older", "xhr", "/article/123/favor");
  await received;
  await start("newer", "fetch", "/article/123/vote?vote=1");
  await finish("newer");
  release();
  await finish("older");
  const state = await readArticleInteraction(page);
  assert.deepEqual([state.voted, state.upvote, state.favored, state.favorCount], [1, 11, true, 4]);
});

test("restricted reply adapters accept only aligned JSON and preserve cancellation", async (t) => {
  const redirectTarget = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.end('{"replySlice":[{"id":44}]}');
  });
  const listening = once(redirectTarget, "listening");
  redirectTarget.listen(0, "127.0.0.1");
  await listening;
  t.after(() => redirectTarget.close());
  const held = responseGate(t);
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    commentsPayload: { code: 200, data: { comments: [{ id: 31, content: "Saved reply", time: 100, author: { id: 78, name: "Fixture author" } }] } },
    reply(route, url) {
      if (url.origin !== origin || url.pathname !== "/article/123/replies") return;
      switch (url.searchParams.get("sort")) {
        case "redirect": return route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:${redirectTarget.address().port}/archived-fixture-redirect` } });
        case "mime": return route.fulfill({ body: '{"replySlice":[{"id":44}]}', contentType: "text/html" });
        case "offline": return route.abort();
        case "pending": return held.promise.then(() => route.abort().catch(() => {}));
        default: return route.fulfill({ json: { replySlice: [{ id: 99 }] } });
      }
    },
  });
  await page.context().grantPermissions(["local-network-access"], { origin });
  await page.getByRole("button", { name: "Native action" }).waitFor();
  for (const transport of ["fetch", "xhr"]) {
    const responses = await page.evaluate(async (transport) => {
      const read = async (test) => {
        const path = `/article/123/replies?sort=${test}`;
        if (transport === "fetch") {
          const response = await fetch(path);
          return [response.headers.get("x-luogusp-source"), (await response.json()).replySlice.map(({ id }) => id)];
        }
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", path);
          xhr.responseType = "json";
          xhr.addEventListener("load", (event) => {
            if (!(event instanceof ProgressEvent) || event.currentTarget !== xhr) return reject(new Error("Non-native event interface"));
            resolve([xhr.getResponseHeader("x-luogusp-source"), xhr.response.replySlice.map(({ id }) => id)]);
          });
          xhr.onerror = () => reject(new Error("Missing fallback"));
          xhr.send();
        });
      };
      return await Promise.all(["native", "redirect", "mime", "offline"].map(read));
    }, transport);
    assert.deepEqual(responses, [[null, [99]], ["saver", [31]], ["saver", [31]], ["saver", [31]]]);
  }
  const cancellations = await page.evaluate(async () => {
    const path = "/article/123/replies?sort=pending";
    const controller = new AbortController();
    const cancellation = fetch(path, { signal: controller.signal }).then(() => "resolved", (error) => error.name);
    controller.abort();
    const events = [];
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path);
    for (const type of ["abort", "error", "load", "loadend"])
      xhr.addEventListener(type, (event) => events.push([type, event.isTrusted, xhr.status]));
    xhr.send();
    xhr.abort();
    return [await cancellation, events, xhr.readyState];
  });
  assert.deepEqual(cancellations, ["AbortError", [["abort", true, 0], ["loadend", true, 0]], 0]);
});

test("restricted comments revalidate a reply sent after an unsent XHR was aborted", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    commentsPayload: { code: 200, data: { comments: [{ id: 31, content: "Saved reply", time: 100, author: { id: 78, name: "Fixture author" } }] } },
    reply(route, url) {
      if (url.origin !== origin || url.pathname !== "/article/123/replies") return;
      if (url.search === "?sort=invalid")
        return route.fulfill({ contentType: "text/html", body: '{"replySlice":[{"id":44}]}' });
      return route.fulfill({ json: { replySlice: [{ id: 99 }] } });
    },
  });
  await page.getByRole("button", { name: "Native action" }).waitFor();
  const outcomes = await page.evaluate(async () => {
    const xhr = new XMLHttpRequest();
    const send = (sort) => new Promise((resolve, reject) => {
      xhr.open("GET", `/article/123/replies?sort=${sort}`);
      xhr.responseType = "json";
      xhr.abort();
      const stateAfterAbort = xhr.readyState;
      xhr.onload = () => resolve({ stateAfterAbort, status: xhr.status,
        source: xhr.getResponseHeader("x-luogusp-source"), ids: xhr.response.replySlice.map(reply => reply.id) });
      xhr.onerror = reject;
      xhr.send();
    });
    return [await send("invalid"), await send("valid")];
  });
  assert.deepEqual(outcomes, [
    { stateAfterAbort: 1, status: 200, source: "saver", ids: [31] },
    { stateAfterAbort: 1, status: 200, source: null, ids: [99] },
  ]);
});

test("reconstructed article retains unrelated native XHR EventTarget behavior", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    reply(route, url) {
      if (url.origin === origin && url.pathname === "/fixture-xhr")
        return route.fulfill({ body: "native response", contentType: "text/plain" });
    },
  });
  await page.getByRole("button", { name: "Native action" }).waitFor();
  const result = await page.evaluate(async () => {
    const xhr = new XMLHttpRequest();
    const observed = [];
    const single = (event) => observed.push(["once", event.target === xhr, event.currentTarget === xhr, event.isTrusted]);
    const object = { handleEvent(event) { observed.push(["object", this === object, event instanceof ProgressEvent, event.isTrusted]); } };
    xhr.addEventListener("load", single, { once: true });
    xhr.addEventListener("load", object);
    xhr.addEventListener("fixture", (event) => event.preventDefault());
    const accepted = xhr.dispatchEvent(new Event("fixture", { cancelable: true }));
    const send = () => new Promise((resolve) => {
      xhr.addEventListener("loadend", () => resolve(xhr.responseText), { once: true });
      xhr.open("GET", "/fixture-xhr");
      xhr.send();
    });
    const first = await send();
    const second = await send();
    return [xhr instanceof EventTarget, first, second, accepted, observed];
  });
  assert.deepEqual(result, [true, "native response", "native response", false, [
    ["once", true, true, true], ["object", true, true, true], ["object", true, true, true],
  ]]);
});

test("restricted article fetch honors Request method, body and header overrides", async (t) => {
  const wire = [];
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    reply(route, url) {
      if (url.origin !== origin || url.pathname !== "/article/123/vote") return;
      const request = route.request();
      const headers = request.headers();
      wire.push({
        method: request.method(), body: request.postData(),
        override: headers["x-fixture-init"], replaced: headers["x-fixture-request"],
        csrf: headers["x-csrf-token"],
      });
      return route.fulfill({ json: { upvotes: 11, voted: 1 } });
    },
  });
  await page.getByRole("button", { name: "Native action" }).waitFor();
  const response = await page.evaluate(async () => {
    const request = new Request("/article/123/vote?vote=1", { headers: { "x-fixture-request": "original" } });
    const response = await fetch(request, {
      method: "POST", headers: { "x-fixture-init": "override" }, body: "fixture body",
    });
    return response.json();
  });
  assert.deepEqual(response, { upvotes: 11, voted: 1 });
  assert.deepEqual(wire, [{
    method: "POST", body: "fixture body", override: "override", replaced: undefined, csrf: "fixture-token",
  }]);
  await page.waitForFunction(() => {
    const entry = JSON.parse(localStorage.getItem("luogusp.article-interaction.v2") ?? "{}")["42:123"];
    return entry?.voted === 1 && entry.upvote === 11;
  });
});

test("restricted article warns when browser storage rejects a confirmed write", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    initScript: `
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "luogusp.article-interaction.v2" && !globalThis.allowArchiveSave)
          throw new DOMException("Fixture quota exceeded", "QuotaExceededError");
        return setItem.call(this, key, value);
      };
    `,
    reply(route, url) {
      if (url.origin === origin && url.pathname === "/article/123/favor") {
        return url.search
          ? route.fulfill({ contentType: "text/html", body: "Unconfirmed" })
          : route.fulfill({ json: { _empty: true } });
      }
      if (url.origin === origin && url.pathname === "/article/123/vote")
        return route.fulfill({ json: { upvotes: 1, voted: 1 } });
    },
  });
  await page.getByRole("button", { name: "Native action" }).waitFor();
  await page.evaluate(() => fetch("/article/123/favor?remove=1", { method: "POST" }));
  const uncertain = page.locator("#luogusp-rst-write-favor-unconfirmed");
  const unsaved = page.locator("#luogusp-rst-write-favor-unsaved");
  await uncertain.waitFor();
  assert.deepEqual(await page.evaluate(async () => {
    const response = await fetch("/article/123/favor", { method: "POST" });
    return response.json();
  }), { _empty: true });
  await unsaved.waitFor();
  assert.equal(await uncertain.count(), 0);
  assert.equal(await readArticleInteraction(page), undefined);
  await page.evaluate(async () => {
    globalThis.allowArchiveSave = true;
    await fetch("/article/123/vote?vote=1", { method: "POST" });
  });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("luogusp.article-interaction.v2"))["42:123"]?.voted === 1);
  assert.equal(await unsaved.count(), 1);
  await page.evaluate(() => fetch("/article/123/favor", { method: "POST" }));
  await unsaved.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Native action" }).click();
  await page.getByRole("button", { name: "Clicked" }).waitFor();
});

test("restricted native article is clickable without the optional time row", async (t) => {
  const { page, requests } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
  });
  const action = page.getByRole("button", { name: "Native action" });
  await action.waitFor();
  await page.locator("#luogusp-rst-loader").waitFor({ state: "detached", timeout: 1000 });
  await action.click();
  assert.equal(await page.getByRole("button", { name: "Clicked" }).count(), 1);
  assert.equal(await page.locator(".luogusp-rst-abtn").count(), 2);
  assert.deepEqual(scaffoldAttempts(requests), ["/ranking"]);
});

test("restricted archive actions work by keyboard with focus and status, and the viewport permits zoom", async (t) => {
  const refresh = responseGate(t);
  const saver = "https://api.luogu.me";
  const workflow = "/workflow/create/template/article-save-pipeline";
  const original = "https://www.luogu.com/article/123";
  const { page, requests } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    reply(route, url) {
      if (url.origin === saver && url.pathname === workflow)
        return refresh.promise.then(() => route.fulfill({
          headers: { "access-control-allow-origin": "*" }, json: { code: 202 },
        }));
    },
  });
  const actionBar = page.locator(".article-content .actions");
  const update = actionBar.getByRole("button", { name: "申请更新" });
  await update.waitFor();
  await actionBar.getByRole("button", { name: "Native action" }).focus();
  await page.keyboard.press("Tab");
  assert.ok(await focused(update));
  assert.equal(await update.evaluate((node) => getComputedStyle(node).outlineStyle), "solid");
  await page.keyboard.press("Space");
  const status = page.getByRole("status").filter({ hasText: "更新中…" });
  await status.waitFor({ state: "attached" });
  const busyUpdate = actionBar.getByRole("button", { name: "更新中…" });
  assert.ok(await focused(busyUpdate));
  assert.equal(await busyUpdate.getAttribute("aria-disabled"), "true");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const originalLink = actionBar.getByRole("link", { name: "国际站原文" });
  assert.ok(await focused(originalLink));
  assert.equal(await originalLink.getAttribute("href"), original);
  await page.context().route(original, (route) => route.fulfill({ body: "Fixture original" }));
  const opened = page.context().waitForEvent("page");
  await page.keyboard.press("Enter");
  const originalPage = await opened;
  await originalPage.waitForURL(original);
  await originalPage.close();
  refresh.release();
  await page.getByRole("status").filter({ hasText: "已申请" }).waitFor({ state: "attached" });
  assert.equal(requests.filter((entry) => entry.origin === saver && entry.path === workflow).length, 1);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  assert.equal(viewport, "width=device-width, initial-scale=1");
});

test("restricted early indicator stays static with reduced motion", async (t) => {
  const { page } = await fixture(t, {
    path: "/article/123", reducedMotion: "reduce", waitForSettings: false,
    html: `<!doctype html><meta charset="utf-8"><title>Native article</title>
      <script>
        window.earlyIndicator = {
          active: document.documentElement.classList.contains("luogusp-rst-preparing"),
          animation: getComputedStyle(document.documentElement, "::before").animationName,
          label: getComputedStyle(document.documentElement, "::after").content,
        };
      </script><p>Native content</p>`,
  });
  const early = await page.evaluate(() => window.earlyIndicator);
  assert.ok(early.active);
  assert.equal(early.animation, "none");
  assert.match(early.label, /加载/);
  await page.getByText("Native content").waitFor();
  assert.equal(await page.locator(".luogusp-rst-preparing").count(), 0);
});

test("restricted loader announces lookup, archive wait and native preparation with static reduced motion", async (t) => {
  const lookup = responseGate(t);
  const scaffold = responseGate(t);
  const headers = { "access-control-allow-origin": "*" };
  let lookups = 0;
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    reducedMotion: "reduce", useClock: true,
    nativeScript: `globalThis.mountArchive = () => { ${nativeArticle} };`,
    reply(route, url) {
      if (url.origin === "https://api.luogu.me") {
        if (url.pathname === "/article/query/123" && lookups++ === 0)
          return lookup.promise.then(() => route.fulfill({ headers, json: { code: 404 } }));
        if (url.pathname.startsWith("/workflow/create/"))
          return route.fulfill({ headers, json: { code: 202 } });
      }
      if (url.origin === origin && url.pathname === "/ranking")
        return scaffold.promise.then(() => route.fulfill({
          contentType: "text/html",
          body: `<script id="lentille-context" type="application/json">${JSON.stringify({ user: viewer })}</script>
            <meta name="csrf-token" content="fixture-token"><script src="https://fecdn.luogu.com.cn/fixture.js"></script>`,
        }));
    },
  });
  const status = page.locator("#luogusp-rst-loader").and(page.getByRole("status"));
  await page.clock.runFor(50);
  await status.getByText("正在查询保存站…").waitFor();
  const spinner = status.locator(".luogusp-rst-spinner");
  assert.equal(await spinner.evaluate(node => getComputedStyle(node).animationName), "none");
  lookup.release();
  await status.getByText("该内容尚未被保存站收录，已提交收录请求，正在等待…").waitFor();
  await page.clock.runFor(3000);
  await status.getByText("正在准备洛谷页面…").waitFor();
  scaffold.release();
  await status.getByText("正在加载洛谷页面…").waitFor();
  assert.equal(await spinner.evaluate(node => getComputedStyle(node).animationName), "none");
  await page.waitForFunction(() => typeof window.mountArchive === "function");
  await page.evaluate(() => window.mountArchive());
  await page.clock.runFor(50);
  await status.waitFor({ state: "detached" });
});

test("restricted article opens with malformed Saver comments and keeps usable replies", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    commentsPayload: { code: 200, data: { comments: [
      null,
      [32, "Wrong row type"],
      { id: true, content: "Boolean ID" },
      { id: "1e1", content: "Exponential ID" },
      { id: "9007199254740993", content: "Unsafe ID" },
      { id: 33, lid: "654", content: "Different article" },
      { id: 31, content: { toString: null } },
      { id: "31", content: "Saved first", time: 100, author: { id: 78 } },
      { id: "031", content: "Duplicate", time: 150 },
      { id: 32, content: "Saved second", time: "200", author: { id: "79", name: "Archive author" } },
      { id: 33, content: "Saved without metadata" },
    ] } },
    reply(route, url) {
      if (url.origin === origin && url.pathname === "/article/123/replies")
        return url.searchParams.has("native")
          ? route.fulfill({ json: { replySlice: [{ id: 99, content: "Live reply" }] } })
          : route.fulfill({ status: 403 });
    },
  });
  await page.getByText("Saved text").waitFor();
  const { article, canReply, canEdit } = JSON.parse(await page.locator("#lentille-context").textContent()).data;
  assert.deepEqual([article.replyCount, canReply, canEdit], [3, false, false]);
  const [fallback, next, official] = await page.evaluate(async () => {
    const getReplies = async query => {
      const response = await fetch(`/article/123/replies?${query}`);
      return [response.headers.get("x-luogusp-source"), (await response.json()).replySlice];
    };
    return Promise.all([getReplies("sort=time-d"), getReplies("sort=time-d&after=32"), getReplies("native=1")]);
  });
  assert.equal(fallback[0], "saver");
  assert.deepEqual(fallback[1].map(({ id, author, time, content }) => [id, author.uid, author.name, time, content]), [
    [32, 79, "Archive author", 200, "Saved second"],
    [31, 78, "用户 78", 100, "Saved first"],
    [33, 0, "用户 ?", 0, "Saved without metadata"],
  ]);
  assert.deepEqual(next[1].map(({ id }) => id), [31, 33]);
  assert.deepEqual(official, [null, [{ id: 99, content: "Live reply" }]]);
});

test("restricted article ignores Saver comments explicitly associated with a different article", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
    commentsPayload: { code: 200, data: { articleId: "654", comments: [
      { id: 31, content: "Another article's comment", time: 100, author: { id: 78 } },
    ] } },
    reply(route, url) {
      if (url.origin === origin && url.pathname === "/article/123/replies")
        return route.fulfill({ status: 403 });
    },
  });
  await page.getByText("Saved text").waitFor();
  assert.equal(JSON.parse(await page.locator("#lentille-context").textContent()).data.article.replyCount, 0);
  const replies = await page.evaluate(async () => (await fetch("/article/123/replies")).json());
  assert.deepEqual(replies, { replySlice: [] });
});

test("restricted native startup fails visibly when the native script mounts no content", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, { useClock: true });
  await page.locator("#lentille-context").waitFor({ state: "attached" });
  await page.clock.runFor(15000);
  await page.getByText("洛谷原生页面启动超时。").waitFor({ timeout: 1000 });
  assert.equal(await page.locator("#luogusp-rst-loader").count(), 0);
  assert.equal(await page.locator(".luogusp-rst-original").getAttribute("href"), "https://www.luogu.com/article/123");
});

test("restricted paste can display native content before its metadata row arrives", async (t) => {
  const { page } = await restrictedFixture(t, "paste", "abc", { id: "abc", content: "Saved paste" }, {
    nativeScript: nativePaste,
  });
  await page.getByText("Saved paste").waitFor();
  await page.locator("#luogusp-rst-loader").waitFor({ state: "detached", timeout: 1000 });
  await page.locator(".paste-show-card").evaluate((card) => {
    card.insertAdjacentHTML("afterbegin", '<div class="meta-row"><div class="meta-left"><span>发布时间</span></div></div>');
  });
  await page.getByRole("button", { name: "申请更新" }).waitFor();
});

test("restricted native startup watchdog is cleared when the route changes", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, { useClock: true });
  await page.locator("#lentille-context").waitFor({ state: "attached" });
  await page.evaluate(() => history.pushState({}, "", "/"));
  await page.clock.runFor(15000);
  assert.equal(await page.locator("#luogusp-rst-loader, .luogusp-rst-plaincard").count(), 0);
});

const restrictedStreams = `
  const restrictedFetch = globalThis.fetch;
  globalThis.restrictedTrace = [];
  const reportRestricted = (event, path) => {
    restrictedTrace.push([event, path, Date.now()]);
    window.dispatchEvent(new Event("restricted-activity"));
  };
  const restrictedStream = (signal, path, delay, body) => {
    const response = new Response(new ReadableStream({
      start(stream) {
        reportRestricted("headers", path);
        const timer = setTimeout(() => {
          stream.enqueue(new TextEncoder().encode(body));
          stream.close();
        }, delay);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reportRestricted("abort", path);
          stream.error(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }
    }), { headers: { "content-type": "text/html; charset=utf-8" } });
    Object.defineProperty(response, "url", { value: new URL(path, location.origin).href });
    return response;
  };
`;
const waitForRestrictedHeaders = (page, path) => page.evaluate((path) => new Promise((resolve) => {
  const check = () => {
    if (!restrictedTrace.some(([event, at]) => event === "headers" && at === path)) return;
    window.removeEventListener("restricted-activity", check);
    resolve();
  };
  window.addEventListener("restricted-activity", check);
  check();
}), path);
const stalledNative = restrictedStreams + `
  globalThis.fetch = (input, init) => {
    const path = new URL(input, location.origin).pathname;
    if (path === "/ranking" || path === "/api/user/search")
      return Promise.resolve(restrictedStream(init.signal, path, 60000, "{}"));
    return restrictedFetch(input, init);
  };
`;

test("restricted live-count cutoff aborts the list body and dispatches no later pages", async (t) => {
  const listPath = "/user/42/article";
  const { page } = await restrictedFixture(t, "article", "123", {
    ...archiveArticle, authorId: 42, category: 3, upvote: 19, favorCount: 17,
  }, {
    nativeScript: nativeArticle,
    useClock: true,
    initScript: restrictedStreams + `
      globalThis.fetch = (input, init) => {
        const url = new URL(input, location.origin);
        if (url.pathname === ${JSON.stringify(listPath)}) {
          return Promise.resolve(restrictedStream(init.signal, url.pathname, 3000,
            '{"data":{"articles":{"perPage":10,"count":100,"result":[]}}}'));
        }
        if (url.pathname === "/ranking")
          return Promise.resolve(restrictedStream(init.signal, url.pathname, 5000, ${JSON.stringify(nativeScaffold("/ranking"))}));
        return restrictedFetch(input, init);
      };
    `,
  });
  await page.clock.runFor(50);
  await waitForRestrictedHeaders(page, listPath);
  await waitForRestrictedHeaders(page, "/ranking");
  await page.clock.runFor(5500);
  await page.getByText("Saved text").waitFor();
  const trace = await page.evaluate(path => restrictedTrace.filter(entry => entry[1] === path), listPath);
  assert.equal(trace.length, 2);
  const [[startEvent, startPath, start], [endEvent, endPath, end]] = trace;
  assert.deepEqual([startEvent, startPath, endEvent, endPath, end - start], ["headers", listPath, "abort", listPath, 2500]);
  const { article } = JSON.parse(await page.locator("#lentille-context").textContent()).data;
  assert.deepEqual([article.upvote, article.favorCount], [19, 17]);
});

test("restricted native scaffold and author deadlines include streamed response bodies", async (t) => {
  const { page, requests } = await restrictedFixture(t, "article", "123", {
    ...archiveArticle, authorId: 42,
  }, { nativeScript: nativeArticle, useClock: true, initScript: stalledNative });
  await page.clock.runFor(50);
  await waitForRestrictedHeaders(page, "/ranking");
  await waitForRestrictedHeaders(page, "/api/user/search");
  await page.clock.runFor(15000);
  await page.getByText("Saved text").waitFor({ timeout: 1000 });
  const trace = await page.evaluate(() => restrictedTrace);
  for (const path of ["/ranking", "/api/user/search"]) {
    const [[, , start], [event, , end]] = trace.filter((entry) => entry[1] === path);
    assert.deepEqual([event, end - start], ["abort", 15000]);
  }
  assert.equal(requests.filter((request) => request.path === "/discuss").length, 1);
});

test("restricted route change aborts native response bodies", async (t) => {
  const { page, requests } = await restrictedFixture(t, "article", "123", {
    ...archiveArticle, authorId: 42,
  }, { useClock: true, initScript: stalledNative });
  await page.clock.runFor(50);
  await waitForRestrictedHeaders(page, "/ranking");
  await waitForRestrictedHeaders(page, "/api/user/search");
  await page.evaluate(() => history.pushState({}, "", "/"));
  assert.deepEqual(await page.evaluate(() => restrictedTrace
    .filter(([event]) => event === "abort").map(([, path]) => path).sort()), [
    "/api/user/search", "/ranking",
  ]);
  await page.clock.runFor(15000);
  assert.equal(await page.locator("#luogusp-rst-loader, .luogusp-rst-plaincard").count(), 0);
  assert.equal(requests.some((request) => request.path === "/discuss"), false);
});

test("restricted route change aborts the discussion scaffold fallback", async (t) => {
  const { page, requests } = await restrictedFixture(t, "paste", "abc", { id: "abc", content: "Saved paste" }, {
    useClock: true,
    initScript: restrictedStreams + `
      globalThis.fetch = (input, init) => {
        const url = new URL(input, location.origin);
        if (url.origin === location.origin && url.pathname === "/discuss")
          return Promise.resolve(restrictedStream(init.signal, url.pathname, 60000, "{}"));
        return restrictedFetch(input, init);
      };
    `,
    reply(route, url) {
      if (url.origin === origin && url.pathname === "/ranking")
        return route.fulfill({ body: brokenRankingScaffolds.context, contentType: "text/html" });
    },
  });
  await page.clock.runFor(50);
  await waitForRestrictedHeaders(page, "/discuss");
  assert.deepEqual(scaffoldAttempts(requests), ["/ranking"]);
  await page.evaluate(() => history.pushState({}, "", "/"));
  assert.deepEqual(await page.evaluate(() => restrictedTrace.map(([event, path]) => [event, path])), [
    ["headers", "/discuss"], ["abort", "/discuss"],
  ]);
  await page.clock.runFor(15000);
  assert.equal(await page.locator("#luogusp-rst-loader, .luogusp-rst-plaincard, #lentille-context").count(), 0);
});

const saverCreatePath = "/workflow/create/template/article-save-pipeline";
const saverActionDelay = 100;
const stalledSaver = restrictedStreams + `
  let restrictedQuery = 0;
  globalThis.fetch = (input, init) => {
    const url = new URL(input, location.origin);
    if (url.origin !== "https://api.luogu.me") return restrictedFetch(input, init);
    if (url.pathname === ${JSON.stringify(saverCreatePath)})
      return Promise.resolve(restrictedStream(init.signal, url.pathname, ${saverActionDelay}, '{"code":202}'));
    const query = restrictedQuery++;
    if (query === 0) return Promise.resolve(Response.json({ code: 404 }));
    const delay = [14000, 8000, 14000][query - 1] ?? 14000;
    return Promise.resolve(restrictedStream(init.signal, String(query), delay, '{"code":404}'));
  };
`;

async function waitForSaverAcceptance(page) {
  await page.clock.runFor(50);
  await waitForRestrictedHeaders(page, saverCreatePath);
  const accepted = page.locator("#luogusp-rst-loader").getByText("该内容尚未被保存站收录", { exact: false });
  assert.equal(await accepted.count(), 0);
  const elapsedSinceHeaders = await page.evaluate(() => Date.now() - restrictedTrace[0][2]);
  // Stop the clock at body delivery until the workflow confirms acceptance in the UI.
  await page.clock.runFor(saverActionDelay - elapsedSinceHeaders);
  await accepted.waitFor();
  return page.evaluate(() => Date.now());
}

test("restricted Saver post-acceptance deadline aborts an in-flight query at 45 seconds", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    useClock: true, initScript: stalledSaver,
  });
  const start = await waitForSaverAcceptance(page);
  await page.clock.runFor(45000);
  await page.getByText("保存站在限定时间内未能完成收录。").waitFor({ timeout: 1000 });
  const trace = await page.evaluate(() => restrictedTrace);
  assert.deepEqual(trace.map(([event, path, time]) => [event, path, time - start]), [
    ["headers", saverCreatePath, -saverActionDelay],
    ["headers", "1", 3000], ["headers", "2", 23000],
    ["headers", "3", 43000], ["abort", "3", 45000],
  ]);
});

test("restricted route change aborts the active Saver query without showing stale failure", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    useClock: true, initScript: stalledSaver,
  });
  await waitForSaverAcceptance(page);
  await page.clock.runFor(3000);
  await waitForRestrictedHeaders(page, "1");
  await page.evaluate(() => history.pushState({}, "", "/"));
  assert.deepEqual(await page.evaluate(() => restrictedTrace.slice(1).map(([event, path]) => [event, path])), [
    ["headers", "1"], ["abort", "1"],
  ]);
  await page.clock.runFor(45000);
  assert.equal(await page.locator("#luogusp-rst-loader, .luogusp-rst-plaincard").count(), 0);
  assert.equal(await page.evaluate(() => restrictedTrace.length), 3);
});

for (const persistent of [false, true]) {
  test(`settings reconciles a save interrupted by ${persistent ? "persistent" : "transient"} storage failure`, async (t) => {
    const { page } = await fixture(t, {
      html: FIXTURE_HTML,
      initScript: `
        const nativeSet = Storage.prototype.setItem;
        window.settingSaveWrites = 0;
        Storage.prototype.setItem = function (key, value) {
          if (this === localStorage && key.startsWith("LuoguSP.") && window.interruptSettingsSave) {
            const write = ++settingSaveWrites;
            if (write === 2 || (${persistent} && write > 2))
              throw new DOMException("Fixture storage quota", "QuotaExceededError");
          }
          return nativeSet.call(this, key, value);
        };
      `,
    });
    const entry = page.locator(".luogusp-setting-entry");
    await entry.press("Enter");
    const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
    const checkboxes = modal.getByRole("checkbox");
    const preferences = () => checkboxes.evaluateAll(nodes =>
      nodes.map(node => [node.checked, localStorage.getItem(node.dataset.key) === "true"]));
    const original = await preferences();
    assert.deepEqual(original, Array.from({ length: 6 }, () => [true, true]));

    const none = modal.getByRole("button", { name: "全不选" });
    const save = modal.getByRole("button", { name: "保存" });
    await none.press("Enter");
    await page.evaluate(() => { window.interruptSettingsSave = true; });
    await save.press("Enter");
    assert.deepEqual(await preferences(), persistent ? [[false, false], ...original.slice(1)] : original);
    assert.match(await modal.getByRole("status").textContent(), /保存失败/);
    assert.ok(await focused(save));
    assert.equal(await page.getByRole("alertdialog").count(), 0);

    await page.evaluate(() => { window.interruptSettingsSave = false; });
    await none.press("Enter");
    await save.press("Enter");
    await page.getByRole("alertdialog", { name: "设置已保存" }).getByRole("button", { name: "稍后" }).press("Enter");
    assert.ok(await focused(entry));
    await entry.press("Enter");
    assert.deepEqual(await preferences(), Array.from({ length: 6 }, () => [false, false]));
  });
}

test("settings traps focus and Enter chooses the focused refresh action", async (t) => {
  const { page, requests } = await fixture(t, { html: FIXTURE_HTML });
  const entry = page.locator(".luogusp-setting-entry");
  await entry.press("Space");
  const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
  const first = modal.getByRole("checkbox").first();
  assert.ok(await focused(first));
  await page.keyboard.press("Shift+Tab");
  assert.ok(await focused(modal.getByRole("button", { name: "关闭" })));
  await page.keyboard.press("Tab");
  assert.ok(await focused(first));
  await modal.getByRole("button", { name: "保存" }).click();
  const confirm = page.getByRole("alertdialog");
  const later = confirm.getByRole("button", { name: "稍后" });
  assert.ok(await focused(later));
  await page.keyboard.press("Enter");
  await confirm.waitFor({ state: "hidden" });
  assert.ok(await focused(entry));
  assert.equal(requests.filter(r => r.type === "document").length, 1);
  await entry.press("Enter");
  await modal.getByRole("button", { name: "保存" }).click();
  const reload = page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() });
  await confirm.getByRole("button", { name: "立即刷新" }).press("Enter");
  await reload;
  assert.equal(requests.filter(r => r.type === "document").length, 2);
  await entry.press("Enter");
  await modal.getByRole("button", { name: "保存" }).click();
  await page.evaluate(() => history.pushState({}, "", "/?next=1"));
  await confirm.waitFor({ state: "hidden" });
  await page.keyboard.press("Enter");
  assert.equal(requests.filter(r => r.type === "document").length, 2);
});

for (const phase of ["focused entry", "dialog", "confirmation", "delayed navigation", "focus moved",
  "delayed backdrop click", "delayed backdrop tap", "delayed backdrop with focus moved elsewhere"]) {
  test(`settings navigation replacement restores only owned focus during ${phase}`, async (t) => {
    const touch = phase.endsWith("tap");
    const { page } = await fixture(t, { html: fixtureHtml('<button id="elsewhere">Elsewhere</button>'), hasTouch: touch });
    const entry = page.locator(".luogusp-setting-entry");
    const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
    const confirmation = page.getByRole("alertdialog");
    const elsewhere = page.locator("#elsewhere");
    const delayed = phase.startsWith("delayed");
    const backdrop = phase.startsWith("delayed backdrop");
    if (phase === "focused entry") await entry.focus();
    else await entry.press("Enter");
    if (phase === "confirmation") await modal.getByRole("button", { name: "保存" }).press("Enter");
    if (phase === "focus moved") await elsewhere.focus();
    if (backdrop) assert.ok(await focused(modal.getByRole("checkbox").first()));

    await entry.evaluate((node, delayed) => {
      const nav = node.closest("nav");
      const replacement = nav.cloneNode(true);
      const clonedEntry = replacement.querySelector(".luogusp-setting-entry");
      (clonedEntry.closest("li") || clonedEntry).remove();
      if (delayed) {
        const host = nav.parentElement;
        nav.remove();
        window.restoreNavigation = () => host.appendChild(replacement);
      } else nav.replaceWith(replacement);
    }, delayed);
    if (phase !== "focused entry") {
      if (backdrop) {
        const mask = page.locator(".luogusp-mask");
        const position = { x: 2, y: 2 };
        if (touch) await mask.tap({ position });
        else await mask.click({ position });
      } else await page.keyboard.press("Escape");
      await (phase === "confirmation" ? confirmation : modal).waitFor({ state: "detached" });
    }
    if (backdrop) {
      assert.equal(await entry.count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.tagName), "BODY");
    }
    if (phase.endsWith("elsewhere")) {
      await elsewhere.focus();
      // Moving focus away must cancel restoration even if the user later blurs that control.
      await elsewhere.evaluate(node => node.blur());
    }
    if (delayed) await page.evaluate(() => window.restoreNavigation());
    await entry.waitFor();
    if (phase.endsWith("elsewhere")) assert.equal(await page.evaluate(() => document.activeElement.tagName), "BODY");
    else assert.ok(await focused(phase === "focus moved" ? elsewhere : entry));
  });
}

test("settings Save, refresh confirmation and hint meet normal text contrast", async (t) => {
  const { page } = await fixture(t, { html: FIXTURE_HTML, reducedMotion: "reduce" });
  const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
  await page.locator(".luogusp-setting-entry").press("Enter");
  const contrast = (locator) => locator.evaluate(node => {
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const srgb = Number(value) / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const text = luminance(getComputedStyle(node).color);
    let background = getComputedStyle(node).backgroundColor;
    for (let parent = node.parentElement; background === "rgba(0, 0, 0, 0)" && parent; parent = parent.parentElement)
      background = getComputedStyle(parent).backgroundColor;
    const fill = luminance(background);
    return (Math.max(text, fill) + .05) / (Math.min(text, fill) + .05);
  });
  const buttonStates = async (button) => {
    const resting = await contrast(button);
    const enabled = await button.isEnabled();
    await button.focus();
    const focus = await contrast(button);
    await button.hover();
    const hover = await contrast(button);
    await page.mouse.down();
    const active = await contrast(button);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    return { enabled, resting, focus, hover, active };
  };
  const save = modal.getByRole("button", { name: "保存", exact: true });
  const hint = await contrast(modal.getByText("保存后需刷新页面生效。", { exact: true }));
  const saveStates = await buttonStates(save);
  await save.press("Enter");
  const refresh = page.getByRole("alertdialog").getByRole("button", { name: "立即刷新" });
  const refreshStates = await buttonStates(refresh);
  assert.ok(saveStates.enabled && refreshStates.enabled);
  const ratios = [hint, ...[saveStates, refreshStates].flatMap(({ resting, focus, hover, active }) =>
    [resting, focus, hover, active])];
  assert.ok(ratios.every(value => value >= 4.5), JSON.stringify({ hint, saveStates, refreshStates }));
});

test("settings text keeps 4.5:1 contrast throughout its entrance", async (t) => {
  const { page } = await fixture(t, { html: FIXTURE_HTML, reducedMotion: "no-preference" });
  await page.addStyleTag({ content: `
    html, body { background: white; }
    #luogusp-settings .luogusp-panel[role=dialog] { animation-play-state: paused !important; }
  ` });
  await page.locator(".luogusp-setting-entry").press("Enter");
  const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
  const ratios = await modal.evaluate(panel => {
    const color = value => value.match(/[\d.]+/g).map(Number);
    const mix = (front, back, alpha) => back.map((value, i) => front[i] * alpha + value * (1 - alpha));
    const luminance = rgb => rgb.reduce((sum, value, i) => {
      const srgb = value / 255;
      const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      return sum + [0.2126, 0.7152, 0.0722][i] * linear;
    }, 0);
    const mask = color(getComputedStyle(panel.previousElementSibling).backgroundColor);
    const backdrop = mix(mask, [255, 255, 255], mask[3]);
    const [entrance] = panel.getAnimations();
    const duration = entrance.effect.getComputedTiming().duration;
    return [0, 0.25, 0.5, 0.75, 1].map(progress => {
      entrance.currentTime = duration * progress;
      const opacity = Number(getComputedStyle(panel).opacity);
      return [...panel.querySelectorAll("[data-act=save], .luogusp-hint")].map(node => {
        const text = color(getComputedStyle(node).color);
        const fill = color(getComputedStyle(node.matches("button") ? node : panel).backgroundColor);
        const levels = [text, fill].map(rgb => luminance(mix(rgb, backdrop, opacity)));
        return (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05);
      });
    });
  });
  assert.ok(ratios.flat().every(ratio => ratio >= 4.5), JSON.stringify(ratios));
  assert.ok(await focused(modal.getByRole("checkbox").first()));
});

test("settings fit small viewports and stay clickable above user previews", async (t) => {
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="user-link" style="position:fixed;left:120px;top:80px" href="/user/123">User</a>'),
    viewport: { width: 320, height: 480 },
    reply(route, url) {
      if (url.origin !== origin) return;
      const user = { uid: 123, name: "Layout fixture", slogan: "Some text", followerCount: 7 };
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: { user } });
      if (url.pathname === "/user/123") return route.fulfill({ json: { data: { user } } });
    },
  });
  const entry = page.locator(".luogusp-setting-entry");
  const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
  async function assertFits(locator) {
    const box = await locator.boundingBox();
    const size = page.viewportSize();
    assert.ok(box.x >= 0 && box.x + box.width <= size.width + 1, JSON.stringify(box));
    assert.ok(box.y >= 0 && box.y + box.height <= size.height + 1, JSON.stringify(box));
  }
  await entry.press("Enter");
  await assertFits(modal);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 640, height: 200 });
  await entry.press("Enter");
  await assertFits(modal);
  await modal.getByRole("button", { name: "关闭" }).click();
  assert.ok(await focused(entry));
  await page.locator("#user-link").press("Alt+ArrowDown");
  await card(page).getByRole("link", { name: "Layout fixture" }).waitFor();
  await assertFits(card(page));
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 640, height: 420 });
  await page.locator("#user-link").hover();
  await card(page).getByRole("link", { name: "Layout fixture" }).waitFor();
  await entry.press("Enter");
  const first = modal.getByRole("checkbox").first();
  const wasChecked = await first.isChecked();
  await first.click();
  assert.equal(await first.isChecked(), !wasChecked);
  await page.keyboard.press("Escape");
  assert.ok(await focused(entry));
});

test("settings and refresh confirmation follow mobile pinch zoom and viewport panning", async (t) => {
  const { page } = await fixture(t, {
    html: FIXTURE_HTML.replace("<head>", '<head><meta name="viewport" content="width=device-width, initial-scale=1">'),
    viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true,
  });
  const session = await page.context().newCDPSession(page);
  const entry = page.locator(".luogusp-setting-entry");
  const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
  async function assertInViewport(locator) {
    const state = await locator.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const view = window.visualViewport;
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        x: view.offsetLeft, y: view.offsetTop, width: view.width, height: view.height };
    });
    assert.ok(state.left >= state.x - 1 && state.right <= state.x + state.width + 1,
      JSON.stringify(state));
    assert.ok(state.top >= state.y - 1 && state.bottom <= state.y + state.height + 1,
      JSON.stringify(state));
  }
  const settle = () => page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await entry.press("Enter");
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await settle();
  assert.equal(await page.evaluate(() => visualViewport.scale), 2);
  await assertInViewport(modal);
  assert.ok(await focused(modal.getByRole("checkbox").first()));
  await page.evaluate(() => {
    const target = document.createElement("span");
    target.style.cssText = "position:fixed;left:300px;top:500px;width:1px;height:1px;";
    document.body.append(target);
    target.scrollIntoView({ block: "center", inline: "center" });
    target.remove();
  });
  await settle();
  const panned = await page.evaluate(() => [visualViewport.offsetLeft, visualViewport.offsetTop]);
  assert.ok(panned.some(value => value > 10), JSON.stringify(panned));
  await assertInViewport(modal);
  await page.keyboard.press("Shift+Tab");
  const close = modal.getByRole("button", { name: "关闭" });
  assert.ok(await focused(close));
  await settle();
  await assertInViewport(close);
  await page.keyboard.press("Tab");
  const stepsToSave = await modal.getByRole("checkbox").count() + 2;
  for (let index = 0; index < stepsToSave; index++) await page.keyboard.press("Tab");
  const save = modal.getByRole("button", { name: "保存" });
  assert.ok(await focused(save));
  await settle();
  await assertInViewport(save);
  await save.press("Enter");
  const confirm = page.getByRole("alertdialog");
  await assertInViewport(confirm);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 3 });
  await settle();
  await assertInViewport(confirm);
  await page.setViewportSize({ width: 640, height: 390 });
  await settle();
  await assertInViewport(confirm);
  const later = confirm.getByRole("button", { name: "稍后" });
  assert.ok(await focused(later));
  await assertInViewport(later);
  await later.press("Enter");
  assert.ok(await focused(entry));
});

test("settings opened after zoom release viewport listeners on close, save and navigation", async (t) => {
  const { page } = await fixture(t, {
    html: FIXTURE_HTML.replace("<head>", '<head><meta name="viewport" content="width=device-width, initial-scale=1">'),
    viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true,
    initScript: `
      const viewport = window.visualViewport;
      const listeners = new Map([["resize", new Set()], ["scroll", new Set()]]);
      const add = viewport.addEventListener.bind(viewport);
      const remove = viewport.removeEventListener.bind(viewport);
      viewport.addEventListener = (type, listener, options) => {
        listeners.get(type)?.add(listener);
        add(type, listener, options);
      };
      viewport.removeEventListener = (type, listener, options) => {
        listeners.get(type)?.delete(listener);
        remove(type, listener, options);
      };
      window.viewportListenerCounts = () => [...listeners.values()].map(set => set.size);
    `,
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  const counts = () => page.evaluate(() => viewportListenerCounts());
  const baseline = await counts();
  const entry = page.locator(".luogusp-setting-entry");
  const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
  for (const action of ["close", "save", "navigate"]) {
    await entry.press("Enter");
    assert.deepEqual(await counts(), baseline.map(count => count + 1));
    const fits = await modal.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const viewport = window.visualViewport;
      return rect.left >= viewport.offsetLeft && rect.top >= viewport.offsetTop &&
        rect.right <= viewport.offsetLeft + viewport.width + 1 &&
        rect.bottom <= viewport.offsetTop + viewport.height + 1;
    });
    assert.ok(fits);
    if (action === "navigate") {
      await page.evaluate(() => history.pushState({}, "", "/?settings-closed=1"));
      await modal.waitFor({ state: "detached" });
      await entry.waitFor();
    } else if (action === "save") {
      await modal.getByRole("button", { name: "保存" }).press("Enter");
      const confirm = page.getByRole("alertdialog");
      assert.deepEqual(await counts(), baseline.map(count => count + 1));
      await confirm.getByRole("button", { name: "稍后" }).press("Enter");
      assert.ok(await focused(entry));
    } else {
      await page.keyboard.press("Escape");
      assert.ok(await focused(entry));
    }
    assert.deepEqual(await counts(), baseline);
  }
});

test("settings and refresh confirmation fit when VisualViewport is unavailable", async (t) => {
  const { page } = await fixture(t, {
    html: FIXTURE_HTML, viewport: { width: 320, height: 220 },
    initScript: 'Object.defineProperty(window, "visualViewport", { value: undefined });',
  });
  const entry = page.locator(".luogusp-setting-entry");
  await entry.press("Enter");
  const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
  const box = await modal.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 321 && box.y + box.height <= 221);
  await modal.getByRole("button", { name: "保存" }).press("Enter");
  const confirm = page.getByRole("alertdialog");
  const later = confirm.getByRole("button", { name: "稍后" });
  assert.ok(await focused(later));
  const confirmBox = await confirm.boundingBox();
  assert.ok(confirmBox.x >= 0 && confirmBox.y >= 0 &&
    confirmBox.x + confirmBox.width <= 321 && confirmBox.y + confirmBox.height <= 221);
  await later.press("Enter");
  assert.ok(await focused(entry));
});

test("intro copy clears the previous success while another clipboard write is pending", async (t) => {
  const { page } = await fixture(t, {
    path: "/user/42", reducedMotion: "reduce",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction: "~~~cpp\nint main(){}\n~~~" } }),
    initScript: `
      window.clipboardWrites = [];
      Object.defineProperty(navigator, "clipboard", { value: {
        writeText: text => new Promise((resolve, reject) => clipboardWrites.push({ text, resolve, reject })),
      } });
    `,
  });
  const intro = page.locator(".luogusp-intro-card");
  const button = intro.getByRole("button", { name: "复制代码" });
  const status = intro.locator('.luogusp-copy-status[role="status"]');
  await button.waitFor();
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await button.press("Enter");
  await page.evaluate(() => clipboardWrites[0].resolve());
  assert.equal(await status.textContent(), "已复制");
  assert.ok(await button.evaluate(node => node.classList.contains("copied")));
  await button.press("Enter");
  assert.equal(await status.textContent(), "");
  assert.equal(await button.getAttribute("title"), "复制代码");
  assert.equal(await button.evaluate(node => node.classList.contains("copied")), false);
  await page.clock.runFor(2000);
  assert.equal(await button.getAttribute("title"), "复制代码");
  assert.equal(await button.evaluate(node => node.classList.contains("copied")), false);
  assert.ok(await focused(button));
  await page.evaluate(() => clipboardWrites[1].reject(new Error("Fixture clipboard denied")));
  assert.equal(await status.textContent(), "复制失败");
  await button.press("Enter");
  assert.equal(await button.getAttribute("title"), "复制代码");
  assert.equal(await status.textContent(), "");
  await page.evaluate(() => clipboardWrites[2].resolve());
  assert.equal(await status.textContent(), "已复制");
  assert.ok(await focused(button));
  await page.clock.runFor(1800);
  assert.equal(await status.textContent(), "");
  assert.equal(await button.getAttribute("title"), "复制代码");
  assert.equal(await button.evaluate(node => node.classList.contains("copied")), false);
  await button.press("Enter");
  await button.press("Enter");
  await page.evaluate(() => clipboardWrites[3].resolve());
  assert.equal(await status.textContent(), "");
  assert.equal(await button.getAttribute("title"), "复制代码");
  assert.equal(await button.evaluate(node => node.classList.contains("copied")), false);
  await page.evaluate(() => clipboardWrites[4].reject(new Error("Current fixture write denied")));
  assert.equal(await status.textContent(), "复制失败");
  await button.press("Enter");
  await button.press("Enter");
  await page.evaluate(() => clipboardWrites[5].reject(new Error("Superseded fixture write denied")));
  assert.equal(await status.textContent(), "");
  assert.equal(await button.getAttribute("title"), "复制代码");
  await page.evaluate(() => clipboardWrites[6].resolve());
  assert.equal(await status.textContent(), "已复制");
  assert.ok(await focused(button));
  await page.clock.runFor(1800);
  assert.equal(await button.getAttribute("title"), "复制代码");
  assert.equal(await button.evaluate(node => node.classList.contains("copied")), false);
});

test("intro copy announces failed and successful fallback without losing focus or animating", async (t) => {
  const { page } = await fixture(t, {
    path: "/user/42", reducedMotion: "reduce",
    html: fixtureHtml('<div class="sidebar-container"><div class="main"></div></div>',
      { user: { ...viewer, introduction: "~~~cpp\nint main(){}\n~~~" } }),
    initScript: 'Object.defineProperty(navigator, "clipboard", {value: undefined}); document.execCommand = () => window.copyWorks === true;',
  });
  const intro = page.locator(".luogusp-intro-card");
  const button = intro.getByRole("button", { name: "复制代码" });
  await button.press("Enter");
  assert.equal(await button.getAttribute("title"), "复制失败");
  assert.ok(await focused(button));
  assert.equal(await button.evaluate(node => getComputedStyle(node).transitionDuration), "0s");
  assert.equal(await intro.locator('.luogusp-copy-status[role="status"]').textContent(), "复制失败");
  await page.evaluate(() => { window.copyWorks = true; });
  await button.press("Enter");
  assert.equal(await intro.locator('.luogusp-copy-status[role="status"]').textContent(), "已复制");
  assert.ok(await focused(button));
});

for (const reducedMotion of ["no-preference", "reduce"]) {
  test(`settings dialog respects ${reducedMotion} without delaying keyboard focus`, async (t) => {
    const { page } = await fixture(t, { html: FIXTURE_HTML, reducedMotion });
    const entry = page.locator(".luogusp-setting-entry");
    await entry.press("Enter");
    const modal = page.getByRole("dialog", { name: "LuoguSP 功能设置" });
    const expected = reducedMotion === "reduce" ? ["none", "0s"] : ["luogusp-settings-in", "0.16s"];
    assert.deepEqual(await modal.evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.animationName, style.animationDuration];
    }), expected);
    assert.ok(await focused(modal.getByRole("checkbox").first()));
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "detached" });
    assert.ok(await focused(entry));
  });
}

const watchPreviewMotion = (preview, selector, label) => preview.evaluate((node, { selector, label }) => {
  window.previewMotion = new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (![...node.querySelectorAll(selector)].some((field) => field.textContent === label))
        return;
      observer.disconnect();
      resolve(node.getAnimations({ subtree: true }).map(({ effect }) => ({
        label: effect.target.querySelector(selector)?.textContent,
        duration: effect.getTiming().duration,
        properties: Object.keys(effect.getKeyframes()[0]).filter((name) =>
          !["offset", "computedOffset", "easing", "composite"].includes(name)),
      })));
    });
    observer.observe(node, { childList: true, subtree: true });
  });
}, { selector, label });

test("problem preview renders native fields first and patches late records in place", async (t) => {
  const detail = responseGate(t);
  const record = responseGate(t);
  const { page } = await fixture(t, {
    reducedMotion: "no-preference",
    viewport: { width: 900, height: 300 },
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return detail.promise.then(() => route.fulfill({
        json: { user: viewer, data: { problem: { ...problem, tags: Array.from({ length: 15 }, (_, i) => i + 1) } } },
      }));
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: {
        tags: Array.from({ length: 15 }, (_, i) => ({ id: i + 1, name: `Fixture tag ${i + 1}` })),
      } });
      if (url.pathname === "/record/list") return record.promise.then(() => route.fulfill({
        json: { template: "record.list", user: viewer, data: { records: { result: [{
          id: 77, problem: { pid: problem.pid }, user: viewer, submitTime: 1700000000, score: 100,
        }] } } },
      }));
    },
  });
  await page.locator("#problem").hover();
  const preview = card(page);
  await preview.getByText("P1000 Native preview", { exact: true }).waitFor();
  assert.equal(await preview.locator(".luogusp-hc-title span").evaluate(el => el.style.color), "rgb(243, 156, 17)");
  assert.match(await preview.textContent(), /120/);
  detail.release();
  const tags = preview.locator(".luogusp-hc-tagbtn");
  await tags.click();
  const oldButton = await tags.elementHandle();
  assert.ok(await focused(tags));
  const scrollTop = await preview.evaluate(el => { el.scrollTop = 30; return el.scrollTop; });
  assert.ok(scrollTop > 0);
  await watchPreviewMotion(preview, ".luogusp-hc-key", "上次尝试");
  record.release();
  await preview.getByText("上次尝试", { exact: true }).waitFor();
  assert.ok(await oldButton.evaluate(el => el === document.activeElement));
  assert.equal(await tags.getAttribute("aria-expanded"), "true");
  assert.equal(await preview.evaluate(el => el.scrollTop), scrollTop);
  const animations = await page.evaluate(() => window.previewMotion);
  assert.ok(animations.some(({ label }) => label === "上次尝试"));
  assert.ok(animations.every(({ label, duration, properties }) =>
    label && duration === 125 && properties.join() === "opacity"));
});

function previewActionGeometry(link) {
  return link.evaluate(node => {
    const scrollport = node.closest("#luogusp-hover-card");
    const top = scrollport.getBoundingClientRect().top + scrollport.clientTop;
    const bottom = top + scrollport.clientHeight;
    const rect = node.getBoundingClientRect();
    return {
      scrollTop: scrollport.scrollTop,
      above: top - rect.top,
      below: rect.bottom - bottom,
    };
  });
}

for (const height of [175, 420]) {
  test(`problem preview keeps its focused action visible after resizing to ${height}px`, async (t) => {
    const initial = {
      ...problem,
      name: "A problem title long enough to wrap inside the narrow preview",
      tags: [],
      submitted: true,
      accepted: true,
      bestRecord: { id: 77, status: 12, score: 100 },
      limits: { time: [1000], memory: [65536] },
    };
    const { page } = await fixture(t, {
      viewport: { width: 320, height: 480 },
      html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [initial] }),
      reply(route, url) {
        if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem: initial } } });
        if (url.pathname === "/record/list") return route.fulfill({ json: {
          template: "record.list", user: viewer, data: { records: { result: [] } },
        } });
      },
    });
    await page.locator("#problem").press("Alt+ArrowDown");
    const jump = card(page).getByRole("link", { name: "跳转题目" });
    await jump.waitFor();
    await page.keyboard.press("Tab");
    assert.ok(await focused(jump));
    const before = await previewActionGeometry(jump);
    assert.ok(Math.max(before.above, before.below) <= 1, JSON.stringify(before));
    const documentScroll = await page.evaluate(() => [scrollX, scrollY]);
    await page.setViewportSize({ width: 320, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await previewActionGeometry(jump);
    assert.ok(Math.max(after.above, after.below) <= 1, JSON.stringify({ before, after }));
    if (height === 175) assert.ok(after.scrollTop > before.scrollTop);
    else assert.equal(after.scrollTop, before.scrollTop);
    assert.ok(await focused(jump));
    assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), documentScroll);
  });
}

for (const wraps of [true, false]) {
  test(`problem preview keeps focused Show Tags visible after resizing with a ${wraps ? "wrapping" : "short"} title`, async (t) => {
    const initial = {
      ...problem,
      name: wraps ? "A long problem title that wraps in the preview ".repeat(5).trim() : problem.name,
      limits: { time: [1000], memory: [65536] },
    };
    const { page } = await fixture(t, {
      viewport: { width: 320, height: 480 },
      html: fixtureHtml('<div style="height:40px"></div><a id="problem" href="/problem/P1000">Problem</a>' +
        '<div style="height:100vh"></div>', { recommendations: [initial] }),
      reply(route, url) {
        if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem: initial } } });
        if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [{ id: 1, name: "Fixture tag" }] } });
        if (url.pathname === "/record/list") return route.fulfill({ json: {
          template: "record.list", user: viewer, data: { records: { result: [] } },
        } });
      },
    });
    const settleLayout = () => page.evaluate(() =>
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => window.scrollTo(0, 70));
    await settleLayout();
    await page.locator("#problem").press("Alt+ArrowDown");
    const tags = card(page).getByRole("button", { name: "显示标签" });
    await tags.waitFor();
    await page.keyboard.press("Tab");
    const button = await tags.elementHandle();
    assert.ok(await focused(tags));
    const before = await previewActionGeometry(tags);
    assert.ok(Math.max(before.above, before.below) <= 1, JSON.stringify(before));
    const documentScroll = await page.evaluate(() => [scrollX, scrollY]);
    assert.ok(documentScroll[1] > 0);
    await page.setViewportSize({ width: 320, height: 175 });
    await settleLayout();
    const after = await previewActionGeometry(tags);
    assert.ok(await button.evaluate(el => el === document.activeElement));
    assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), documentScroll);
    assert.ok(Math.max(after.above, after.below) <= 1, JSON.stringify({ before, after }));
    if (wraps) {
      assert.ok(after.scrollTop > before.scrollTop);
      assert.ok(Math.abs(after.below) <= 1, JSON.stringify(after));
    } else {
      assert.equal(after.scrollTop, before.scrollTop);
    }
  });
}

for (const [focusTags, height, lateRecord] of [
  [true, 175, false], [true, 175, true], [true, 480, false], [true, 480, true], [false, 480, false],
]) {
  test(`problem preview ${focusTags ? "restores focus when late detail removes its focused tags" :
    "retains another focused action when late detail removes tags"} at ${height}px${lateRecord ? " with a later record" : ""}`, async (t) => {
    const detail = responseGate(t);
    const record = responseGate(t);
    const latest = { id: 78, problem: { pid: problem.pid }, user: viewer, submitTime: 1700000000, score: 100 };
    const warmup = { ...problem, pid: "P1001" };
    const initial = {
      ...problem,
      name: "A problem title long enough to wrap inside the narrow preview",
      submitted: true,
      accepted: true,
      bestRecord: { id: 77, status: 12, score: 100 },
    };
    const { page } = await fixture(t, {
      viewport: { width: 320, height },
      html: fixtureHtml('<a id="warmup" href="/problem/P1001">Warmup</a> ' +
        '<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [warmup, initial] }),
      reply(route, url) {
        if (url.pathname === "/problem/P1001")
          return route.fulfill({ json: { user: viewer, data: { problem: warmup } } });
        if (url.pathname === "/problem/P1000") return detail.promise.then(() => route.fulfill({
          json: { user: viewer, data: { bookmarked: true, problem: {
            ...initial, tags: [], limits: { time: [1000], memory: [65536] },
          } } },
        }));
        if (url.pathname === "/_lfe/tags")
          return route.fulfill({ json: { tags: [{ id: 1, name: "Fixture tag" }] } });
        if (url.pathname === "/record/list") {
          const isLateRecord = lateRecord && url.searchParams.get("pid") === problem.pid;
          const respond = () => route.fulfill({
            json: { template: "record.list", user: viewer, data: { records: { result: isLateRecord ? [latest] : [] } } },
          });
          return isLateRecord ? record.promise.then(respond) : respond();
        }
      },
    });
    const preview = card(page);
    const tags = preview.getByRole("button", { name: "显示标签" });
    await page.locator("#warmup").press("Alt+ArrowDown");
    await tags.waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#problem").press("Alt+ArrowDown");
    await tags.waitFor();
    const best = preview.getByRole("link", { name: "最佳提交" });
    const jump = preview.getByRole("link", { name: "跳转题目" });
    await page.keyboard.press("Tab");
    assert.ok(await focused(tags));
    if (!focusTags) {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      assert.ok(await focused(best));
    }
    const documentScroll = await page.evaluate(() => [scrollX, scrollY]);
    const scrollTop = await preview.evaluate(node => node.scrollTop);
    detail.release();
    await tags.waitFor({ state: "detached" });
    await preview.waitFor();
    const current = focusTags ? jump : best;
    assert.ok(await focused(current));
    if (focusTags) {
      const geometry = await previewActionGeometry(current);
      assert.ok(Math.max(geometry.above, geometry.below) <= 1, JSON.stringify(geometry));
    } else {
      assert.equal(await preview.evaluate(node => node.scrollTop), scrollTop);
    }
    assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), documentScroll);

    if (lateRecord) {
      const beforeRecord = await previewActionGeometry(current);
      record.release();
      await preview.getByText("上次尝试", { exact: true }).waitFor();
      const afterRecord = await previewActionGeometry(current);
      assert.ok(Math.max(afterRecord.above, afterRecord.below) <= 1, JSON.stringify({ beforeRecord, afterRecord }));
      if (height === 175) {
        assert.ok(afterRecord.scrollTop > beforeRecord.scrollTop, JSON.stringify({ beforeRecord, afterRecord }));
        assert.ok(Math.abs(afterRecord.below) <= 1, JSON.stringify(afterRecord));
      } else {
        assert.equal(afterRecord.scrollTop, beforeRecord.scrollTop);
      }
      assert.ok(await focused(current));
      assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), documentScroll);
    }
  });
}

for (const reverseOpen of [false, true]) test(
  `problem preview keeps the later native record send within one millisecond (reverse open: ${reverseOpen})`,
  async (t) => {
  const firstStarted = responseGate(t);
  const firstResponse = responseGate(t);
  const query = `/record/list?user=${viewer.uid}&pid=${problem.pid}`;
  let nativeLists = 0;
  const { page, requests } = await fixture(t, {
    initScript: "Date.now = () => 1000;",
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem } } });
      if (url.pathname === "/record/list") {
        const respond = (id, score) => route.fulfill({ json: { template: "record.list", user: viewer,
          data: { records: { result: [{ id, score, submitTime: 1700000000 + id, user: viewer, problem }] } },
        } });
        if (route.request().resourceType() !== "xhr") return respond(79, 75);
        if (++nativeLists === 1) {
          firstStarted.release();
          return firstResponse.promise.then(() => respond(77, 25));
        }
        return respond(78, 50);
      }
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
    },
  });
  const send = (xhr) => new Promise((resolve, reject) => {
    xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.send();
  });
  const open = (path) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path);
    return xhr;
  };
  let newerRequest = reverseOpen ? await page.evaluateHandle(open, query) : null;
  const olderRequest = await page.evaluateHandle(open, query);
  const older = page.evaluate(send, olderRequest);
  await firstStarted.promise;
  newerRequest ??= await page.evaluateHandle(open, query);
  await page.evaluate(send, newerRequest);
  firstResponse.release();
  await older;
  await page.locator("#problem").press("Alt+ArrowDown");
  const preview = card(page);
  await preview.getByText("上次尝试", { exact: true }).waitFor();
  assert.match(await preview.textContent(), /50 分/);
  assert.deepEqual(requests.filter(({ path }) => path === "/record/list").map(({ type }) => type), ["xhr", "xhr"]);
});

for (const [empty, evict, denied = false] of [[false, false], [true, false], [false, true], [true, true], [false, true, true]])
test(`open problem preview keeps a newer native record over a pending fallback (${empty}, eviction: ${evict}, 403: ${denied})`, async (t) => {
  const fallbackStarted = responseGate(t);
  const fallbackResponse = responseGate(t);
  let fetchCount = 0;
  const path = `/record/list?user=${viewer.uid}&pid=${problem.pid}`;
  const payload = (result) => ({ template: "record.list", user: viewer, data: { records: { result } } });
  const row = (score) => ({ id: score, problem, user: viewer, submitTime: 1700000000 + score, score });
  const { page, requests } = await fixture(t, {
    initScript: `
      Date.now = () => 1000;
      const nativeFetchForRecords = window.fetch;
      window.fetch = async (...args) => {
        const response = await nativeFetchForRecords(...args);
        if (new URL(response.url).pathname === "/record/list") {
          if (response.status === 403) setTimeout(() => { window.recordFallbackDecoded = true; }, 0);
          const decode = response.json.bind(response);
          response.json = async () => {
            const value = await decode();
            setTimeout(() => { window.recordFallbackDecoded = true; }, 0);
            return value;
          };
        }
        return response;
      };`,
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem } } });
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
      if (url.pathname !== "/record/list") return;
      if (route.request().resourceType() === "xhr")
        return route.fulfill({ json: payload(empty || url.searchParams.get("pid") !== problem.pid ? [] : [row(50)]) });
      if (++fetchCount > 1) return route.fulfill({ json: payload(empty ? [] : [row(50)]) });
      fallbackStarted.release();
      return fallbackResponse.promise.then(() => route.fulfill(denied ? { status: 403 } : { json: payload([row(25)]) }));
    },
  });
  await page.locator("#problem").press("Alt+ArrowDown");
  await fallbackStarted.promise;
  await page.evaluate((path) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path);
    xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.send();
  }), path);
  const shown = card(page);
  if (!empty) await shown.getByText(/50 分/).waitFor();
  if (evict) await page.evaluate(async ({ uid }) => {
    for (let id = 1100; id < 1130; id++) await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `/record/list?user=${uid}&pid=P${id}`);
      xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
      xhr.send();
    });
  }, viewer);
  fallbackResponse.release();
  await page.waitForFunction(() => window.recordFallbackDecoded);
  assert.doesNotMatch(await shown.textContent(), /25 分/);
  if (empty) assert.equal(await shown.getByText("上次尝试", { exact: true }).count(), 0);
  else assert.match(await shown.textContent(), /50 分/);
  const lookups = requests.filter(request => request.path === "/record/list");
  assert.deepEqual(lookups.filter(request => new URLSearchParams(request.query).get("pid") === problem.pid)
    .map(request => request.type), ["fetch", "xhr"]);
  assert.equal(lookups.length, evict ? 32 : 2);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { window.recordFallbackDecoded = false; });
  await page.locator("#problem").press("Alt+ArrowDown");
  if (evict) await page.waitForFunction(() => window.recordFallbackDecoded, null, { timeout: 2000 });
  assert.doesNotMatch(await shown.textContent(), /25 分/);
  if (empty) assert.equal(await shown.getByText("上次尝试", { exact: true }).count(), 0);
  else await shown.getByText(/50 分/).waitFor();
  assert.equal(fetchCount, evict ? 2 : 1);
});

for (const mode of ["legacy switch", "legacy round trip", "eviction and close"])
test(`a held native record cannot reappear after ${mode}`, async (t) => {
  const legacy = mode !== "eviction and close";
  const started = responseGate(t);
  const release = responseGate(t);
  const readers = [];
  const { page } = await fixture(t, {
    initScript: legacy ? "window._feInjection = { currentUser: { uid: 42 } };" : "",
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] },
      legacy ? { user: undefined } : {}),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { data: { problem } } });
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: { user: { uid: 123 } } });
      if (url.pathname !== "/record/list") return;
      const user = { uid: Number(url.searchParams.get("user")) };
      const respond = (score) => route.fulfill({ json: { template: "record.list", user,
        data: { records: { result: score ? [{ id: score, score, user, problem, submitTime: 1700000000 }] : [] } },
      } });
      if (route.request().resourceType() === "fetch") {
        readers.push(user.uid);
        return respond(readers.length === 1 ? 10 : 60);
      }
      if (url.searchParams.has("held")) {
        started.release();
        return release.promise.then(() => respond(25));
      }
      return respond(url.searchParams.get("pid") === problem.pid ? 50 : 0);
    },
  });
  const trigger = page.locator("#problem");
  const preview = card(page);
  const path = `/record/list?user=${viewer.uid}&pid=${problem.pid}`;
  const xhr = (path) => page.evaluate(path => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", path);
    request.onloadend = () => request.status === 200 ? resolve() : reject(new Error(`HTTP ${request.status}`));
    request.send();
  }), path);
  await trigger.press("Alt+ArrowDown");
  await preview.getByText(/10 分/).waitFor();
  const held = xhr(path + "&held=1");
  void held.catch(() => {});
  await started.promise;
  let uid = viewer.uid;
  if (legacy) {
    for (const next of mode === "legacy switch" ? [43] : [43, 42]) {
      uid = next;
      await page.evaluate(uid => { window._feInjection.currentUser.uid = uid; }, uid);
      await xhr("/api/user/info/123");
      assert.equal(await preview.isVisible(), false);
    }
  } else {
    await xhr(path);
    await preview.getByText(/50 分/).waitFor();
    for (let i = 0; i < 30; i++) await xhr(`/record/list?user=${uid}&pid=P${1100 + i}`);
    await page.keyboard.press("Escape");
  }
  release.release();
  await held;
  await trigger.press("Alt+ArrowDown");
  await preview.getByText(/60 分/).waitFor();
  assert.deepEqual(readers, [viewer.uid, uid]);
});

test("an observed viewer change dismisses a rendered problem preview and restores focus", async (t) => {
  const { page, requests } = await fixture(t, {
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] }),
    reply(route, url) {
      const uid = Number(url.searchParams.get("fixtureViewer") ?? url.searchParams.get("user")) || viewer.uid;
      const user = { uid };
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { data: { problem } } });
      if (url.pathname === "/problem/list") return route.fulfill({ json: {
        user, template: "problem.list", data: { problems: { result: [problem] } },
      } });
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
      if (url.pathname === "/record/list") return route.fulfill({ json: {
        user, template: "record.list",
        data: { records: { result: [{ id: uid, user, problem, submitTime: 1700000000, score: uid === viewer.uid ? 50 : 60 }] } },
      } });
    },
  });
  const trigger = page.locator("#problem");
  const preview = card(page);
  await trigger.press("Alt+ArrowDown");
  await preview.getByText(/50 分/).waitFor();
  const observe = (uid) => page.evaluate((id) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/problem/list?fixtureViewer=" + id);
    xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error("HTTP " + xhr.status));
    xhr.send();
  }), uid);
  await observe(viewer.uid);
  assert.ok(await preview.getByText(/50 分/).isVisible());
  await observe(viewer.uid + 1);
  assert.equal(await preview.isVisible(), false);
  assert.ok(await focused(trigger));
  await trigger.press("Alt+ArrowDown");
  await preview.getByText(/60 分/).waitFor();
  assert.deepEqual(requests.filter(r => r.path === "/record/list").map(r => new URLSearchParams(r.query).get("user")),
    [String(viewer.uid), String(viewer.uid + 1)]);
});

for (const mode of ["rejected reopen", "send in OPENED"]) test(`native record observation survives ${mode}`, async (t) => {
  const { page, requests } = await fixture(t, {
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem } } });
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
      if (url.pathname === "/record/list") {
        const score = route.request().resourceType() === "xhr" ? 50 : 25;
        return route.fulfill({ json: { template: "record.list", user: viewer,
          data: { records: { result: [{ id: score, user: viewer, problem, submitTime: 1700000000, score }] } },
        } });
      }
    },
  });
  const seen = await page.evaluate(({ url, mode }) => new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    const events = [];
    xhr.onload = () => events.push("load");
    xhr.onloadend = () => resolve([xhr.status, ...events, "loadend"]);
    if (mode === "send in OPENED") {
      xhr.onreadystatechange = () => { if (xhr.readyState === XMLHttpRequest.OPENED) xhr.send(); };
      xhr.open("GET", url);
      return;
    }
    xhr.open("GET", url);
    xhr.send();
    try { xhr.open("GET", "http://["); } catch (error) { events.push(error.name); }
  }), { url: `/record/list?user=${viewer.uid}&pid=${problem.pid}`, mode });
  assert.deepEqual(seen, mode === "rejected reopen" ? [200, "SyntaxError", "load", "loadend"] : [200, "load", "loadend"]);
  await page.locator("#problem").press("Alt+ArrowDown");
  const preview = card(page);
  await preview.getByText("上次尝试", { exact: true }).waitFor();
  assert.match(await preview.textContent(), /50 分/);
  assert.deepEqual(requests.filter(request => request.path === "/record/list").map(request => request.type), ["xhr"]);
});

test("an open problem preview cancels its pending record fallback when the viewer changes", async (t) => {
  const fallbackStarted = responseGate(t);
  const fallbackResponse = responseGate(t);
  let recordReads = 0;
  const { page, requests } = await fixture(t, {
    initScript: `
      const nativeFetchForRecords = window.fetch;
      window.fetch = (url, options) => {
        if (new URL(url, location.href).pathname === "/record/list")
          options?.signal?.addEventListener("abort", () => { window.recordFallbackAborted = true; }, { once: true });
        return nativeFetchForRecords(url, options);
      };`,
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem } } });
      if (url.pathname === "/problem/list") return route.fulfill({ json: {
        template: "problem.list", user: { uid: Number(url.searchParams.get("fixtureViewer")) },
        data: { problems: { result: [problem] } },
      } });
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
      if (url.pathname === "/record/list") {
        const score = ++recordReads === 1 ? 25 : 60;
        const respond = () => route.fulfill({ json: { template: "record.list", user: viewer,
          data: { records: { result: [{ id: score, problem, user: viewer, submitTime: 1700000000, score }] } },
        } });
        if (score === 60) return respond();
        fallbackStarted.release();
        return fallbackResponse.promise.then(respond);
      }
    },
  });
  await page.locator("#problem").press("Alt+ArrowDown");
  await fallbackStarted.promise;
  await page.evaluate(async (uid) => {
    for (const id of [uid + 1, uid]) await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `/problem/list?fixtureViewer=${id}`);
      xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
      xhr.send();
    });
  }, viewer.uid);
  await page.waitForFunction(() => window.recordFallbackAborted);
  assert.equal(await card(page).isVisible(), false);
  fallbackResponse.release();
  await page.locator("#problem").press("Alt+ArrowDown");
  await card(page).getByText(/60 分/).waitFor();
  assert.doesNotMatch(await card(page).textContent(), /25 分/);
  assert.equal(requests.filter(request => request.path === "/record/list").length, 2);
});

for (const phase of ["load", "loadend"]) test(`native record observation survives reuse in ${phase}`, async (t) => {
  let nativeRequests = 0;
  const { page, requests } = await fixture(t, {
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem } } });
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
      if (url.pathname === "/record/list") {
        const score = route.request().resourceType() === "xhr" ? (++nativeRequests === 1 ? 25 : 60) : 99;
        return route.fulfill({ json: { template: "record.list", user: viewer,
          data: { records: { result: [{ id: score, user: viewer, problem, submitTime: 1700000000, score }] } },
        } });
      }
    },
  });
  const status = await page.evaluate(({ path, phase }) => new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    const completed = [];
    xhr.addEventListener("loadend", () => {
      completed.push(xhr.status);
      if (completed.length === 2) resolve(completed);
    });
    xhr.addEventListener(phase, () => {
      xhr.open("GET", path);
      xhr.send();
    }, { once: true });
    xhr.open("GET", path);
    xhr.send();
  }), { path: `/record/list?user=${viewer.uid}&pid=${problem.pid}`, phase });
  assert.deepEqual(status, [phase === "load" ? 0 : 200, 200]);
  await page.locator("#problem").press("Alt+ArrowDown");
  const preview = card(page);
  await preview.getByText("上次尝试", { exact: true }).waitFor();
  assert.match(await preview.textContent(), /60 分/);
  assert.deepEqual(requests.filter(request => request.path === "/record/list").map(request => request.type), ["xhr", "xhr"]);
});

test("problem preview loading and late fields stay static with reduced motion", async (t) => {
  const detail = responseGate(t);
  const record = responseGate(t);
  const { page } = await fixture(t, {
    reducedMotion: "reduce",
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>'),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return detail.promise.then(() => route.fulfill({
        json: { user: viewer, data: { problem: { ...problem, tags: [] } } },
      }));
      if (url.pathname === "/record/list") return record.promise.then(() => route.fulfill({
        json: { template: "record.list", user: viewer, data: { records: { result: [{
          id: 77, problem: { pid: problem.pid }, user: viewer, submitTime: 1700000000, score: 100,
        }] } } },
      }));
    },
  });
  await page.locator("#problem").hover();
  const preview = card(page);
  const spinner = preview.locator(".luogusp-hc-spin");
  await spinner.waitFor();
  assert.equal(await spinner.evaluate((node) => getComputedStyle(node).animationName), "none");
  await preview.getByRole("status").getByText("正在加载预览…").waitFor();
  detail.release();
  await preview.getByText("P1000 Native preview", { exact: true }).waitFor();
  await watchPreviewMotion(preview, ".luogusp-hc-key", "上次尝试");
  record.release();
  await preview.getByText("上次尝试", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.previewMotion), []);
});

for (const [kind, firstDetail, firstTitle] of [
  ["an empty", {}, "拿不到这条数据。"],
  ["a partial", { pid: problem.pid, difficulty: problem.difficulty }, problem.pid],
]) {
  test(`problem preview retries ${kind} detail on reopening and caches the usable detail`, async (t) => {
    let detailReads = 0;
    const { page } = await fixture(t, {
      html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>'),
      reply(route, url) {
        if (url.pathname === "/problem/P1000") return route.fulfill({ json: {
          user: viewer,
          data: { problem: ++detailReads === 1 ? firstDetail : { ...problem, name: "Recovered title", tags: [] } },
        } });
        if (url.pathname === "/record/list") return route.fulfill({
          json: { template: "record.list", user: viewer, data: { records: { result: [] } } },
        });
      },
    });
    const trigger = page.locator("#problem");
    const preview = card(page);
    const recovered = preview.getByText("P1000 Recovered title", { exact: true });
    await trigger.press("Alt+ArrowDown");
    await preview.getByText(firstTitle, { exact: true }).waitFor();
    assert.equal(detailReads, 1);
    await page.keyboard.press("Escape");
    await trigger.press("Alt+ArrowDown");
    await recovered.waitFor();
    assert.equal(detailReads, 2);
    await page.keyboard.press("Escape");
    await trigger.press("Alt+ArrowDown");
    await recovered.waitFor();
    assert.equal(detailReads, 2);
  });
}

test("a later partial problem detail leaves newer summary fields visible", async (t) => {
  let detailReads = 0;
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>'),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") {
        const detail = route.request().resourceType() === "xhr"
          ? { pid: problem.pid, difficulty: 4 }
          : { ...problem, name: "Original title", accepted: false, totalAccepted: 12 };
        if (route.request().resourceType() === "fetch") detailReads++;
        return route.fulfill({ json: { user: viewer, data: { problem: detail } } });
      }
      if (url.pathname === "/training/100") return route.fulfill({
        json: { user: viewer, data: { training: { problems: [
          { ...problem, name: "Updated title", accepted: true, totalAccepted: 13 },
        ] } } },
      });
      if (url.pathname === "/record/list") return route.fulfill({
        json: { template: "record.list", user: viewer, data: { records: { result: [] } } },
      });
    },
  });
  const trigger = page.locator("#problem");
  const preview = card(page);
  const open = async (title) => {
    await trigger.press("Alt+ArrowDown");
    await preview.getByText(`${problem.pid} ${title}`, { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "hidden" });
  };
  const readNative = async (path) => {
    assert.equal(await page.evaluate((endpoint) => new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", endpoint);
      xhr.onloadend = () => resolve(xhr.status);
      xhr.send();
    }), path), 200);
  };
  await open("Original title");
  await readNative("/training/100");
  await open("Updated title");
  await readNative("/problem/P1000?view=latest");
  await open("Updated title");
  assert.equal(detailReads, 1);
});

test("problem preview leaves unsupported native XHR media to the direct lookup", async (t) => {
  const detail = responseGate(t);
  const { page, requests } = await fixture(t, {
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>'),
    reply(route, url) {
      if (url.pathname === "/training/100") return route.fulfill({
        contentType: "text/plain",
        body: JSON.stringify({ user: viewer, data: { training: { problems: [problem] } } }),
      });
      if (url.pathname === "/problem/P1000") return detail.promise.then(() => route.fulfill({ json: {
        user: viewer, data: { problem: { ...problem, name: "Direct problem detail", tags: [] } },
      } }));
      if (url.pathname === "/record/list") return route.fulfill({
        json: { template: "record.list", user: viewer, data: { records: { result: [] } } },
      });
    },
  });
  assert.equal(await page.evaluate(() => new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/training/100");
    xhr.onloadend = () => resolve(xhr.status);
    xhr.send();
  })), 200);
  const direct = page.waitForRequest(request => new URL(request.url()).pathname === "/problem/P1000");
  await page.locator("#problem").press("Alt+ArrowDown");
  await direct;
  const preview = card(page);
  await preview.getByRole("status").getByText("正在加载预览…").waitFor();
  assert.equal(await preview.getByText("P1000 Native preview", { exact: true }).count(), 0);
  detail.release();
  await preview.getByText("P1000 Direct problem detail", { exact: true }).waitFor();
  assert.deepEqual(requests.filter(r => ["/training/100", "/problem/P1000"].includes(r.path)).map(r => r.type),
    ["xhr", "fetch"]);
});

test("problem preview retries a failed record lookup on reopening and caches the recovery", async (t) => {
  const recovery = responseGate(t);
  const summary = { ...problem, tags: [] };
  let recordReads = 0;
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [summary] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000")
        return route.fulfill({ json: { user: viewer, data: { problem: summary } } });
      if (url.pathname !== "/record/list") return;
      if (++recordReads === 1) return route.fulfill({ status: 503, json: {} });
      return recovery.promise.then(() => route.fulfill({ json: {
        template: "record.list", user: viewer, data: { records: { result: [{
          id: 77, user: viewer, problem: summary, submitTime: 1700000000, score: 100,
        }] } },
      } }));
    },
  });
  const link = page.locator("#problem");
  const preview = card(page);
  const title = preview.getByText("P1000 Native preview", { exact: true });
  const lastAttempt = preview.getByText("上次尝试", { exact: true });
  const failed = page.waitForResponse(response => response.url().includes("/record/list?") && response.status() === 503);
  await link.press("Alt+ArrowDown");
  await title.waitFor();
  await (await failed).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await lastAttempt.count(), 0);

  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  const retried = page.waitForRequest(request => request.url().includes("/record/list?"));
  await link.press("Alt+ArrowDown");
  await title.waitFor();
  await retried;
  assert.equal(await lastAttempt.count(), 0);
  recovery.release();
  await lastAttempt.waitFor();

  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  await link.press("Alt+ArrowDown");
  await lastAttempt.waitFor();
  assert.equal(recordReads, 2);
});

test("keyboard opens a cold preview, enters its links and returns focus on Escape", async (t) => {
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="problem" href="/problem/P1000">Problem</a>', { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem } } });
      if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
      if (url.pathname === "/record/list") return route.fulfill({ json: { template: "record.list", user: viewer, data: { records: { result: [] } } } });
    },
  });
  const trigger = page.locator("#problem");
  await trigger.press("Alt+ArrowDown");
  const preview = page.getByRole("dialog", { name: "题目预览" });
  const action = preview.getByRole("link", { name: "跳转题目" });
  await action.waitFor();
  assert.ok(await focused(preview));
  await page.keyboard.press("Tab");
  assert.ok(await focused(action));
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  assert.ok(await focused(trigger));
});

test("moving to the same PID in a contest follows the new anchor and URL", async (t) => {
  const { page, requests } = await fixture(t, {
    html: fixtureHtml(`<a id="plain" href="/problem/P1000">General</a>
      <a id="contest" style="margin-left:400px" href="/problem/P1000?contestId=100&amp;lang=en">Contest</a>`),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem: {
        ...problem, tags: [], name: url.searchParams.has("contestId") ? "Contest context" : "General context",
      } } } });
      if (url.pathname === "/record/list") return route.fulfill({ json: { template: "record.list", user: viewer, data: { records: { result: [] } } } });
    },
  });
  const preview = card(page);
  await page.locator("#plain").hover();
  await preview.getByText("P1000 General context", { exact: true }).waitFor();
  const firstX = (await preview.boundingBox()).x;
  await page.locator("#contest").hover();
  await preview.getByText("P1000 Contest context", { exact: true }).waitFor();
  assert.ok((await preview.boundingBox()).x > firstX + 300);
  assert.equal(await preview.getByRole("link", { name: "跳转题目" }).getAttribute("href"),
    `${origin}/problem/P1000?contestId=100&lang=en`);
  assert.ok(requests.some(r => r.path === "/problem/P1000" && r.query.includes("contestId=100&lang=en")));
});

test("recent discussion problem links open the corresponding problem preview", async (t) => {
  const { page, requests } = await fixture(t, {
    html: fixtureHtml(`<section><h2>最近讨论</h2>
      <a id="forum" href="/discuss?forum=P1000">P1000 题名…</a>
      <a href="/discuss?forum=academics">学术版</a>
      <a href="/discuss?forum=P1000">P2000 其他题目</a>
      <a href="/discuss?sort=latest&amp;forum=P1000&amp;forum=P2000">P1000 重复参数</a>
      <a href="/search?q=problem&amp;forum=P1000">P1000 其他页面</a>
      <a href="https://example.invalid/discuss?forum=P1000" data-luogusp-pid="P1000">P1000 站外讨论</a>
    </section>`, { recommendations: [{ ...problem, tags: [] }] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { data: { problem: { ...problem, tags: [] } } } });
      if (url.pathname === "/record/list") return route.fulfill({ json: { template: "record.list", user: viewer, data: { records: { result: [] } } } });
    },
  });
  const forum = page.locator("#forum");
  const preview = card(page);
  const title = preview.getByText("P1000 Native preview", { exact: true });
  await forum.hover();
  await title.waitFor();
  assert.equal(await preview.getByRole("link", { name: "跳转题目" }).getAttribute("href"), `${origin}/problem/P1000`);
  assert.equal(await forum.getAttribute("href"), "/discuss?forum=P1000");
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  await forum.press("Alt+ArrowDown");
  await title.waitFor();
  await page.keyboard.press("Escape");
  for (const link of await page.locator("main section a:not(#forum)").all()) {
    await link.press("Alt+ArrowDown");
    assert.equal(await preview.isVisible(), false, await link.getAttribute("href"));
  }
  assert.equal(requests.filter(r => r.path === "/discuss" || r.path === "/problem/P2000").length, 0);
});

const previewProblem = { ...problem, tags: [] };
const previewRecord = { id: 77, problem: previewProblem };
const previewRecordList = { records: { result: [previewRecord] } };
const recordPreviewRow = '<div><a class="status" href="/record/77">Accepted</a></div>' +
  '<div class="problem"><a id="preview-link" href="/problem/P1000"><strong>P1000</strong> 题名</a></div>';
const previewLink = '<a id="preview-link" href="/problem/P1000">题名</a>';
const problemPreviewPages = [
  ["task plan", "/", "excited", {}, '<a id="preview-link" href="/problem/P1000">P1000 题名</a>'],
  ["problem list", "/problem/list", "problem.list", { problems: { result: [previewProblem] } },
    `<div class="pid" title="P1000">P1000</div>${previewLink}`],
  ["recommendations", "/problem/P1001", "problem.show", { recommendations: [previewProblem] }, previewLink],
  ["native void link", "/problem/P1001#ide", "problem.show", { recommendations: [previewProblem] },
    '<a id="preview-link" data-v-bade3303 data-v-4842157a href="javascript:void 0">P1000 题名</a>'],
  ["record list by user", "/record/list?user=42", "record.list", previewRecordList, recordPreviewRow],
  ["record list by problem", "/record/list?pid=P1000", "record.list", previewRecordList, recordPreviewRow],
  ["record detail", "/record/77", "record.show", { record: previewRecord },
    '<div class="problem-row"><a id="preview-link" href="/problem/P1000"><strong>P1000</strong> 题名</a></div>'],
  ["contest", "/contest/123", "contest.show", {},
    '<a id="preview-link" href="/problem/P1000?contestId=123&amp;lang=en">题名</a>', "?contestId=123&lang=en"],
  ["training", "/training/100", "training.show", { training: { problems: [previewProblem] } }, previewLink],
  ["user practice", "/user/42/practice", "user.show", { submitted: [previewProblem] }, previewLink],
];

for (const learnMode of [false, true]) {
  for (const [name, path, template, data, html, query = ""] of problemPreviewPages) {
    test(`${name} problem link previews in ${learnMode ? "academic" : "normal"} mode`, async (t) => {
      const { page } = await fixture(t, {
        path, html: fixtureHtml(html, data, { template, user: { ...viewer, learnMode } }),
        reply(route, url) {
          if (url.pathname === "/problem/P1000") return route.fulfill({ json: { data: { problem: previewProblem } } });
          if (url.pathname === "/record/list") return route.fulfill({ json: { template: "record.list", user: viewer, data: { records: { result: [] } } } });
        },
      });
      const link = page.locator("#preview-link");
      const child = link.locator("strong");
      await (await child.count() ? child : link).hover();
      const preview = card(page);
      await preview.getByText("P1000 Native preview", { exact: true }).waitFor();
      assert.equal(await preview.getByRole("link", { name: "跳转题目" }).getAttribute("href"), `${origin}/problem/P1000${query}`);
    });
  }
}

for (const input of ["pointer", "keyboard"]) {
  test(`hover destination trust rejects lookalikes via ${input}`, async (t) => {
    const offsite = "https://example.invalid";
    const offsiteUser = `<a href="${offsite}/user/123">External user</a>`;
    const offsiteProblem = '<a href="//example.invalid/problem/P1000" data-luogusp-pid="P1000">External problem</a>';
    const invalid = input === "pointer" ? [offsiteUser, offsiteProblem] : [offsiteProblem, offsiteUser];
    invalid.push(
      '<a href="/prefix/problem/P1000">Problem path suffix</a>',
      '<a href="/user/123/elsewhere">User route suffix</a>',
      '<a href="/search?q=/user/123">User in query</a>',
      '<a href="#/problem/P1000">Problem in fragment</a>',
      `<a href="${offsite}/user/123"><img src="${origin}/upload/usericon/123.png" alt="Avatar in external link"></a>`,
    );
    if (input === "pointer") {
      invalid.push(`<img src="${offsite}/upload/usericon/123.png" alt="External avatar">`);
    }
    const { page, requests } = await fixture(t, {
      html: fixtureHtml(
        invalid.map(target => `<div class="invalid">${target}</div>`).join("") +
        `<a id="user" href="${origin}/user/123">Local user</a>
         <a id="problem" href="problem/P1000">Local problem</a>
         <a id="void" data-v-bade3303 data-v-4842157a href="javascript:void 0">P1000 Native void link</a>`,
        { recommendations: [problem] },
      ),
      reply(route, url) {
        if (url.pathname === "/api/user/info/123") return route.fulfill({ json: {
          user: { uid: 123, name: "Local user preview" },
        } });
        if (url.pathname === "/user/123") return route.fulfill({ status: 403, json: {} });
        if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem } } });
        if (url.pathname === "/_lfe/tags") return route.fulfill({ json: { tags: [] } });
        if (url.pathname === "/record/list") return route.fulfill({ json: { template: "record.list", user: viewer, data: { records: { result: [] } } } });
      },
    });
    const open = (trigger) => input === "pointer" ? trigger.hover() : trigger.press("Alt+ArrowDown");
    const expectRejected = async (trigger) => {
      await open(trigger);
      await page.waitForTimeout(350);
      const label = await trigger.getAttribute("href") ?? await trigger.getAttribute("src");
      assert.deepEqual({
        visible: await card(page).isVisible(),
        requests: requests.filter(r => r.type === "fetch" || r.type === "xhr"),
      }, { visible: false, requests: [] }, `Unexpected hover activity for ${label}`);
    };
    for (const trigger of await page.locator(".invalid > *").all()) await expectRejected(trigger);
    await page.evaluate(href => document.head.append(Object.assign(document.createElement("base"), { href })), offsite + "/");
    await expectRejected(page.locator("#problem"));
    await page.locator("base").evaluate(el => el.remove());
    await open(page.locator("#user"));
    await card(page).getByText("Local user preview", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    const problemLink = page.locator("#problem");
    if (input === "pointer") {
      await problemLink.hover();
      await problemLink.evaluate((anchor, href) => { anchor.href = href; }, offsite + "/problem/P1000");
      await page.waitForTimeout(350);
      assert.equal(await card(page).isVisible(), false);
      assert.equal(requests.filter(r => r.path === "/problem/P1000").length, 0);
      await page.mouse.move(700, 500);
      await problemLink.evaluate(anchor => { anchor.href = "problem/P1000"; });
    }
    await open(problemLink);
    await card(page).getByText("P1000 Native preview", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await open(page.locator("#void"));
    await card(page).getByText("P1000 Native preview", { exact: true }).waitFor();
  });
}

for (const fault of ["blocked bundle", "failed mount"]) {
  test(`user preview leaves the native card available after a ${fault}`, async (t) => {
    const { page } = await fixture(t, {
      html: fixtureHtml('<a id="user-trigger" href="/user/123">User trigger</a><div class="dropdown"><div class="float-card">Native user card</div></div>'),
      expectedConsoleError: /^LuoguSP hover card bundle:/,
    });
    const native = page.getByText("Native user card");
    assert.equal(await native.isVisible(), true);
    await page.evaluate((fault) => {
      const fail = () => { throw new Error("Blocked user preview fixture"); };
      if (fault === "blocked bundle") URL.createObjectURL = fail;
      else document.elementFromPoint = fail;
    }, fault);
    const failed = page.waitForEvent("console", { predicate: message => /^LuoguSP hover card bundle:/.test(message.text()) });
    await page.locator("#user-trigger").hover();
    await failed;
    assert.equal(await card(page).count(), 0);
    assert.equal(await native.isVisible(), true);
  });
}

test("user preview relinquishes the native card on close and retries transient profile failures", async (t) => {
  let attempts = 0;
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="user-trigger" href="/user/123">User trigger</a><div class="dropdown"><div class="float-card">Native user card</div></div>'),
    reply(route, url) {
      if (url.pathname === "/api/user/info/123" || url.pathname === "/user/123") {
        attempts++;
        if (attempts <= 2) return route.fulfill({ status: 503, json: {} });
        return route.fulfill({ json: url.pathname.startsWith("/api/") ?
          { user: { uid: 123, name: "Recovered user" } } :
          { data: { user: { uid: 123 }, gu: { rating: 980 } } } });
      }
    },
  });
  const native = page.getByText("Native user card");
  const trigger = page.locator("#user-trigger");
  const preview = card(page);
  await trigger.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await preview.getByText("拿不到这条数据。").waitFor();
  assert.equal(await native.isVisible(), true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+ArrowDown");
  await preview.getByRole("link", { name: "Recovered user" }).waitFor();
  await preview.getByText("980").waitFor();
  assert.equal(await native.isVisible(), false);
  assert.equal(attempts, 4);
  await page.keyboard.press("Escape");
  assert.equal(await native.isVisible(), true);
  assert.equal(await focused(trigger), true);
});

test("user preview loads verified Luogu images without referrers, credentials, or redirect hops", async (t) => {
  const cdn = "https://cdn.luogu.com.cn";
  const avatar = `${cdn}/upload/usericon/123.png`;
  const redirect = `${cdn}/upload/image_hosting/redirect.png`;
  const fallback = `${cdn}/images/bg/fe/DSCF0530-shrink.jpg`;
  const external = "https://preview-media.example.test";
  const image = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const seen = [];
  const routeHeaders = { "access-control-allow-origin": "*" };
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="safe-user" href="/user/123">Safe user</a><a id="offsite-user" href="/user/456">Offsite user</a>'),
    async reply(route, url) {
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: { user: {
        uid: 123, name: "Safe avatar", avatar, background: redirect,
      } } });
      if (url.pathname === "/api/user/info/456") return route.fulfill({ json: { user: {
        uid: 456, name: "Offsite profile", avatar: external + "/avatar", background: external + "/cover",
      } } });
      if (/^\/user\/(123|456)$/.test(url.pathname)) return route.fulfill({ status: 403, json: {} });
      if (url.origin !== cdn) return route.abort();
      const req = route.request();
      seen.push({ href: url.href, referer: await req.headerValue("referer"), cookie: await req.headerValue("cookie") });
      if (url.href === redirect) return route.fulfill({ status: 302,
        headers: { ...routeHeaders, location: external + "/redirected" } });
      return route.fulfill({ headers: routeHeaders, contentType: "image/gif", body: image });
    },
  });
  await page.context().addCookies([{ name: "preview-media", value: "fixture", url: cdn }]);
  const unwanted = [];
  page.on("request", request => {
    if (request.url().startsWith(external)) unwanted.push(request.url());
  });
  await page.locator("#safe-user").focus();
  await page.keyboard.press("Alt+ArrowDown");
  const preview = card(page);
  await preview.getByRole("link", { name: "Safe avatar" }).waitFor();
  await page.waitForFunction(() => ["avatar", "cover"].every(name =>
    document.querySelector(`.luogusp-hc-${name}`)?.naturalWidth === 1));
  assert.deepEqual(seen.map(({ href }) => href).sort(), [avatar, redirect, fallback].sort());
  assert.ok(seen.every(({ referer, cookie }) => referer === null && cookie === null));
  const avatarBlob = await preview.locator(".luogusp-hc-avatar").getAttribute("src");
  assert.match(avatarBlob, /^blob:/);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(url => fetch(url).then(() => true, () => false), avatarBlob), false);
  await page.locator("#offsite-user").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await preview.getByRole("link", { name: "Offsite profile" }).waitFor();
  await page.waitForFunction(() => document.querySelector(".luogusp-hc-cover")?.naturalWidth === 1);
  assert.equal(await preview.locator(".luogusp-hc-avatar").getAttribute("src"), null);
  assert.deepEqual(unwanted, []);
});

test("user preview leaves unsupported native XHR media to the direct lookup", async (t) => {
  const { page, requests } = await fixture(t, {
    html: fixtureHtml('<a id="user" href="/user/123">User</a>'),
    reply(route, url) {
      if (url.pathname === "/api/user/info/123") {
        if (route.request().resourceType() === "xhr") return route.fulfill({
          contentType: "text/plain",
          body: JSON.stringify({ user: { uid: 123, name: "Native text fixture" } }),
        });
        return route.fulfill({ json: { user: { uid: 123, name: "Direct user info" } } });
      }
      if (url.pathname === "/user/123") return route.fulfill({ status: 403, json: {} });
    },
  });
  const events = await page.evaluate(() => new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    const seen = [];
    xhr.open("GET", "/api/user/info/123");
    xhr.onload = () => seen.push(["load", xhr.status, JSON.parse(xhr.responseText).user.name]);
    xhr.onloadend = () => resolve([...seen, ["loadend", xhr.status]]);
    xhr.send();
  }));
  assert.deepEqual(events, [["load", 200, "Native text fixture"], ["loadend", 200]]);
  await page.locator("#user").press("Alt+ArrowDown");
  const preview = card(page);
  await preview.getByRole("link", { name: "Direct user info" }).waitFor();
  assert.equal(await preview.getByText("Native text fixture", { exact: true }).count(), 0);
  assert.deepEqual(requests.filter(r => r.path === "/api/user/info/123").map(r => r.type), ["xhr", "fetch"]);
});

test("user preview joins a native XHR and shows basic fields ahead of the profile", async (t) => {
  const basic = responseGate(t);
  const profile = responseGate(t);
  const supplement = Promise.withResolvers();
  const { page, requests } = await fixture(t, {
    reducedMotion: "no-preference",
    html: fixtureHtml('<a id="user" href="/user/123">User</a>')
      .replace("</head>", '<meta name="csrf-token" content="fixture-only"></head>'),
    reply(route, url) {
      if (url.pathname === "/api/user/info/123") return basic.promise.then(() => route.fulfill({ json: {
        user: { uid: 123, name: "Native user", elo: { rating: 1800 }, color: "Blue", userRelationship: 0, followerCount: 2 },
      } }));
      if (url.pathname === "/api/user/updateRelationShip" && route.request().method() === "POST")
        return route.fulfill({ json: { _empty: true } });
      if (url.pathname === "/user/123") {
        supplement.resolve();
        return profile.promise.then(() => route.fulfill({ json: { data: {
          user: { uid: 123, name: "Profile fallback" }, gu: { rating: 42 },
        } } }));
      }
    },
  });
  await page.evaluate(() => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/user/info/123");
    xhr.send();
  });
  await page.locator("#user").hover();
  await supplement.promise;
  basic.release();
  const preview = card(page);
  await preview.getByText("Native user", { exact: true }).waitFor();
  await preview.getByRole("button", { name: "关注", exact: true }).click();
  const following = preview.getByRole("button", { name: "已关注", exact: true });
  await following.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("#luogusp-hover-card button")]
    .some(button => button.textContent === "已关注" && !button.disabled));
  const name = preview.getByRole("link", { name: "Native user" });
  await name.focus();
  assert.ok(await preview.getByText("1800", { exact: true }).isVisible());
  assert.equal(await preview.getByText("咕值", { exact: true }).count(), 0);
  await watchPreviewMotion(preview, ".luogusp-hc-stat-k", "咕值");
  profile.release();
  await preview.getByText("咕值", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.previewMotion), [
    { label: "咕值", duration: 125, properties: ["opacity"] },
  ]);
  assert.ok(await focused(name));
  assert.ok(await following.isEnabled());
  assert.deepEqual(requests.filter(r => r.path === "/api/user/info/123").map(r => r.type), ["xhr"]);
});

test("user preview skips the pending-native timer after a completed XHR is reset", async (t) => {
  const { page, requests } = await fixture(t, {
    initScript: `
      window.nativeWaits = 0;
      const scheduleForFixture = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 500) window.nativeWaits++;
        return scheduleForFixture(callback, delay, ...args);
      };`,
    html: fixtureHtml('<a id="user" href="/user/123">User</a>'),
    reply(route, url) {
      if (url.pathname === "/user/123") return route.fulfill({ status: 403 });
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: {
        user: { uid: 123, name: route.request().resourceType() === "xhr" ? "Native user" : "Fallback user" },
      } });
    },
  });
  assert.deepEqual(await page.evaluate(() => new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/user/info/123");
    xhr.onloadend = () => {
      const before = [xhr.readyState, xhr.status];
      xhr.abort();
      resolve([...before, xhr.readyState, xhr.status]);
    };
    xhr.send();
  })), [4, 200, 0, 0]);
  await page.locator("#user").press("Alt+ArrowDown");
  await card(page).getByText("Fallback user", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.nativeWaits), 0);
  assert.deepEqual(requests.filter(r => r.path === "/api/user/info/123").map(r => r.type), ["xhr", "fetch"]);
});

for (const [updated, expanded, focusToggle] of [["long", true, true], ["long", false, true], ["short", true, true], ["short", true, false]]) {
  test(`user preview preserves signature disclosure after a late ${updated} signature while ${expanded ? "expanded" : "collapsed"} and focused on ${focusToggle ? "the toggle" : "another control"}`, async (t) => {
    const info = responseGate(t);
    const nextText = updated === "long" ? "Updated signature ".repeat(45) : "Short signature";
    const user = { uid: 123, name: "Signature fixture", slogan: "Initial signature ".repeat(40) };
    const { page } = await fixture(t, {
      html: fixtureHtml('<a id="signature-user" href="/user/123">User</a>'),
      reply(route, url) {
        if (url.pathname === "/api/user/info/123") return info.promise.then(() => route.fulfill({
          json: { user: { ...user, slogan: nextText } },
        }));
        if (url.pathname === "/user/123") return route.fulfill({ json: { data: { user } } });
      },
    });
    const trigger = page.locator("#signature-user");
    await trigger.press("Alt+ArrowDown");
    const preview = card(page);
    const signature = preview.locator(".luogusp-hc-slogan");
    const toggle = signature.getByRole("button", { name: "展开", exact: true });
    await toggle.waitFor();
    await toggle.focus();
    const original = await toggle.elementHandle();
    if (expanded) await toggle.press("Enter");
    if (!focusToggle) await preview.getByRole("link", { name: user.name }).focus();
    info.release();
    await page.waitForFunction(text => document.querySelector(".luogusp-hc-clamp")?.textContent === text, nextText);
    const currentToggle = signature.locator(".luogusp-hc-expand");
    assert.ok(await original.evaluate(node => node === document.querySelector(".luogusp-hc-expand")));
    const remainsExpanded = expanded && updated === "long";
    assert.equal(await signature.evaluate(node => node.classList.contains("is-open")), remainsExpanded);
    assert.equal(await currentToggle.getAttribute("aria-expanded"), String(remainsExpanded));
    assert.equal(await focused(updated === "short" ? preview.getByRole("link", { name: user.name }) : currentToggle), true);
    assert.equal(await currentToggle.isVisible(), updated === "long");
    if (remainsExpanded) {
      await currentToggle.press("Enter");
      assert.equal(await currentToggle.getAttribute("aria-expanded"), "false");
      assert.equal(await currentToggle.textContent(), "展开");
    }
    await page.keyboard.press("Escape");
    assert.ok(await focused(trigger));
  });
}

test("user signature wraps an unbroken URL and reveals its full text on expansion", async (t) => {
  const slogan = `https://www.luogu.com.cn/${"profile".repeat(65)}/end`;
  const user = { uid: 123, name: "URL fixture", slogan };
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="url-user" href="/user/123">User</a>'),
    viewport: { width: 420, height: 700 },
    reply(route, url) {
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: { user } });
      if (url.pathname === "/user/123") return route.fulfill({ status: 404, json: {} });
    },
  });
  const trigger = page.locator("#url-user");
  const preview = card(page);
  await trigger.press("Alt+ArrowDown");
  await preview.getByRole("link", { name: user.name }).waitFor();
  const text = preview.locator(".luogusp-hc-clamp");
  const toggle = preview.locator(".luogusp-hc-expand");
  const overflow = () => text.evaluate(node => ({
    horizontal: node.scrollWidth - node.clientWidth,
    vertical: node.scrollHeight - node.clientHeight,
  }));
  const collapsed = await overflow();
  assert.ok(collapsed.horizontal <= 1 && collapsed.vertical > 1, JSON.stringify(collapsed));
  await toggle.press("Enter");
  await page.setViewportSize({ width: 240, height: 500 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const expanded = await overflow();
  assert.ok(expanded.horizontal <= 1 && expanded.vertical <= 1, JSON.stringify(expanded));
  assert.equal(await text.textContent(), slogan);
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.ok(await focused(toggle));
  const control = await toggle.boundingBox();
  const viewport = await preview.boundingBox();
  assert.ok(control.y >= viewport.y && control.y + control.height <= viewport.y + viewport.height,
    JSON.stringify({ control, viewport }));
  await page.keyboard.press("Escape");
  assert.ok(await focused(trigger));
});

test("a shallow user preview keeps the focused signature control fully visible", async (t) => {
  const user = { uid: 123, name: "Shallow fixture", slogan: "Long user signature ".repeat(80) };
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="shallow-user" href="/user/123">User</a>'),
    viewport: { width: 320, height: 250 },
    reply(route, url) {
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: { user } });
      if (url.pathname === "/user/123") return route.fulfill({ status: 404, json: {} });
    },
  });
  const trigger = page.locator("#shallow-user");
  await trigger.press("Alt+ArrowDown");
  const preview = card(page);
  const toggle = preview.locator(".luogusp-hc-expand");
  await toggle.waitFor();
  await toggle.focus();

  async function checkDisclosure(expanded, phase) {
    const visible = await toggle.evaluate(node => {
      const card = node.closest(".luogusp-hc");
      const control = node.getBoundingClientRect();
      const bounds = card.getBoundingClientRect();
      const top = bounds.top + card.clientTop;
      return { controlTop: control.top, controlBottom: control.bottom, top, bottom: top + card.clientHeight };
    });
    assert.equal(await toggle.getAttribute("aria-expanded"), String(expanded));
    assert.ok(await focused(toggle), phase);
    assert.ok(visible.top <= visible.controlTop && visible.controlBottom <= visible.bottom,
      `${phase}: ${JSON.stringify(visible)}`);
  }

  await checkDisclosure(false, "initial");
  await page.keyboard.press("Enter");
  await checkDisclosure(true, "expanded");
  await page.setViewportSize({ width: 300, height: 200 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await checkDisclosure(true, "repositioned");
  await page.keyboard.press("Enter");
  await checkDisclosure(false, "collapsed");
  await page.keyboard.press("Space");
  await checkDisclosure(true, "re-expanded");
  const name = preview.getByRole("link", { name: user.name });
  await name.focus();
  const scrollTop = await preview.evaluate(node => { node.scrollTop = 96; return node.scrollTop; });
  assert.equal(scrollTop, 96);
  await page.setViewportSize({ width: 300, height: 210 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await preview.evaluate(node => node.scrollTop), scrollTop);
  assert.ok(await focused(name));
  await page.keyboard.press("Escape");
  assert.ok(await focused(trigger));
});

test("signature width remeasurement preserves a deep scroll offset", async (t) => {
  const user = { uid: 123, name: "Scroll fixture", slogan: "LongUserSignatureForBrowserFixture ".repeat(40) };
  const { page } = await fixture(t, {
    html: fixtureHtml('<a id="scroll-user" href="/user/123">User</a>'),
    viewport: { width: 320, height: 250 },
    reply(route, url) {
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: { user } });
      if (url.pathname === "/user/123") return route.fulfill({ status: 404, json: {} });
    },
  });
  await page.locator("#scroll-user").press("Alt+ArrowDown");
  const preview = card(page);
  const toggle = preview.locator(".luogusp-hc-expand");
  await toggle.press("Enter");
  const name = preview.getByRole("link", { name: user.name });
  await name.focus();
  await preview.evaluate(node => { node.scrollTop = 500; });

  const layout = () => preview.evaluate(node => ({
    width: node.offsetWidth, scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
  }));
  const resize = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return layout();
  };

  assert.equal((await layout()).scrollTop, 500);
  const shorter = await resize(320, 240);
  assert.equal(shorter.scrollTop, 500);
  const narrower = await resize(300, 240);
  assert.ok(narrower.width < shorter.width);
  assert.equal(narrower.scrollHeight, shorter.scrollHeight);
  assert.equal(narrower.clientHeight, shorter.clientHeight);
  assert.equal(narrower.scrollTop, shorter.scrollTop);
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.ok(await focused(name));
});

for (const sizeChange of ["viewport resizing", "pinch zoom", "card-only resizing"]) {
  test(`open user signature reconciles disclosure through ${sizeChange}`, async (t) => {
    const pinch = sizeChange === "pinch zoom";
    const user = { uid: 123, name: "Size fixture", slogan:
      "A preview signature that fits at full width and takes extra lines at a narrower width." };
    const html = fixtureHtml('<a id="size-user" href="/user/123">User</a>')
      .replace("<head>", '<head><meta name="viewport" content="width=device-width, initial-scale=1">');
    const { page } = await fixture(t, {
      html, viewport: { width: 420, height: 700 }, isMobile: pinch, hasTouch: pinch,
      reply(route, url) {
        if (url.pathname === "/api/user/info/123") return route.fulfill({ json: { user } });
        if (url.pathname === "/user/123") return route.fulfill({ status: 404, json: {} });
      },
    });
    const session = pinch ? await page.context().newCDPSession(page) : null;
    async function resize(width) {
      if (session) {
        await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 420 / width });
      } else if (sizeChange === "card-only resizing") {
        await card(page).evaluate((node, width) => { node.style.width = `${Math.min(320, width - 24)}px`; }, width);
      } else {
        await page.setViewportSize({ width, height: 700 });
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const trigger = page.locator("#size-user");
    await trigger.press("Alt+ArrowDown");
    const preview = card(page);
    const name = preview.getByRole("link", { name: user.name });
    await name.waitFor();
    await name.focus();
    const toggle = preview.locator(".luogusp-hc-expand");
    const original = await toggle.elementHandle();
    assert.equal(await toggle.isVisible(), false);
    await resize(210);
    const detail = await preview.locator(".luogusp-hc-clamp").evaluate(node => ({
      width: node.clientWidth, visible: node.clientHeight, full: node.scrollHeight,
    }));
    assert.ok(detail.full > detail.visible, JSON.stringify(detail));
    await toggle.waitFor({ state: "visible" });
    assert.ok(await focused(name));
    await toggle.press("Enter");
    await resize(168);
    assert.ok(await original.evaluate(node => node === document.querySelector(".luogusp-hc-expand")));
    assert.ok(await focused(toggle));
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await resize(420);
    await toggle.waitFor({ state: "hidden" });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.ok(await focused(name));
    await resize(210);
    await toggle.waitFor({ state: "visible" });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    const message = preview.getByRole("link", { name: "私信" });
    await message.focus();
    await resize(420);
    await toggle.waitFor({ state: "hidden" });
    assert.ok(await focused(message));
    await page.keyboard.press("Escape");
    assert.ok(await focused(trigger));
  });
}

for (const [branch, fault] of [["info", "redirect"], ["profile", "redirect"], ["info", "wrong-url"], ["profile", "html"]]) {
  test(`user preview rejects ${fault} ${branch} data and recovers on reopening`, async (t) => {
    const redirect = responseGate(t);
    const hits = [];
    const badUser = { uid: 123, name: "Untrusted data", followerCount: 888 };
    const badPayload = branch === "info" ? { user: badUser } : { data: { user: badUser, gu: { rating: 888 } } };
    const external = createServer((req, res) => {
      hits.push(req.method);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "x-lentille-request");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Content-Type", "application/json");
      res.end(req.method === "OPTIONS" ? "" : JSON.stringify(badPayload));
    });
    const listening = once(external, "listening");
    external.listen(0, "127.0.0.1");
    await listening;
    t.after(() => external.close());
    const badPath = branch === "info" ? "/api/user/info/123" : "/user/123";
    let attempts = 0;
    const { page, requests } = await fixture(t, {
      html: fixtureHtml('<a id="provenance-user" href="/user/123">User</a>'),
      initScript: `
        window.previewReads = [];
        let previewAttempt = 0;
        const rawFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
          if (path !== ${JSON.stringify(badPath)}) return rawFetch(input, init);
          const attempt = ++previewAttempt;
          const record = () => setTimeout(() => previewReads.push(path), 0);
          try {
            const response = await rawFetch(input, init);
            if (${JSON.stringify(fault)} === "wrong-url" && attempt === 1)
              Object.defineProperty(response, "url", { value: "https://outside.example/user/123" });
            let consumed = false;
            const json = response.json.bind(response);
            response.json = (...args) => {
              consumed = true;
              return json(...args).finally(record);
            };
            setTimeout(() => { if (!consumed) record(); }, 0);
            return response;
          } catch (error) { record(); throw error; }
        };
      `,
      reply(route, url) {
        if (url.origin !== origin) return;
        if (url.pathname === badPath && ++attempts === 1) return redirect.promise.then(() => {
          if (fault === "redirect") return route.fulfill({ status: 302, headers: {
            location: `http://127.0.0.1:${external.address().port}/untrusted-user`,
          } });
          return route.fulfill({ body: JSON.stringify(badPayload),
            contentType: fault === "html" ? "text/html" : "application/json" });
        });
        if (url.pathname === "/api/user/info/123") return route.fulfill({ json: {
          user: { uid: 123, name: "Trusted basic", followerCount: 7 },
        } });
        if (url.pathname === "/user/123") return route.fulfill({ json: { data: {
          user: { uid: 123, name: "Trusted profile" }, gu: { rating: 42 },
        } } });
      },
    });
    await page.context().grantPermissions(["local-network-access"], { origin });
    const trigger = page.locator("#provenance-user");
    await trigger.press("Alt+ArrowDown");
    const preview = card(page);
    const initialName = branch === "info" ? "Trusted profile" : "Trusted basic";
    await preview.getByRole("link", { name: initialName, exact: true }).waitFor();
    redirect.release();
    await page.waitForFunction(path => previewReads.includes(path), badPath);
    assert.equal(await preview.locator(".luogusp-hc-name").textContent(), initialName);
    assert.equal(await preview.getByText("888", { exact: true }).count(), 0);
    assert.deepEqual(hits, []);
    await page.keyboard.press("Escape");
    await trigger.press("Alt+ArrowDown");
    await preview.getByRole("link", { name: "Trusted basic", exact: true }).waitFor();
    await preview.getByText("42", { exact: true }).waitFor();
    assert.equal(await preview.getByText("888", { exact: true }).count(), 0);
    assert.equal(requests.filter(request => request.path === badPath).length, 2);
    assert.deepEqual(hits, []);
  });
}

test("user preview falls back to one GET when the native page has no lookup", async (t) => {
  const { page, requests } = await fixture(t, {
    html: fixtureHtml('<a id="user" href="/user/123">User</a>'),
    reply(route, url) {
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: {
        user: { uid: 123, name: "Fallback basic fields" },
      } });
      if (url.pathname === "/user/123") return route.fulfill({ status: 403, json: {} });
    },
  });
  await page.locator("#user").hover();
  await card(page).getByText("Fallback basic fields", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.mouse.move(700, 500);
  await page.locator("#user").hover();
  await card(page).getByText("Fallback basic fields", { exact: true }).waitFor();
  assert.deepEqual(requests.filter(r => r.path === "/api/user/info/123").map(r => r.type), ["fetch"]);
});

async function userRelationFixture(t, {
  firstWrite, replyWrite, countFor = (account) => account === viewer.uid ? 5 : 77,
  beforeLink = "", afterLink = "",
} = {}) {
  let account = viewer.uid;
  const submitted = [];
  const { page } = await fixture(t, {
    html: fixtureHtml(`${beforeLink}<a id="user" href="/user/123">User</a>${afterLink}`)
      .replace("</head>", '<meta name="csrf-token" content="fixture-only"></head>'),
    initScript: `{
      window.relationRequests = 0;
      window.relationReplies = 0;
      const fetchPage = window.fetch;
      window.fetch = (...args) => {
        const response = fetchPage(...args);
        if (args[0] !== "/api/user/updateRelationShip") return response;
        window.relationRequests++;
        return response.then(reply => {
          const finalPath = reply.headers.get("x-fixture-final-path");
          if (finalPath) Object.defineProperty(reply, "url", { value: new URL(finalPath, location.origin).href });
          return reply;
        }).finally(() => {
          setTimeout(() => window.relationReplies++, 0);
        });
      };
    }`,
    async reply(route, url) {
      if (url.pathname === "/problem/list") {
        account = Number(url.searchParams.get("viewer"));
        return route.fulfill({ json: { user: { uid: account }, data: {} } });
      }
      if (url.pathname === "/api/user/info/123") return route.fulfill({ json: {
        user: { uid: 123, name: "Target user", userRelationship: 0,
          followerCount: countFor(account) },
      } });
      if (url.pathname === "/user/123") return route.fulfill({ json: {
        data: { user: { uid: 123, name: "Target user" }, gu: { rating: 42 } },
      } });
      if (url.pathname === "/api/user/updateRelationShip" && route.request().method() === "POST") {
        submitted.push({ viewer: account, ...route.request().postDataJSON() });
        if (submitted.length === 1) await firstWrite?.promise;
        return replyWrite?.(route) ?? route.fulfill({ json: { _empty: true } });
      }
      return route.abort();
    },
  });
  const preview = card(page);
  const open = async () => {
    await page.locator("#user").press("Alt+ArrowDown");
    await preview.getByRole("link", { name: "Target user", exact: true }).waitFor();
    await preview.getByText("咕值", { exact: true }).waitFor();
  };
  const switchViewer = (uid) => page.evaluate(uid => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `/problem/list?viewer=${uid}`);
    xhr.addEventListener("loadend", () => xhr.status === 200 ? resolve() : reject(Error(String(xhr.status))));
    xhr.send();
  }), uid);
  return { page, preview, open, switchViewer, submitted };
}

test("user preview focuses block confirmation, restores block on cancel and returns to the trigger on Escape", async (t) => {
  const { page, preview, open, submitted } = await userRelationFixture(t);
  const trigger = page.locator("#user");
  const block = preview.getByRole("button", { name: "屏蔽", exact: true });
  const cancel = preview.getByRole("button", { name: "取消", exact: true });
  const confirm = preview.getByRole("button", { name: "确定", exact: true });
  await open();
  await block.press("Enter");
  assert.ok(await focused(cancel));
  await page.keyboard.press("Shift+Tab");
  assert.ok(await focused(confirm));
  await page.keyboard.press("Tab");
  assert.ok(await focused(cancel));
  await page.keyboard.press("Enter");
  assert.ok(await focused(block));

  await page.keyboard.press("Enter");
  assert.ok(await focused(cancel));
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  assert.ok(await focused(trigger));
  assert.deepEqual(submitted, []);
});

for (const [action, label, successLabel] of [["follow", "关注", "已关注"], ["block", "屏蔽", "取消屏蔽"]]) {
  for (const success of [true, false]) {
    test(`user preview restores keyboard focus after ${action} ${success ? "success" : "failure"}`, async (t) => {
      const write = responseGate(t);
      const { page, preview, open } = await userRelationFixture(t, {
        firstWrite: write,
        replyWrite: route => route.fulfill({ json: success ? { _empty: true } : { status: 403 } }),
      });
      await open();
      await preview.getByRole("button", { name: label, exact: true }).press("Enter");
      if (action === "block") await preview.getByRole("button", { name: "确定", exact: true }).press("Enter");
      const pending = preview.getByRole("button", { name: successLabel, exact: true });
      assert.ok(await pending.isDisabled());
      const held = await focused(preview);
      write.release();
      const result = preview.getByRole("button", { name: success ? successLabel : label, exact: true });
      await result.and(preview.locator("button:enabled")).waitFor();
      assert.ok(await focused(result), "the settled control should receive focus");
      assert.ok(held, "the preview should hold focus while the action is pending");
      if (!success) assert.ok(await preview.getByRole("status").filter({ hasText: `${label}未获确认` }).isVisible());
      await page.keyboard.press("Escape");
      assert.ok(await focused(page.locator("#user")));
    });
  }
}

test("a late follow response keeps focus on a different preview control", async (t) => {
  const write = responseGate(t);
  const { preview, open } = await userRelationFixture(t, { firstWrite: write });
  await open();
  await preview.getByRole("button", { name: "关注", exact: true }).press("Enter");
  const chat = preview.getByRole("link", { name: "私信", exact: true });
  await chat.focus();
  write.release();
  await preview.getByRole("button", { name: "已关注", exact: true }).and(preview.locator("button:enabled")).waitFor();
  assert.ok(await focused(chat));
});

test("a relation response keeps focus on the page after the preview loses it", async (t) => {
  const write = responseGate(t);
  const { page, preview, open } = await userRelationFixture(t, {
    firstWrite: write, afterLink: '<button id="outside">Outside the preview</button>',
  });
  await open();
  await preview.getByRole("button", { name: "关注", exact: true }).press("Enter");
  const outside = page.locator("#outside");
  await outside.focus();
  await preview.waitFor({ state: "hidden" });
  write.release();
  await page.waitForFunction(() => window.relationReplies === 1);
  assert.ok(await focused(outside));
  assert.equal(await preview.isVisible(), false);
});

for (const [key, edge, next] of [["Tab", "last", "#after"], ["Shift+Tab", "first", "#before"]]) {
  test(`user preview closes at the ${edge} control and ${key} continues from the trigger`, async (t) => {
    const { page, preview, open } = await userRelationFixture(t, {
      beforeLink: '<button id="before">Previous control</button>',
      afterLink: '<button id="after">Next control</button>',
    });
    await open();
    await page.keyboard.press("Tab");
    const name = preview.getByRole("link", { name: "Target user" });
    assert.ok(await focused(name));
    if (edge === "last") await preview.getByRole("button", { name: "屏蔽", exact: true }).focus();
    await page.keyboard.press(key);
    assert.ok(await focused(page.locator(next)));
    await preview.waitFor({ state: "hidden" });
  });
}

test("pointer exit restores focus to the trigger when a hovered user preview closes", async (t) => {
  const { page, preview } = await userRelationFixture(t);
  const trigger = page.locator("#user");
  await trigger.hover();
  await preview.getByRole("button", { name: "屏蔽", exact: true }).focus();
  await page.mouse.move(700, 500);
  await preview.waitFor({ state: "hidden" });
  assert.ok(await focused(trigger));
});

test("page scroll restores preview focus without scrolling back to the trigger", async (t) => {
  const { page, preview, open } = await userRelationFixture(t, { afterLink: '<div style="height:1800px"></div>' });
  const trigger = page.locator("#user");
  await open();
  await preview.getByRole("button", { name: "关注", exact: true }).focus();
  await page.evaluate(() => window.scrollTo(0, 300));
  await preview.waitFor({ state: "hidden" });
  assert.ok(await focused(trigger));
  assert.equal(await page.evaluate(() => window.scrollY), 300);
});

for (const [action, initial, optimistic, relationship] of [
  ["follow", "关注", "已关注", 1],
  ["block", "屏蔽", "取消屏蔽", 2],
]) {
  for (const kind of ["HTML", "business error", "redirect", "wrong final URL"]) {
    test(`user preview rolls back ${action} after ${kind}`, async (t) => {
      const pending = responseGate(t);
      let redirectHits = 0;
      let redirectUrl;
      if (kind === "redirect") {
        const server = createServer((req, res) => {
          redirectHits++;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Headers", "content-type, x-csrf-token, x-requested-with");
          res.setHeader("Access-Control-Allow-Private-Network", "true");
          res.setHeader("Content-Type", "application/json");
          res.end('{"_empty":true}');
        });
        const listening = once(server, "listening");
        server.listen(0, "127.0.0.1");
        await listening;
        redirectUrl = `http://127.0.0.1:${server.address().port}/fixture-redirect`;
        t.after(() => server.close());
      }
      const responses = {
        HTML: { contentType: "text/html", body: "<html>Sign in</html>" },
        "business error": { json: { _empty: true, status: 403, errorMessage: "Request denied" } },
        redirect: { status: 302, headers: { location: redirectUrl } },
        "wrong final URL": { json: { _empty: true }, headers: { "x-fixture-final-path": "/api/user/updateRelationShip?unexpected=1" } },
      };
      const { page, preview, open, submitted } = await userRelationFixture(t, {
        firstWrite: pending, replyWrite: (route) => route.fulfill(responses[kind]),
      });
      if (redirectUrl) await page.context().grantPermissions(["local-network-access"], { origin });
      await open();
      await preview.getByRole("button", { name: initial, exact: true }).click();
      if (action === "block") await preview.getByRole("button", { name: "确定", exact: true }).click();
      assert.ok(await preview.getByRole("button", { name: optimistic, exact: true }).isDisabled());
      pending.release();
      await page.waitForFunction((labels) => window.relationReplies === 1 &&
        [...document.querySelectorAll("#luogusp-hover-card button")]
          .some(button => labels.includes(button.textContent) && !button.disabled), [initial, optimistic]);
      assert.equal(await preview.getByRole("button", { name: initial, exact: true }).count(), 1);
      assert.ok(await preview.getByText("5", { exact: true }).isVisible());
      const notice = preview.getByRole("status").filter({ hasText: `${initial}未获确认` });
      assert.ok(await notice.isVisible());
      assert.deepEqual(submitted, [{ viewer: viewer.uid, uid: 123, relationship }]);
      assert.equal(redirectHits, 0);

      await page.keyboard.press("Escape");
      await open();
      assert.ok(await preview.getByRole("button", { name: initial, exact: true }).isEnabled());
      assert.ok(await preview.getByText("5", { exact: true }).isVisible());
    });
  }
}

test("user preview keeps an unknown follower count through confirmed follow and unfollow", async (t) => {
  const { page, preview, open, submitted } = await userRelationFixture(t, { countFor: () => undefined });
  const followers = preview.getByText("粉丝", { exact: true });
  await open();
  assert.equal(await followers.count(), 0);
  const follow = preview.getByRole("button", { name: "关注", exact: true });
  const following = preview.getByRole("button", { name: "已关注", exact: true });
  await follow.click();
  await following.waitFor();
  assert.equal(await followers.count(), 0);
  await following.click();
  await follow.waitFor();
  assert.equal(await followers.count(), 0);
  await page.keyboard.press("Escape");
  await open();
  assert.equal(await followers.count(), 0);
  assert.ok(await follow.isEnabled());
  assert.deepEqual(submitted.map(write => write.relationship), [1, 0]);
});

test("user preview keeps another viewer's follow state and count through an outstanding write", async (t) => {
  const firstWrite = responseGate(t);
  const { page, preview, open, switchViewer, submitted } = await userRelationFixture(t, { firstWrite });
  const follow = preview.getByRole("button", { name: "关注", exact: true });
  const following = preview.getByRole("button", { name: "已关注", exact: true });
  await open();
  await Promise.all([page.waitForRequest("**/api/user/updateRelationShip"), follow.click()]);
  assert.ok(await following.isDisabled());
  assert.ok(await preview.getByText("6", { exact: true }).isVisible());
  await page.keyboard.press("Escape");
  await switchViewer(43);
  await open();
  assert.ok(await preview.getByText("77", { exact: true }).isVisible());
  const enabledDuringFirstWrite = await follow.isEnabled();
  firstWrite.release();
  await page.waitForFunction(() => window.relationReplies === 1);
  assert.ok(await preview.getByText("77", { exact: true }).isVisible());
  assert.ok(enabledDuringFirstWrite);
  assert.ok(await follow.isEnabled());

  await page.keyboard.press("Escape");
  await open();
  assert.ok(await preview.getByText("77", { exact: true }).isVisible());
  await preview.getByRole("button", { name: "屏蔽", exact: true }).click();
  await preview.getByRole("button", { name: "确定", exact: true }).click();
  const unblock = preview.getByRole("button", { name: "取消屏蔽", exact: true });
  await unblock.click();
  await preview.getByRole("button", { name: "确定", exact: true }).click();
  await follow.and(preview.locator("button:enabled")).waitFor();
  assert.ok(await preview.getByText("77", { exact: true }).isVisible());
  await page.keyboard.press("Escape");
  await switchViewer(viewer.uid);
  await open();
  assert.ok(await preview.getByText("6", { exact: true }).isVisible());
  assert.ok(await following.isEnabled());
  assert.deepEqual(submitted, [
    { viewer: viewer.uid, uid: 123, relationship: 1 },
    { viewer: 43, uid: 123, relationship: 2 },
    { viewer: 43, uid: 123, relationship: 0 },
  ]);
});

test("a late failed follow restores its initiating viewer without showing a notice to another viewer", async (t) => {
  const pending = responseGate(t);
  const { page, preview, open, switchViewer } = await userRelationFixture(t, {
    firstWrite: pending,
    replyWrite: route => route.fulfill({ contentType: "text/html", body: "<html>Sign in</html>" }),
  });
  const follow = preview.getByRole("button", { name: "关注", exact: true });
  await open();
  await Promise.all([page.waitForRequest("**/api/user/updateRelationShip"), follow.click()]);
  await page.keyboard.press("Escape");
  await switchViewer(43);
  await open();
  pending.release();
  await page.waitForFunction(() => window.relationReplies === 1);
  assert.ok(await follow.isEnabled());
  assert.ok(await preview.getByText("77", { exact: true }).isVisible());
  assert.equal(await preview.getByText("关注未获确认", { exact: false }).count(), 0);
  await page.keyboard.press("Escape");
  await switchViewer(viewer.uid);
  await open();
  assert.ok(await follow.isEnabled());
  assert.ok(await preview.getByText("5", { exact: true }).isVisible());
});

for (const action of ["follow", "block confirmation"]) {
  test(`user preview dismisses ${action} after the viewer changes`, async (t) => {
    const { page, preview, open, switchViewer } = await userRelationFixture(t);
    await open();
    if (action === "block confirmation")
      await preview.getByRole("button", { name: "屏蔽", exact: true }).click();
    const button = action === "follow" ? "关注" : "确定";
    const control = preview.getByRole("button", { name: button, exact: true });
    await control.focus();
    await switchViewer(viewer.uid);
    assert.ok(await control.isVisible());
    await switchViewer(43);
    assert.equal(await preview.isVisible(), false);
    assert.ok(await focused(page.locator("#user")));
    await switchViewer(viewer.uid);
    assert.equal(await preview.isVisible(), false);
    await switchViewer(43);
    await open();
    assert.ok(await preview.getByText("77", { exact: true }).isVisible());
    assert.equal(await page.evaluate(() => window.relationRequests), 0);
  });
}

const ideFixtureSamples = [["first", "a\nb\nc\nd"], ["second", "ok"]];

async function ideFixture(t, submitReply = (route, index) =>
  route.fulfill({ json: { status: 200, data: { rid: index } } }), { inlineAtDone = false, detailReply, useClock } = {}) {
  const submit = Promise.withResolvers();
  const submitted = [];
  const toolbar = (title, actions = "") => `<div class="ide-toolbar"><div class="title"><span class="text">${title}</span></div><div class="actions">${actions}</div></div>`;
  const { page, requests } = await fixture(t, {
    useClock,
    path: "/problem/P1000#ide",
    html: fixtureHtml(`
      ${toolbar("代码", `
        <div class="lang-select combo-wrapper"><div class="text">C++</div></div>
        <input id="ide-o2" type="checkbox"><label for="ide-o2">O2</label>
        <button>自测</button>`)}<div contenteditable="true" class="cm-content">code</div>
      <div class="io-sample-block">输入 #1 <button>运行</button></div>
      <div class="io-sample-block">输入 #2 <button>运行</button></div>
      <div><div id="native-io" class="panel-layout" role="group" tabindex="-1" style="display:flex">
        <div>${toolbar("输入")}<textarea class="ide-textarea"></textarea></div>
        <div id="output">${toolbar("输出", '<span>AC</span><span class="run-result"></span>')}<textarea class="ide-textarea"></textarea></div>
      </div></div>
      <script>
        window.ideAcknowledged = 0;
        document.querySelectorAll('.io-sample-block button').forEach((button, index) => button.onclick = () => {
          document.querySelector('#output .actions span:not(.run-result)')?.remove();
          window.beforeSampleSubmit?.();
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/ide_submit');
          const renderInline = () => {
            if (xhr.status !== 200) return;
            const { status, data } = JSON.parse(xhr.responseText);
            if (status !== 200 && data?.type === 'compile' && data.success === false)
              window.finishSample('CE', data.desc);
            if (status !== 200 && data?.type === 'execute')
              window.finishSample(data.output === ['a\\nb\\nc\\nd', 'ok'][index] ? 'AC' : 'WA', data.output);
          };
          if (${inlineAtDone}) xhr.addEventListener('readystatechange', () => {
            if (xhr.readyState === XMLHttpRequest.DONE) renderInline();
          });
          else xhr.addEventListener('load', () => Promise.resolve().then(renderInline), { once: true });
          xhr.addEventListener('loadend', () => {
            if (xhr.status === 200) {
              window.ideAcknowledged++;
              if (window.autoFinishSamples) setTimeout(() => window.finishSample('AC'), 0);
            }
          }, { once: true });
          xhr.setRequestHeader('Content-Type', 'application/json');
          const body = {
            lang: document.querySelector('.lang-select > .text').textContent === 'C++' ? 1 : 2,
            code: document.querySelector('.cm-content').textContent,
            input: ['first', 'second'][index],
            o2: document.querySelector('#ide-o2')?.checked ? 'true' : '',
          };
          xhr.send(JSON.stringify(window.transformIdeSubmit?.(body, index) ?? body));
        });
        window.finishSample = (verdict = 'WA', output = 'a\\nextra\\nb\\nc\\nd') => {
          document.querySelector('#output textarea').value = output;
          document.querySelector('#output .actions span:not(.run-result)')?.remove();
          document.querySelector('#output .actions').insertAdjacentHTML('afterbegin', '<span>' + verdict + '</span>');
        };
      </script>`, { problem: detailReply ? problem : { ...problem, samples: ideFixtureSamples } }),
    reply(route, url) {
      if (detailReply && url.origin === origin && url.pathname === "/problem/P1000" &&
          url.searchParams.get("_contentOnly") === "1") return detailReply(route);
      if (url.origin === origin && url.pathname === "/api/ide_submit" &&
          route.request().method() === "POST") {
        submitted.push(route.request().postDataJSON());
        submit.resolve();
        return submitReply(route, submitted.length);
      }
      if (url.pathname.includes("/api/ide_submit"))
        return route.fulfill({ status: 418, json: {}, headers: { "access-control-allow-origin": "*" } });
    },
  });
  return { page, requests, submitted, firstSubmit: submit.promise };
}

for (const omitted of [true, false]) {
  test(`IDE samples ${omitted ? "recover after partial detail" : "reuse a confirmed empty list"}`, async (t) => {
    const detail = responseGate(t);
    const firstRead = Promise.withResolvers();
    let reads = 0;
    const { page, submitted } = await ideFixture(t, undefined, {
      detailReply: async (route) => {
        const samples = ++reads === 1 ? (omitted ? undefined : []) : ideFixtureSamples;
        if (reads === 1) {
          firstRead.resolve();
          await detail.promise;
        }
        return route.fulfill({ json: { user: viewer, data: { problem: { ...problem, samples } } } });
      },
    });
    const start = page.locator(".luogusp-ide-batch-btn");
    const ready = page.getByRole("button", { name: "一键测试", exact: true });
    const message = omitted ? "暂时无法获取样例" : "本题无样例";
    const hint = page.getByRole("button", { name: message, exact: true });
    const status = page.getByRole("status").and(page.locator(".luogusp-ide-remount-status"));
    const editor = page.locator(".cm-content");
    const expectedFocus = omitted ? editor : start;
    await start.press("Enter");
    await firstRead.promise;
    if (omitted) {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      assert.ok(await focused(editor));
    }
    detail.release();
    await hint.waitFor();
    const hintState = {
      focused: await focused(expectedFocus),
      activeElement: await page.evaluate(() => document.activeElement.tagName),
      announcement: await status.textContent(),
      available: await hint.isEnabled(),
    };
    await ready.waitFor();
    assert.deepEqual({ hintState, restoredFocus: await focused(expectedFocus), available: await ready.isEnabled() }, {
      hintState: { focused: true, activeElement: omitted ? "DIV" : "BUTTON", announcement: message, available: false },
      restoredFocus: true,
      available: true,
    });
    if (!omitted) await assertIdeFocusVisible(ready);
    assert.equal(reads, 1);
    assert.equal(submitted.length, 0);
    if (omitted) {
      await page.evaluate(() => { window.autoFinishSamples = true; });
      await ready.press("Enter");
      await page.getByText("2/2 通过", { exact: true }).waitFor();
      assert.equal(reads, 2);
      assert.deepEqual(submitted.map(({ input }) => input), ideFixtureSamples.map(([input]) => input));
    } else {
      await ready.press("Enter");
      await hint.waitFor();
      assert.equal(reads, 1);
      assert.equal(submitted.length, 0);
    }
  });
}

test("IDE rerun announces empty code and keeps the toolbar unavailable through a corrected batch", async (t) => {
  const submission = responseGate(t);
  const { page, firstSubmit, submitted } = await ideFixture(t, async (route, index) => {
    await submission.promise;
    return route.fulfill({ json: { status: 200, data: { rid: index } } });
  });
  const editor = page.locator(".cm-content");
  const samples = page.getByRole("tab", { name: "样例测试", exact: true });
  const rerun = page.getByRole("button", { name: "重新测试", exact: true });
  const hint = page.getByRole("button", { name: "代码为空", exact: true });
  const ready = page.getByRole("button", { name: "一键测试", exact: true });
  const status = page.getByRole("status").and(page.locator(".luogusp-ide-remount-status"));
  await editor.fill("");
  await samples.press("Enter");
  await rerun.press("Enter");
  await hint.waitFor();
  assert.equal(await status.textContent(), "代码为空");
  assert.ok(await focused(rerun));
  assert.equal(submitted.length, 0);

  await editor.fill("code");
  await hint.press("Enter");
  assert.ok(await focused(hint));
  await rerun.press("Enter");
  await firstSubmit;
  await ready.waitFor();
  assert.ok(await ready.isDisabled());
  assert.equal(await status.textContent(), "");
  await page.evaluate(() => { window.autoFinishSamples = true; });
  submission.release();
  await page.getByText("2/2 通过", { exact: true }).waitFor();
  assert.ok(await ready.isEnabled());
  assert.ok(await focused(rerun));
});

for (const outcome of ["completion", "stop", "focus elsewhere", "return to samples tab", "rerun"]) {
  test(`IDE keyboard batch retains appropriate focus through ${outcome}`, async (t) => {
    const submission = responseGate(t);
    const { page, firstSubmit, submitted } = await ideFixture(t, async (route, index) => {
      await submission.promise;
      return route.fulfill({ json: { status: 200, data: { rid: index } } });
    });
    const start = page.locator(".luogusp-ide-batch-btn");
    const stop = page.getByRole("button", { name: "停止", exact: true });
    const samples = page.getByRole("tab", { name: "样例测试", exact: true });
    const editor = page.locator(".cm-content");
    const rerun = page.getByRole("button", { name: "重新测试", exact: true });
    const completes = outcome === "completion" || outcome === "rerun";
    const begins = outcome === "rerun" ? rerun : start;
    if (outcome === "rerun") await samples.press("Enter");
    await begins.press("Enter");
    await firstSubmit;
    const startFocus = await focused(stop);
    if (startFocus) await assertIdeFocusVisible(stop);
    let stopFocus;
    if (!completes) {
      await stop.press("Space");
      stopFocus = await focused(samples);
      if (stopFocus) await assertIdeFocusVisible(samples);
    }
    if (outcome === "focus elsewhere" || outcome === "return to samples tab") await editor.focus();
    if (outcome === "return to samples tab") await samples.focus();
    if (completes) await page.evaluate(() => { window.autoFinishSamples = true; });
    submission.release();
    if (completes) {
      await page.getByText("2/2 通过", { exact: true }).waitFor();
    } else {
      await page.waitForFunction(() => window.ideAcknowledged === 1);
      await page.evaluate(() => window.finishSample("WA"));
      await page.getByText("0/2 通过 · 1 WA · 已停止", { exact: true }).waitFor();
    }
    const expectedFocus = outcome === "focus elsewhere" ? editor : outcome === "return to samples tab" ? samples : begins;
    const completionFocus = await focused(expectedFocus);
    assert.deepEqual({ startFocus, stopFocus, completionFocus },
      { startFocus: true, stopFocus: completes ? undefined : true, completionFocus: true });
    if (expectedFocus !== editor) await assertIdeFocusVisible(expectedFocus);
    assert.ok(await begins.isEnabled());
    assert.equal(await stop.isVisible(), false);
    assert.equal(submitted.length, completes ? 2 : 1);
  });
}

test("IDE tabs support keyboard selection and expose the active panel", async (t) => {
  const { page } = await ideFixture(t);
  const custom = page.locator('.luogusp-ide-tab[data-tab="custom"]');
  const samples = page.locator('.luogusp-ide-tab[data-tab="samples"]');
  const nativeInput = page.locator(".panel-layout");
  const samplesPanel = page.locator(".luogusp-ide-panel");
  await custom.waitFor();
  await page.locator(".io-sample-block button").last().focus();
  await page.keyboard.press("Tab");
  assert.ok(await focused(custom), "Tab focuses the selected IDE tab");
  await assertIdeFocusVisible(custom);
  assert.equal(await page.getByRole("tab", { selected: true }).textContent(), "自定义测试");
  assert.equal(await custom.getAttribute("aria-controls"), await nativeInput.getAttribute("id"));
  assert.ok(await nativeInput.isVisible());
  assert.equal(await samplesPanel.isVisible(), false);

  await page.keyboard.press("ArrowLeft");
  assert.ok(await focused(samples));
  await assertIdeFocusVisible(samples);
  assert.equal(await page.getByRole("tab", { selected: true }).textContent(), "样例测试");
  assert.equal(await samples.getAttribute("aria-controls"), await samplesPanel.getAttribute("id"));
  assert.ok(await page.getByRole("tabpanel", { name: "样例测试" }).isVisible());
  assert.equal(await nativeInput.isVisible(), false);
  await page.keyboard.press("Tab");
  assert.ok(await focused(samplesPanel));
  await page.keyboard.press("Shift+Tab");
  assert.ok(await focused(samples));
  await page.keyboard.press("ArrowRight");
  assert.ok(await focused(custom));
  assert.ok(await page.getByRole("tabpanel", { name: "自定义测试" }).isVisible());
  await page.keyboard.press("End");
  assert.ok(await focused(samples));
  await page.keyboard.press("Home");
  assert.ok(await focused(custom));
  await samples.click();
  assert.ok(await samplesPanel.isVisible());

  await page.evaluate(() => history.pushState({}, "", "/problem/P1000"));
  await samples.waitFor({ state: "detached" });
  assert.ok(await nativeInput.isVisible());
  assert.equal(await nativeInput.getAttribute("id"), "native-io");
  assert.equal(await nativeInput.getAttribute("role"), "group");
  assert.equal(await nativeInput.getAttribute("tabindex"), "-1");
  assert.equal(await nativeInput.getAttribute("aria-labelledby"), null);
});

async function assertIdeFocusVisible(locator) {
  assert.ok(await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle === "solid" &&
      parseFloat(style.outlineWidth) >= 2;
  }));
}

test("IDE sample disclosures respond to Tab, Enter and Space", async (t) => {
  const { page } = await ideFixture(t);
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.waitForFunction(() => window.ideAcknowledged === 1);
  await page.evaluate(() => window.finishSample("AC"));
  await page.waitForFunction(() => window.ideAcknowledged === 2);
  await page.evaluate(() => window.finishSample("WA"));
  await page.getByText("1/2 通过 · 1 WA", { exact: true }).waitFor();

  const first = page.locator(".luogusp-ide-rowhead").nth(0);
  const second = page.locator(".luogusp-ide-rowhead").nth(1);
  const details = page.locator(".luogusp-ide-detail");
  assert.ok(await details.nth(1).isVisible());
  await page.getByRole("button", { name: "重新测试", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.ok(await focused(first), "Tab focuses the first sample disclosure");
  await assertIdeFocusVisible(first);
  assert.equal(await first.getAttribute("aria-expanded"), "false");
  assert.equal(await second.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Enter");
  assert.equal(await first.getAttribute("aria-expanded"), "true");
  assert.equal(await first.getAttribute("aria-controls"), await details.nth(0).getAttribute("id"));
  assert.equal(await second.getAttribute("aria-expanded"), "false");
  assert.ok(await details.nth(0).isVisible());
  assert.equal(await details.nth(1).isVisible(), false);

  await page.keyboard.press("Space");
  assert.equal(await first.getAttribute("aria-expanded"), "false");
  assert.equal(await details.nth(0).isVisible(), false);
  await second.click();
  assert.equal(await second.getAttribute("aria-expanded"), "true");
  assert.ok(await details.nth(1).isVisible());
});

test("IDE copy is visible on keyboard focus and copies the sample input", async (t) => {
  const { page } = await ideFixture(t);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => { window.ideClipboard = text; };
  });
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await page.waitForFunction(() => window.ideAcknowledged === 1);
  await page.evaluate(() => window.finishSample("WA"));
  const jump = page.getByRole("button", { name: "跳到第一处差异" });
  const copy = page.getByRole("button", { name: "复制代码" }).first();
  await jump.focus();
  await page.keyboard.press("Tab");
  assert.ok(await focused(copy));
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.ideClipboard), "first");
  assert.equal(await copy.evaluate((element) => getComputedStyle(element).opacity), "1");
  await assertIdeFocusVisible(copy);
});

test("IDE reduced motion removes disclosure and copy transitions", async (t) => {
  const { page } = await ideFixture(t);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await page.waitForFunction(() => window.ideAcknowledged === 1);
  await page.evaluate(() => window.finishSample("WA"));
  const row = page.locator(".luogusp-ide-row").first();
  const chevron = row.locator(".luogusp-ide-chev");
  const copy = row.getByRole("button", { name: "复制代码" }).first();
  await copy.waitFor();
  const durations = () => Promise.all([chevron, copy].map((locator) =>
    locator.evaluate((element) => getComputedStyle(element).transitionDuration)));
  assert.deepEqual(await durations(), ["0.2s", "0.2s"]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.deepEqual(await durations(), ["0s", "0s"]);
  await row.locator(".code-container").first().hover();
  assert.equal(await copy.evaluate((element) => getComputedStyle(element).opacity), "1");
  await row.locator(".luogusp-ide-rowhead").click();
  assert.equal(await chevron.evaluate((element) => getComputedStyle(element).transform), "none");
});

for (const focusMoved of [false, true]) {
  test(`same-route IDE replacement announces cancellation with focus ${focusMoved ? "in the editor" : "on Stop"}`, async (t) => {
    const response = responseGate(t);
    const { page, firstSubmit, submitted } = await ideFixture(t, async (route, index) => {
      await response.promise;
      return route.fulfill({ json: { status: 200, data: { rid: index } } });
    });
    const batch = page.locator(".luogusp-ide-batch-btn");
    const samples = page.getByRole("tab", { name: "样例测试", exact: true });
    const custom = page.getByRole("tab", { name: "自定义测试", exact: true });
    const editor = page.locator(".cm-content");
    await batch.press("Enter");
    await firstSubmit;
    assert.ok(await focused(page.getByRole("button", { name: "停止", exact: true })));
    if (focusMoved) await custom.press("Enter");
    await page.locator("#native-io").evaluate((node, delayed) => {
      const replacement = node.cloneNode(true);
      replacement.style.display = "flex";
      replacement.setAttribute("role", "group");
      replacement.setAttribute("tabindex", "-1");
      replacement.removeAttribute("aria-labelledby");
      if (delayed) {
        const host = node.parentElement;
        node.remove();
        window.restoreNativeIo = () => host.appendChild(replacement);
      } else node.replaceWith(replacement);
    }, focusMoved);
    const status = page.getByRole("status").and(page.locator(".luogusp-ide-remount-status"));
    const cancellation = "IDE 面板已更新，样例测试已停止";
    await status.filter({ hasText: cancellation }).waitFor({ state: "visible" });
    if (focusMoved) {
      await editor.focus();
      await page.evaluate(() => window.restoreNativeIo());
    }
    await samples.waitFor();
    assert.ok(await focused(focusMoved ? editor : samples));
    assert.equal(await (focusMoved ? custom : samples).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(".luogusp-ide-row").count(), 0);
    assert.equal(await page.getByRole("button", { name: "停止", exact: true }).count(), 0);
    await editor.press("End");
    await editor.press("X");
    assert.ok((await editor.textContent()).includes("X"));
    const summary = page.locator(".luogusp-ide-summary");
    assert.equal(await summary.textContent(), cancellation);

    response.release();
    await page.waitForFunction(() => window.ideAcknowledged === 1);
    await page.evaluate(() => window.finishSample("AC"));
    await batch.press("Enter");
    const hint = "上次运行结果未确认，请刷新页面后重试";
    await page.getByRole("button", { name: hint, exact: true }).waitFor();
    assert.equal(submitted.length, 1);
    assert.equal(await page.locator(".luogusp-ide-row").count(), 0);
    assert.equal(await status.textContent(), hint);
    assert.equal(await summary.textContent(), cancellation);
  });
}

test("same-route IDE toolbar replacement restores focus to the batch button", async (t) => {
  const { page } = await ideFixture(t);
  const batch = page.locator(".luogusp-ide-batch-btn");
  await batch.focus();
  await batch.evaluate(button => {
    const actions = button.parentElement;
    const replacement = actions.cloneNode(true);
    replacement.querySelector(".luogusp-ide-batch-btn").remove();
    actions.replaceWith(replacement);
  });
  await batch.waitFor();
  assert.ok(await focused(batch));
  await assertIdeFocusVisible(batch);
});

test("same-route IDE toolbar replacement keeps the hint through its original deadline", async (t) => {
  const { page, submitted, firstSubmit } = await ideFixture(t, undefined, { useClock: true });
  const batch = page.locator(".luogusp-ide-batch-btn");
  const editor = page.locator(".cm-content");
  const status = page.locator(".luogusp-ide-remount-status");
  await editor.fill("");
  await batch.press("Enter");
  assert.equal(await batch.textContent(), "代码为空");
  await page.clock.runFor(32);
  await editor.fill("corrected source");
  await batch.focus();
  await batch.evaluate(button => {
    const actions = button.parentElement;
    const replacement = actions.cloneNode(true);
    replacement.querySelector(".luogusp-ide-batch-btn").remove();
    actions.replaceWith(replacement);
  });
  await page.clock.runFor(32);
  await batch.waitFor();
  assert.ok(await focused(batch));
  assert.equal(await batch.textContent(), "代码为空");
  assert.equal(await batch.getAttribute("aria-disabled"), "true");
  assert.equal(await status.textContent(), "代码为空");
  await batch.press("Enter");
  await page.clock.runFor(1435);
  assert.equal(submitted.length, 0);
  assert.equal(await batch.getAttribute("aria-disabled"), "true");
  await page.clock.runFor(1);
  assert.equal(await batch.textContent(), "一键测试");
  assert.ok(await batch.isEnabled());
  assert.ok(await focused(batch));
  await batch.press("Enter");
  await firstSubmit;
  assert.equal(submitted[0].code, "corrected source");
});

test("leaving IDE restores native panels and waits for an outstanding submission to be rejected", async (t) => {
  const first = responseGate(t);
  const second = responseGate(t);
  const { page, firstSubmit } = await ideFixture(t, async (route, index) => {
    await (index === 1 ? first : second).promise;
    return route.fulfill(index === 1
      ? { status: 429, json: {} }
      : { json: { status: 200, data: { rid: index } } });
  });
  const nativeInput = page.locator(".panel-layout");
  const selfTest = page.getByRole("button", { name: "自测", exact: true });
  const batch = page.locator(".luogusp-ide-batch-btn");
  await batch.click();
  await firstSubmit;
  await nativeInput.waitFor({ state: "hidden" });
  assert.equal(await selfTest.isDisabled(), true);

  await page.evaluate(() => history.pushState({}, "", "/problem/P1000"));
  await batch.waitFor({ state: "detached" });
  assert.equal(await page.locator(".luogusp-ide-tabbar, .luogusp-ide-panel, .luogusp-ide-remount-status, #luogusp-ide-style").count(), 0);
  assert.equal(await nativeInput.evaluate((element) => element.style.display), "flex");
  assert.equal(await selfTest.isEnabled(), true);

  await page.evaluate(() => {
    window.finishSample("AC");
    history.pushState({}, "", "/problem/P1000#ide");
  });
  await batch.waitFor();
  assert.equal(await batch.count(), 1);
  assert.equal(await page.locator(".luogusp-ide-tabbar").count(), 1);
  assert.equal(await nativeInput.isVisible(), true);

  const waitingOldResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/ide_submit") && response.status() === 429);
  first.release();
  const oldResponse = await waitingOldResponse;
  await oldResponse.finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const nextSubmit = page.waitForRequest((request) => request.url().endsWith("/api/ide_submit"));
  await batch.click();
  await nextSubmit;
  await page.locator(".luogusp-ide-stop").click();
  assert.equal(await page.getByText("运行中", { exact: true }).count(), 1);
  second.release();
  await page.waitForFunction(() => window.ideAcknowledged === 1);
  await page.evaluate(() => window.finishSample("WA"));
  await page.getByText("0/2 通过 · 1 WA · 已停止", { exact: true }).waitFor();
});

test("IDE refuses to attribute abandoned AC, WA or CE results to a new batch", async (t) => {
  const { page, submitted } = await ideFixture(t);
  const batch = page.locator(".luogusp-ide-batch-btn");
  const accepted = page.waitForResponse((response) =>
    response.url().endsWith("/api/ide_submit") && response.ok());
  await batch.click();
  await (await accepted).finished();
  await page.evaluate(() => history.pushState({}, "", "/problem/P1000"));
  await batch.waitFor({ state: "detached" });
  await page.evaluate(() => history.pushState({}, "", "/problem/P1000#ide"));
  await batch.click();
  await page.evaluate(() => {
    for (const verdict of ["AC", "WA", "CE"]) window.finishSample(verdict);
  });
  await page.getByRole("button", { name: "上次运行结果未确认，请刷新页面后重试", exact: true }).waitFor();
  assert.deepEqual(submitted, [{ lang: 1, code: "code", input: "first", o2: "" }]);
  assert.equal(await page.locator(".luogusp-ide-row").count(), 0);
  await page.reload();
  const newSubmit = page.waitForResponse((response) =>
    response.url().endsWith("/api/ide_submit") && response.ok());
  await batch.click();
  await newSubmit;
  await page.waitForFunction(() => window.ideAcknowledged === 1);
  await page.locator(".luogusp-ide-stop").click();
  await page.evaluate(() => window.finishSample("WA"));
  await page.getByText("0/2 通过 · 1 WA · 已停止", { exact: true }).waitFor();
});

test("IDE claims the native submission and ignores lookalike requests", async (t) => {
  const submission = responseGate(t);
  const { page } = await ideFixture(t, async (route) => {
    const body = route.request().postDataJSON();
    if (body.code === "other code") return route.fulfill({ json: {
      status: 500, data: { type: "compile", success: false, desc: "Unrelated compiler failure" },
    } });
    if (body.code !== "code" || body.input !== "first") return route.fulfill({ status: 429, json: {} });
    await submission.promise;
    return route.fulfill({ json: { status: 200, data: { rid: 42 } } });
  });
  await page.evaluate(() => {
    window.beforeSampleSubmit = () => {
      for (const [method, url] of [
        ["GET", "/api/ide_submit"],
        ["POST", "/api/ide_submit-other"],
        ["POST", "https://example.invalid/api/ide_submit"],
      ]) {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.send();
      }
      for (const body of [
        { code: "code", lang: 1, o2: "" },
        { code: "other code", input: "first", lang: 1, o2: "" },
      ]) {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/ide_submit");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify(body));
      }
    };
  });
  const lookalikes = page.waitForResponse((response) =>
    response.url().endsWith("/api/ide_submit-other") && response.status() === 418);
  const unrelatedCompile = page.waitForResponse((response) => response.url().endsWith("/api/ide_submit") &&
    response.request().method() === "POST" && response.request().postDataJSON()?.code === "other code");
  const nativeSubmit = page.waitForRequest((request) =>
    request.url().endsWith("/api/ide_submit") && request.method() === "POST" &&
    request.postDataJSON()?.input === "first" && request.postDataJSON().code === "code");
  await page.locator(".luogusp-ide-batch-btn").click();
  await nativeSubmit;
  await page.locator(".luogusp-ide-stop").click();
  await (await lookalikes).finished();
  await (await unrelatedCompile).finished();
  assert.equal(await page.getByText("运行中", { exact: true }).count(), 1);
  submission.release();
  await page.waitForFunction(() => window.ideAcknowledged === 1);
  await page.evaluate(() => window.finishSample("WA"));
  await page.getByText("0/2 通过 · 1 WA · 已停止", { exact: true }).waitFor();
});

test("IDE ignores an output mutation before the native submit acknowledgement", async (t) => {
  const submission = responseGate(t);
  const { page, firstSubmit } = await ideFixture(t, async (route) => {
    await submission.promise;
    return route.fulfill({ json: { status: 200, data: { rid: 42 } } });
  });
  await page.locator(".luogusp-ide-batch-btn").click();
  await firstSubmit;
  await page.locator(".luogusp-ide-stop").click();
  await page.evaluate(() => window.finishSample("CE"));
  submission.release();
  await page.waitForFunction(() => window.ideAcknowledged === 1);
  assert.equal(await page.getByText("运行中", { exact: true }).count(), 1);
  await page.evaluate(() => window.finishSample("WA"));
  await page.getByText("0/2 通过 · 1 WA · 已停止", { exact: true }).waitFor();
});

test("IDE reports a fast inline compile failure and can test again", async (t) => {
  const log = "main.cpp: error: expected ';' before '}'";
  const { page, submitted } = await ideFixture(t, (route, index) => route.fulfill({ json:
    index === 1 ? { status: 500, data: { type: "compile", success: false, desc: log } }
      : { status: 200, data: { rid: index } },
  }));
  const batch = page.locator(".luogusp-ide-batch-btn");
  await batch.click();
  await page.locator("#output").getByText("CE", { exact: true }).waitFor({ state: "attached" });
  await page.waitForFunction(() => !document.querySelector(".luogusp-ide-batch-btn").disabled,
    null, { timeout: 7000 });
  assert.equal(await page.locator(".luogusp-ide-summary").textContent(), "0/2 通过 · 2 CE");
  const first = page.locator(".luogusp-ide-row").first();
  assert.ok(await first.getByText(log, { exact: true }).isVisible());
  assert.deepEqual(submitted.map(body => body.input), ["first"]);

  await page.evaluate(() => { window.autoFinishSamples = true; });
  await page.getByRole("button", { name: "重新测试", exact: true }).click();
  await page.getByText("2/2 通过", { exact: true }).waitFor();
  assert.deepEqual(submitted.map(body => body.input), ["first", "first", "second"]);
});

test("IDE recognizes inline terminal execution before loadend and can test again", async (t) => {
  const { page, submitted } = await ideFixture(t, (route, index) => route.fulfill({ json:
    index <= 2 ? { status: 500, data: { type: "execute", output: index === 1 ? "wrong answer" : "ok", execute: {} } }
      : { status: 200, data: { rid: index } },
  }));
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.getByText("1/2 通过 · 1 WA", { exact: true }).waitFor();
  assert.deepEqual(await page.locator(".luogusp-ide-pill").allTextContents(), ["WA", "AC"]);
  assert.deepEqual(submitted.map(body => body.input), ["first", "second"]);
  await page.evaluate(() => { window.autoFinishSamples = true; });
  await page.getByRole("button", { name: "重新测试", exact: true }).click();
  await page.getByText("2/2 通过", { exact: true }).waitFor();
  assert.deepEqual(submitted.map(body => body.input), ["first", "second", "first", "second"]);
});

test("IDE waits for the inline response output instead of taking an intervening pill", async (t) => {
  const { page } = await ideFixture(t, (route, index) => route.fulfill({ json: {
    status: 500, data: { type: "execute", output: index === 1 ? "wrong answer" : "ok", execute: {} },
  } }));
  await page.evaluate(() => {
    const render = window.finishSample;
    window.finishSample = (verdict, output) => {
      render("AC", "previous output");
      setTimeout(() => render(verdict, output), 25);
    };
  });
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.getByText("1/2 通过 · 1 WA", { exact: true }).waitFor();
  assert.deepEqual(await page.locator(".luogusp-ide-pill").allTextContents(), ["WA", "AC"]);
});

test("IDE recognizes inline execution rendered by an earlier XHR DONE listener", async (t) => {
  const { page, submitted } = await ideFixture(t, (route, index) => route.fulfill({ json: {
    status: 500, data: { type: "execute", output: index === 1 ? "wrong answer" : "ok", execute: {} },
  } }), { inlineAtDone: true });
  const batch = page.locator(".luogusp-ide-batch-btn");
  await batch.click();
  await page.waitForFunction(() => !document.querySelector(".luogusp-ide-batch-btn").disabled,
    null, { timeout: 7000 });
  assert.equal(await page.locator(".luogusp-ide-summary").textContent(), "1/2 通过 · 1 WA");
  assert.deepEqual(await page.locator(".luogusp-ide-pill").allTextContents(), ["WA", "AC"]);
  assert.deepEqual(submitted.map(body => body.input), ["first", "second"]);
});

test("IDE requires fresh native output matching the response when execution reaches XHR DONE", async (t) => {
  const submission = responseGate(t);
  const { page, firstSubmit, submitted } = await ideFixture(t, async (route) => {
    await submission.promise;
    return route.fulfill({ json: {
      status: 500, data: { type: "execute", output: "wrong answer", execute: {} },
    } });
  }, { inlineAtDone: true });
  await page.locator(".luogusp-ide-batch-btn").click();
  await firstSubmit;
  await page.locator(".luogusp-ide-stop").click();
  await page.evaluate(() => {
    const render = window.finishSample;
    render("AC", "wrong answer");
    window.finishSample = (verdict, output) => {
      window.renderMismatchedOutput = () => render("AC", "previous output");
      window.renderConfirmedOutput = () => render(verdict, output);
    };
  });
  submission.release();
  await page.waitForFunction(() => window.ideAcknowledged === 1 && !!window.renderConfirmedOutput);
  assert.equal(await page.getByText("运行中", { exact: true }).count(), 1);
  await page.evaluate(() => window.renderMismatchedOutput());
  assert.equal(await page.getByText("运行中", { exact: true }).count(), 1);
  await page.evaluate(() => window.renderConfirmedOutput());
  await page.getByText("0/2 通过 · 1 WA · 已停止", { exact: true }).waitFor();
  assert.deepEqual(submitted.map(body => body.input), ["first"]);
});

test("IDE identifies the inserted line, jumps to it and finishes only the current sample on stop", async (t) => {
  const { page, requests, firstSubmit } = await ideFixture(t);
  await page.locator(".luogusp-ide-batch-btn").click();
  await firstSubmit;
  const stop = page.getByRole("button", { name: "停止", exact: true });
  await stop.click();
  await page.getByText("当前样例完成后停止…", { exact: true }).waitFor();
  assert.ok(await stop.isDisabled());
  await page.waitForFunction(() => window.ideAcknowledged === 1);
  await page.evaluate(() => window.finishSample());
  await page.getByText("已停止", { exact: false }).waitFor();
  assert.deepEqual(await page.locator(".luogusp-ide-diffline").allTextContents(), ["extra"]);
  await page.getByRole("button", { name: "跳到第一处差异" }).click();
  assert.ok(await focused(page.locator(".luogusp-ide-diffline")));
  assert.equal(requests.filter(r => r.path === "/api/ide_submit").length, 1);
  assert.ok(await page.getByText("未测", { exact: true }).isVisible());
});

for (const inputEvent of [true, false]) {
  test(`IDE batch stops on source edits ${inputEvent ? "with" : "without"} an input event`, async (t) => {
    const { page, submitted, firstSubmit } = await ideFixture(t);
    await page.locator(".luogusp-ide-batch-btn").click();
    await firstSubmit;
    const editor = page.locator(".cm-content");
    if (inputEvent) await editor.fill("edited code");
    else await editor.evaluate((element) => { element.textContent = "edited code"; });
    await page.waitForFunction(() => window.ideAcknowledged === 1);
    await page.evaluate(() => window.finishSample("AC"));
    await page.getByText("未测", { exact: true }).waitFor();
    const summary = await page.locator(".luogusp-ide-summary").textContent();
    assert.match(summary, /结果已过期/);
    assert.doesNotMatch(summary, /通过/);
    assert.deepEqual(submitted, [{ lang: 1, code: "code", input: "first", o2: "" }]);
  });
}

for (const setting of ["compiler", "O2", "O2 without an event"]) {
  test(`IDE batch stops when ${setting} changes during a pending sample`, async (t) => {
    const firstResponse = responseGate(t);
    const { page, submitted, firstSubmit } = await ideFixture(t, async (route, index) => {
      if (index === 1) await firstResponse.promise;
      return route.fulfill({ json: { status: 200, data: { rid: index } } });
    });
    const batch = page.locator(".luogusp-ide-batch-btn");
    await batch.click();
    await firstSubmit;
    if (setting === "compiler")
      await page.locator(".lang-select > .text").evaluate((element) => { element.textContent = "C++17"; });
    else if (setting === "O2")
      await page.locator("label[for=ide-o2]").click();
    else
      await page.locator("#ide-o2").evaluate((element) => { element.checked = true; });
    await page.evaluate(() => { window.autoFinishSamples = true; });
    firstResponse.release();
    await page.waitForFunction(() => !document.querySelector(".luogusp-ide-batch-btn").disabled);
    assert.deepEqual(submitted, [{ lang: 1, code: "code", input: "first", o2: "" }]);
    assert.deepEqual(await page.locator(".luogusp-ide-pill").allTextContents(), ["AC", "未测"]);
    const summary = page.locator(".luogusp-ide-summary");
    assert.match(await summary.textContent(), /结果已过期/);
    assert.doesNotMatch(await summary.textContent(), /通过/);

    await batch.click();
    await page.getByText("2/2 通过", { exact: true }).waitFor();
    const newConfig = { lang: setting === "compiler" ? 2 : 1, code: "code", o2: setting === "compiler" ? "" : "true" };
    assert.deepEqual(submitted.slice(1), [
      { ...newConfig, input: "first" }, { ...newConfig, input: "second" },
    ]);
  });
}

test("IDE batch allows compilers without an O2 control", async (t) => {
  const { page, submitted } = await ideFixture(t);
  await page.evaluate(() => {
    document.querySelector(".lang-select > .text").textContent = "Python";
    document.querySelector("#ide-o2").remove();
    document.querySelector("label[for=ide-o2]").remove();
    window.autoFinishSamples = true;
  });
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.getByText("2/2 通过", { exact: true }).waitFor();
  assert.deepEqual(submitted, [
    { lang: 2, code: "code", input: "first", o2: "" },
    { lang: 2, code: "code", input: "second", o2: "" },
  ]);
});

test("IDE batch accepts saved CRLF source when CodeMirror has normalized its line endings", async (t) => {
  const { page, submitted } = await ideFixture(t);
  const code = "first line\r\nsecond line\r\n";
  await page.evaluate((savedCode) => {
    const editor = document.querySelector(".cm-content");
    editor.cmTile = { view: { state: { doc: savedCode.replaceAll("\r\n", "\n") } } };
    window.transformIdeSubmit = (body) => ({ ...body, code: savedCode });
    window.autoFinishSamples = true;
  }, code);
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.getByText("2/2 通过", { exact: true }).waitFor();
  assert.deepEqual(submitted, [
    { lang: 1, code, input: "first", o2: "" },
    { lang: 1, code, input: "second", o2: "" },
  ]);
});

test("IDE batch rejects a compiler ID drift in the POST when the control remains unchanged", async (t) => {
  const { page, submitted } = await ideFixture(t);
  await page.clock.install();
  await page.evaluate(() => {
    window.autoFinishSamples = true;
    window.transformIdeSubmit = (body, index) => index === 1 ? { ...body, lang: 2 } : body;
  });
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.waitForFunction(() => window.ideAcknowledged === 2);
  await page.clock.fastForward(10_001);
  assert.deepEqual(submitted, [
    { lang: 1, code: "code", input: "first", o2: "" },
    { lang: 2, code: "code", input: "second", o2: "" },
  ]);
  await page.getByText("代码或编译设置已更改 · 结果已过期 · 1 UKE", { exact: true }).waitFor();
  assert.deepEqual(await page.locator(".luogusp-ide-pill").allTextContents(), ["AC", "UKE"]);
  assert.equal(await page.locator(".lang-select > .text").textContent(), "C++");
  await page.locator(".luogusp-ide-batch-btn").click();
  await page.getByRole("button", { name: "上次运行结果未确认，请刷新页面后重试", exact: true }).waitFor();
  assert.equal(submitted.length, 2);
});

for (const queued of [true, false]) {
  test(`problem coloring agrees with the preview after a ${queued ? "queued" : "running"} detail`, async (t) => {
    const detail = responseGate(t);
    const title = "Resolved problem detail";
    const { page, requests } = await fixture(t, {
      useClock: true,
      html: fixtureHtml((queued ? '<a href="/problem/P9999">P9999</a>' : "") +
        '<a id="problem-link" href="/problem/P1000"><span class="pid">P1000</span> Problem</a>'),
      initScript: `
        const problemFetch = window.fetch;
        window.problemFetchStarts = {};
        window.fetch = (input, init) => {
          const path = new URL(input, location.href).pathname;
          if (path.startsWith("/problem/")) problemFetchStarts[path] = Date.now();
          return problemFetch(input, init);
        };`,
      reply(route, url) {
        if (url.pathname === "/problem/P9999") return route.fulfill({
          json: { user: viewer, data: { problem: { pid: "P9999", difficulty: 1 } } },
        });
        if (url.pathname === "/training/100") return route.fulfill({
          json: { user: viewer, data: { training: { problems: [{ pid: problem.pid, difficulty: 2 }] } } },
        });
        if (url.pathname === "/problem/P1000") return detail.promise.then(() => route.fulfill({
          json: { user: viewer, data: { problem: { pid: problem.pid, difficulty: 4, name: title } } },
        }));
        if (url.pathname === "/record/list") return route.fulfill({
          json: { template: "record.list", user: viewer, data: { records: { result: [] } } },
        });
      },
    });
    const trigger = page.locator("#problem-link");
    const pid = trigger.locator(".pid");
    const inlineColor = locator => locator.evaluate(node => node.style.color);
    const target = request => new URL(request.url()).pathname === "/problem/P1000";
    const response = page.waitForResponse(result => target(result.request()));
    await page.clock.runFor(350);
    const nativeAt = await page.evaluate(() => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const at = Date.now();
      xhr.open("GET", "/training/100");
      xhr.onloadend = () => xhr.status === 200 ? resolve(at) : reject(new Error(`HTTP ${xhr.status}`));
      xhr.send();
    }));
    assert.equal(await inlineColor(pid), "rgb(243, 156, 17)", "native summary initially paints tier 2");
    await page.clock.runFor(300);
    const detailAt = await page.evaluate(() => problemFetchStarts["/problem/P1000"]);
    assert.ok(queued ? detailAt > nativeAt : detailAt < nativeAt, `native ${nativeAt}, detail ${detailAt}`);
    detail.release();
    await (await response).finished();
    await trigger.press("Alt+ArrowDown");
    const preview = card(page);
    await preview.getByText(`P1000 ${title}`, { exact: true }).waitFor();
    const expected = queued ? "rgb(82, 196, 26)" : "rgb(243, 156, 17)";
    assert.equal(await inlineColor(preview.locator(".luogusp-hc-title span")), expected);
    assert.equal(await inlineColor(pid), expected, "page PID should match the shared preview difficulty");
    assert.equal(requests.filter(request => request.path === "/problem/P1000").length, 1);
  });
}

test("preview-only detail refresh recolors existing and new problem links", async (t) => {
  const detail = responseGate(t);
  const title = "Preview-only detail";
  const { page, requests } = await fixture(t, {
    useClock: true,
    html: fixtureHtml(`<a id="problem-link" href="/problem/P1000"><span class="pid">P1000</span></a>
      <a href="/problem/P1000"><span class="pid lcolor--pink-3">P1000</span></a>
      <div><span class="pid" title=" P1000 ">P1000</span><a href="/problem/P1000">Problem</a></div>`,
    { recommendations: [{ pid: problem.pid, difficulty: 2 }] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return detail.promise.then(() => route.fulfill({
        json: { user: viewer, data: { problem: { pid: problem.pid, difficulty: 4, name: title } } },
      }));
    },
  });
  const problemRequests = () => requests.filter(({ path }) => path === "/problem/P1000");
  const colors = () => page.locator("main .pid").evaluateAll(nodes => nodes.map(node => node.style.color));
  const trigger = page.locator("#problem-link");
  const orange = "rgb(243, 156, 17)";
  const green = "rgb(82, 196, 26)";
  await page.clock.runFor(350);
  assert.deepEqual(await colors(), [orange, "", orange]);
  assert.equal(problemRequests().length, 0, "coloring uses embedded data without a request");
  const requested = page.waitForRequest(request => new URL(request.url()).pathname === "/problem/P1000");
  await trigger.press("Alt+ArrowDown");
  await requested;
  detail.release();
  const preview = card(page);
  await preview.getByText(`P1000 ${title}`, { exact: true }).waitFor();
  assert.equal(await preview.locator(".luogusp-hc-title span").evaluate(node => node.style.color), green);
  await page.locator("main").evaluate(node => {
    node.insertAdjacentHTML("beforeend", '<a href="/problem/P1000"><span class="pid">P1000</span></a>');
  });
  assert.deepEqual(await colors(), [green, "", green, green]);
  assert.equal(problemRequests().length, 1, "the preview is the only problem detail request");
});

test("scoped native difficulty refreshes matching IDs without another detail lookup", async (t) => {
  const href = "/problem/P1000?contestId=123&lang=en";
  const link = `<a id="scoped" href="${href}"><span class="pid">P1000</span></a>`;
  const title = "Scoped native detail";
  const { page, requests } = await fixture(t, {
    html: fixtureHtml(link + `<a href="${href}"><span class="pid lcolor--pink-3">P1000</span></a>` +
      '<a href="/problem/P1000"><span class="pid">P1000</span></a>', { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return route.fulfill({ json: { user: viewer, data: { problem:
        url.searchParams.has("_contentOnly") ? problem : { ...problem, name: title, difficulty: 4 },
      } } });
    },
  });
  const colors = () => page.locator("main .pid").evaluateAll(nodes => nodes.map(node => node.style.color));
  const orange = "rgb(243, 156, 17)";
  const green = "rgb(82, 196, 26)";
  await page.waitForFunction(() => document.querySelector("#scoped .pid").style.color !== "");
  assert.deepEqual(await colors(), [orange, "", orange]);
  await page.evaluate((path) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path);
    xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.send();
  }), href);
  const existing = await colors();
  await page.locator("main").evaluate((node, link) => node.insertAdjacentHTML("beforeend", link.replace(' id="scoped"', "")), link);
  await page.locator("#scoped").press("Alt+ArrowDown");
  const preview = card(page);
  await preview.getByText(`P1000 ${title}`, { exact: true }).waitFor();
  assert.equal(await preview.locator(".luogusp-hc-title span").evaluate(node => node.style.color), green);
  assert.deepEqual(existing, [green, "", orange]);
  assert.deepEqual(await colors(), [green, "", orange, green]);
  assert.deepEqual(requests.filter(({ path }) => path === "/problem/P1000").map(({ query, type }) => [query, type]), [
    ["?contestId=123&lang=en&_contentOnly=1", "fetch"], ["?contestId=123&lang=en", "xhr"],
  ]);
});

test("same-millisecond scoped native details do not repaint an older difficulty", async (t) => {
  const href = "/problem/P1000?contestId=123&lang=en";
  const older = responseGate(t);
  const { page, requests } = await fixture(t, {
    path: href,
    html: fixtureHtml(`<a href="${href}"><span class="pid">P1000</span></a>`, {
      problem: { ...problem, difficulty: 1 },
    }),
    initScript: "Date.now = () => 1000;",
    reply(route, url) {
      if (url.pathname !== "/problem/P1000") return;
      const reply = (difficulty) => route.fulfill({ json: { user: viewer, data: {
        problem: { ...problem, difficulty },
      } } });
      return url.searchParams.get("source") === "older" ? older.promise.then(() => reply(2)) : reply(4);
    },
  });
  const color = () => page.locator("main .pid").evaluate(node => node.style.color);
  assert.equal(await color(), "rgb(254, 76, 97)");
  const native = page.evaluate(async (path) => {
    const request = (source) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `${path}&source=${source}`);
      xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
      xhr.send();
    });
    await Promise.all([request("older"), request("newer")]);
  }, href);
  const green = "rgb(82, 196, 26)";
  await page.waitForFunction((color) => document.querySelector("main .pid").style.color === color, green);
  older.release();
  await native;
  assert.equal(await color(), green);
  assert.equal(requests.filter(({ path, type }) => path === "/problem/P1000" && type === "fetch").length, 0);
});

test("first native confirmation of the legacy viewer preserves a pending problem lookup", async (t) => {
  const detail = responseGate(t);
  const { page, requests } = await fixture(t, {
    html: fixtureHtml('<a href="/problem/P1000"><span class="pid">P1000</span></a>', {}, { user: undefined }),
    initScript: "window._feInjection = { currentUser: { uid: 42 } };",
    reply(route, url) {
      if (url.pathname === "/problem/P1000") return detail.promise.then(() => route.fulfill({
        json: { user: viewer, data: { problem: { ...problem, difficulty: 4 } } },
      }));
      if (url.pathname === "/problem/P1234") return route.fulfill({
        json: { user: viewer, data: { problem: { pid: "P1234", difficulty: 1 } } },
      });
    },
  });
  const problemRequest = ({ path, type }) => path === "/problem/P1000" && type === "fetch";
  await t.waitFor(() => assert.equal(requests.filter(problemRequest).length, 1));
  await page.evaluate(() => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/problem/P1234?lang=en");
    xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.send();
  }));
  detail.release();
  await page.waitForFunction(() => document.querySelector("main .pid").style.color === "rgb(82, 196, 26)");
  assert.equal(requests.filter(problemRequest).length, 1);
});

for (const sameProblem of [false, true]) {
  test(`same-millisecond native detail paints in request order after a list for ${sameProblem ? "the same" : "another"} problem`, async (t) => {
    const detail = responseGate(t);
    const title = "Earlier native detail";
    const { page, requests } = await fixture(t, {
      html: fixtureHtml('<a href="/problem/P1000"><span class="pid">P1000</span></a>',
        { recommendations: [{ ...problem, difficulty: 1 }] }, { user: null }),
      initScript: "Date.now = () => 1000;",
      reply(route, url) {
        if (url.pathname === "/problem/list") return route.fulfill({
          json: { data: { problems: [{ pid: sameProblem ? problem.pid : "P1234", difficulty: 2 }] } },
        });
        if (url.pathname === "/problem/P1000" && !url.search) return detail.promise.then(() => route.fulfill({
          json: { data: { problem: { pid: problem.pid, name: title, difficulty: 4 } } },
        }));
      },
    });
    const trigger = page.locator("main a");
    const inlineColor = (locator) => locator.evaluate(node => node.style.color);
    const red = "rgb(254, 76, 97)";
    const orange = "rgb(243, 156, 17)";
    const green = "rgb(82, 196, 26)";
    assert.equal(await inlineColor(trigger.locator(".pid")), red);
    const native = page.evaluate(() => {
      const request = (path) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", path);
        xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
        xhr.send();
      });
      const detail = request("/problem/P1000");
      const list = request("/problem/list").then(() => { window.fixtureListApplied = true; });
      return Promise.all([detail, list]);
    });
    await page.waitForFunction(() => window.fixtureListApplied);
    assert.equal(await inlineColor(trigger.locator(".pid")), sameProblem ? orange : red);
    detail.release();
    await native;
    const painted = await inlineColor(trigger.locator(".pid"));
    await trigger.press("Alt+ArrowDown");
    const preview = card(page);
    await preview.getByText(`P1000 ${title}`, { exact: true }).waitFor();
    const expected = sameProblem ? orange : green;
    assert.equal(await inlineColor(preview.locator(".luogusp-hc-title span")), expected);
    assert.equal(painted, expected);
    assert.deepEqual(requests.filter(({ path, type }) => path.startsWith("/problem/") && type === "fetch"), []);
  });
}

test("problem coloring resolves missing IDs after an observed viewer switch", async (t) => {
  const detail = responseGate(t);
  const link = '<a href="/problem/P1000"><span class="pid">P1000</span></a>';
  const next = { uid: 43 };
  const { page, requests } = await fixture(t, {
    html: fixtureHtml(link, { recommendations: [problem] }),
    reply(route, url) {
      if (url.pathname === "/problem/list") return route.fulfill({ json: { user: next, data: {
        problems: { result: [{ pid: "P1234", difficulty: 1 }] },
      } } });
      if (url.pathname === "/problem/P1000") return detail.promise.then(() => route.fulfill({
        json: { user: next, data: { problem: { ...problem, difficulty: 4 } } },
      }));
    },
  });
  const colors = () => page.locator("main .pid").evaluateAll(nodes => nodes.map(node => node.style.color));
  assert.deepEqual(await colors(), ["rgb(243, 156, 17)"]);
  assert.equal(requests.filter(({ path }) => path === "/problem/P1000").length, 0);
  await page.evaluate((link) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/problem/list");
    xhr.onloadend = () => {
      if (xhr.status !== 200) return reject(new Error(`HTTP ${xhr.status}`));
      document.querySelector("main").insertAdjacentHTML("beforeend", link);
      resolve();
    };
    xhr.send();
  }), link);
  const whilePending = await colors();
  detail.release();
  assert.deepEqual(whilePending, ["", ""], "previous viewer colors do not linger during the new lookup");
  await page.waitForFunction(() => [...document.querySelectorAll("main .pid")].every(node => node.style.color === "rgb(82, 196, 26)"));
  assert.deepEqual(requests.filter(({ path }) => path === "/problem/P1000").map(({ query }) => query), ["?_contentOnly=1"]);
});

test("problem coloring refreshes after returning to a viewer with a pending detail", async (t) => {
  const earlier = responseGate(t);
  const link = '<a href="/problem/P1000"><span class="pid">P1000</span></a>';
  let details = 0;
  const { page } = await fixture(t, {
    html: fixtureHtml(link),
    reply(route, url) {
      if (url.pathname === "/problem/list") {
        const uid = Number(url.searchParams.get("fixture-viewer"));
        return route.fulfill({ json: { user: { uid }, data: { problems: {
          result: uid === 43 ? [{ ...problem, difficulty: 5 }] : [],
        } } } });
      }
      if (url.pathname === "/problem/P1000") {
        const reply = (difficulty) => route.fulfill({ json: { user: viewer, data: { problem: { ...problem, difficulty } } } });
        return ++details === 1 ? earlier.promise.then(() => reply(2)) : reply(4);
      }
    },
  });
  const changeViewer = (uid) => page.evaluate((uid) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `/problem/list?fixture-viewer=${uid}`);
    xhr.onloadend = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.send();
  }), uid);
  const style = () => page.locator("main .pid").evaluate(node => node.style.color);
  assert.equal(await style(), "");
  await t.waitFor(() => assert.equal(details, 1));
  await changeViewer(43);
  assert.notEqual(await style(), "");
  await changeViewer(42);
  earlier.release();
  await page.waitForFunction(() => document.querySelector("main .pid").style.color !== "");
  assert.equal(await style(), "rgb(82, 196, 26)");
  assert.equal(details, 2);
});

test("academic record colors follow late and recycled status links", async (t) => {
  const records = [
    { id: 77, problem: { pid: "P1000", difficulty: 5 } },
    { id: 78, problem: { pid: "P1000", difficulty: 7 } },
  ];
  const { page, requests } = await fixture(t, {
    path: "/record/list?user=42",
    html: fixtureHtml(`<style>:root{--lfe-color--cyan-3:rgb(42,150,151);--lfe-color--purple-3:rgb(167,89,242)}</style>
      <div id="status-cell"><span id="status-slot"></span></div>
      <div class="problem"><a href="/problem/P1000"><strong>P1000</strong> Problem</a></div>`,
    { records: { result: records } }, { user: { ...viewer, learnMode: true }, template: "record.list" }),
  });
  const pid = page.locator("main strong");
  const state = () => pid.evaluate((node) => new Promise((resolve) => requestAnimationFrame(() => {
    const style = getComputedStyle(node);
    resolve({ color: style.color, inlineColor: node.style.color, fontWeight: style.fontWeight });
  })));
  // Wait past the initial fallback rescan so DOM changes alone must repaint.
  await page.waitForTimeout(400);
  assert.equal((await state()).inlineColor, "");
  await page.locator("#status-slot").evaluate(node => {
    node.innerHTML = '<a class="status" href="/record/77">Accepted</a>';
  });
  assert.equal((await state()).color, "rgb(42, 150, 151)", "a late status adds the record's color");
  await page.locator("#status-slot a").evaluate(node => { node.href = "/record/78"; });
  assert.equal((await state()).color, "rgb(167, 89, 242)", "same PID with another record ID repaints");
  await page.locator("#status-slot").evaluate(node => {
    node.innerHTML = '<a class="status" href="/record/77">Accepted</a>';
  });
  assert.equal((await state()).color, "rgb(42, 150, 151)", "replacing the status link restores the first color");
  await page.locator("#status-cell").evaluate(node => {
    node.outerHTML = '<div id="status-cell"><a class="status" href="/record/78">Accepted</a></div>';
  });
  assert.equal((await state()).color, "rgb(167, 89, 242)", "replacing the status cell repaints its neighbor");
  await page.locator("#status-cell a").evaluate(node => { node.classList.remove("status"); });
  assert.equal((await state()).inlineColor, "", "an anchor without status no longer supplies difficulty");
  await page.locator("#status-cell a").evaluate(node => { node.classList.add("status"); });
  assert.equal((await state()).color, "rgb(167, 89, 242)");
  await page.locator("#status-cell").evaluate(node => node.remove());
  const cleared = await state();
  assert.equal(cleared.inlineColor, "", "removing the status cell removes its associated color");
  assert.equal(cleared.fontWeight, "700");
  assert.equal(requests.filter(request => request.path.startsWith("/problem/")).length, 0);
});

for (const httpStatus of [200, 403]) {
  test(`reused problem links discard ordinary paint for a contest lookup returning ${httpStatus}`, async (t) => {
    const scoped = responseGate(t);
    const { page, requests } = await fixture(t, {
      html: fixtureHtml(`<div id="problem-row"><span class="pid" title="P1000">P1000</span>
        <a id="problem-link" href="/problem/P1000"><span class="pid">P1000</span> Problem</a></div>`,
        { recommendations: [{ ...problem, difficulty: 4 }] }),
      async reply(route, url) {
        if (url.pathname === "/problem/P1000" && url.searchParams.get("contestId") === "123") {
          await scoped.promise;
          return route.fulfill({ status: httpStatus, json: { data: { problem: { ...problem, difficulty: 2 } } } });
        }
      },
    });
    const link = page.locator("#problem-link");
    const colors = () => page.locator("#problem-row .pid").evaluateAll(nodes => nodes.map(node => node.style.color));
    const waitForColor = (color) => page.waitForFunction(expected =>
      [...document.querySelectorAll("#problem-row .pid")].every(node => node.style.color === expected), color);
    const isScopedRequest = request => request.url().includes("/problem/P1000?contestId=123&lang=en&");
    await waitForColor("rgb(82, 196, 26)");
    const requested = page.waitForRequest(isScopedRequest);
    const response = page.waitForResponse(result => isScopedRequest(result.request()));
    await link.evaluate(node => { node.href = "/problem/P1000?contestId=123&lang=en"; });
    await requested;
    const whilePending = await colors();
    scoped.release();
    await (await response).finished();
    assert.deepEqual(whilePending, ["", ""], "contest link must lose ordinary paint while the lookup is pending");
    if (httpStatus === 200) {
      await waitForColor("rgb(243, 156, 17)");
    } else {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.deepEqual(await colors(), ["", ""], "a denied lookup leaves the link uncolored");
    }
    await link.evaluate(node => { node.href = "/problem/P1000"; });
    await waitForColor("rgb(82, 196, 26)");
    assert.deepEqual(requests.filter(request => request.path === "/problem/P1000").map(request => request.query),
      ["?contestId=123&lang=en&_contentOnly=1"]);
  });
}

test("bundled app still colors academic records and drops queued requests on navigation", async (t) => {
  const record = { id: 77, problem: { pid: "P1000", difficulty: 5 } };
  const data = { records: { result: [record] } };
  const row = '<div><a class="status" href="/record/77">Accepted</a></div>' +
    '<div class="problem"><a href="/problem/P1000"><strong>P1000</strong> Problem</a></div>';
  const { page, requests } = await fixture(t, {
    path: "/record/list?user=42",
    html: fixtureHtml(`<style>:root{--lfe-color--cyan-3:rgb(42,150,151)}</style>${row}`, data,
      { user: { ...viewer, learnMode: true }, template: "record.list" }),
    reply(route, url) {
      if (url.pathname === "/record/list") return route.fulfill({ json: {
        user: { ...viewer, learnMode: false }, template: "record.list", data,
      } });
      if (/^\/problem\/P981[123]$/.test(url.pathname)) return route.fulfill({ json: {
        user: viewer, data: { problem: { pid: url.pathname.split("/").at(-1), difficulty: 1 } },
      } });
    },
  });
  const pid = page.locator("main strong");
  await page.waitForFunction(() => getComputedStyle(document.querySelector("main strong")).color === "rgb(42, 150, 151)");
  assert.equal(await pid.evaluate(el => getComputedStyle(el).fontWeight), "700");
  await page.evaluate((html) => new Promise(resolve => {
    const path = "/record/list?pid=P1000";
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path);
    xhr.onloadend = () => {
      history.pushState({}, "", path);
      document.querySelector("main").innerHTML = html;
      resolve();
    };
    xhr.send();
  }), row);
  await page.waitForFunction(() => !document.querySelector("main strong").style.color);
  assert.equal(requests.filter(r => r.path.startsWith("/problem/")).length, 0);

  const first = page.waitForRequest(request => request.url().includes("/problem/P9811?"));
  await page.evaluate(() => {
    history.pushState({}, "", "/?queue=1");
    document.querySelector("main").innerHTML = ["P9811", "P9812", "P9813"]
      .map(pid => `<a href="/problem/${pid}">${pid}</a>`).join(" ");
  });
  await first;
  await page.evaluate(() => {
    history.pushState({}, "", "/record/77");
    document.querySelector("main").replaceChildren();
  });
  await page.waitForTimeout(700);
  assert.deepEqual(requests.filter(r => r.path.startsWith("/problem/")).map(r => r.path), ["/problem/P9811"]);
});

test("record modes and abandoned queries still pass the problem-color browser scenarios", async () => {
  const { server } = await import("./problem-color-local.mjs");
  if (!server.listening) await once(server, "listening");
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/problem/P1001`);
    await page.waitForFunction(() => !!document.body.dataset.result, null, { timeout: 5000 });
    assert.equal(await page.locator("body").getAttribute("data-result"), "passed", await page.locator("#failure").textContent());
    assert.equal(await page.locator("#results li").count(), 9);
  } finally {
    await page.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
