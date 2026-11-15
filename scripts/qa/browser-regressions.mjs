import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
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
  initScript = "", useClock = false, ...options
}) {
  const page = await browser.newPage(options);
  const errors = [];
  const requests = [];
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().startsWith("LuoguSP")) errors.push(message.text());
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

function restrictedFixture(t, type, id, data, options = {}) {
  const path = `/${type}/${id}`;
  const saver = "https://api.luogu.me";
  const assets = "https://fecdn.luogu.com.cn";
  const headers = { "access-control-allow-origin": "*" };
  const { nativeScript = "", ...pageOptions } = options;
  const scaffold = `<meta name="csrf-token" content="fixture-token">
    <script id="lentille-context" type="application/json">${JSON.stringify({ user: viewer })}</script>
    <script src="${assets}/fixture.js"></script>`;
  return fixture(t, {
    path, waitForSettings: false, ...pageOptions,
    html: `<!doctype html><meta charset="utf-8"><title>安全访问中心</title><pre id="url">${origin}${path}</pre>`,
    reply(route, url) {
      if (url.origin === saver && url.pathname === `/${type}/query/${id}`)
        return route.fulfill({ headers, json: { code: 200, data } });
      if (url.origin === saver && url.pathname === `/article/comments/${id}`)
        return route.fulfill({ headers, json: { code: 200, data: { comments: [] } } });
      if (url.origin === origin && ["/ranking", "/discuss"].includes(url.pathname))
        return route.fulfill({ body: scaffold, contentType: "text/html" });
      if (url.origin === assets && url.pathname === "/fixture.js")
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

test("restricted native article is clickable without the optional time row", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    nativeScript: nativeArticle,
  });
  const action = page.getByRole("button", { name: "Native action" });
  await action.waitFor();
  await page.locator("#luogusp-rst-loader").waitFor({ state: "detached", timeout: 1000 });
  await action.click();
  assert.equal(await page.getByRole("button", { name: "Clicked" }).count(), 1);
  assert.equal(await page.locator(".luogusp-rst-abtn").count(), 2);
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
    nativeScript: 'document.querySelector("#app").innerHTML = \'<article class="paste-show-card"><pre>Saved paste</pre></article>\';',
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
  const restrictedStream = (signal, path, delay, body) => new Response(new ReadableStream({
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
  }));
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

const stalledSaver = restrictedStreams + `
  let restrictedQuery = 0;
  globalThis.fetch = (input, init) => {
    const url = new URL(input, location.origin);
    if (url.origin !== "https://api.luogu.me") return restrictedFetch(input, init);
    if (url.pathname.startsWith("/workflow/create/")) {
      reportRestricted("accepted", url.pathname);
      return Promise.resolve(Response.json({ code: 202 }));
    }
    const query = restrictedQuery++;
    if (query === 0) return Promise.resolve(Response.json({ code: 404 }));
    const delay = [14000, 8000, 14000][query - 1] ?? 14000;
    return Promise.resolve(restrictedStream(init.signal, String(query), delay, '{"code":404}'));
  };
`;

test("restricted Saver post-acceptance deadline aborts an in-flight query at 45 seconds", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    useClock: true, initScript: stalledSaver,
  });
  await page.clock.runFor(50);
  const accepted = page.getByText("该内容尚未被保存站收录", { exact: false });
  await accepted.waitFor();
  await page.clock.runFor(45000);
  await page.getByText("保存站在限定时间内未能完成收录。").waitFor({ timeout: 1000 });
  const trace = await page.evaluate(() => restrictedTrace);
  const start = trace[0][2];
  assert.deepEqual(trace.map(([event, path, time]) => [event, path, time - start]), [
    ["accepted", "/workflow/create/template/article-save-pipeline", 0],
    ["headers", "1", 3000], ["headers", "2", 23000],
    ["headers", "3", 43000], ["abort", "3", 45000],
  ]);
});

test("restricted route change aborts the active Saver query without showing stale failure", async (t) => {
  const { page } = await restrictedFixture(t, "article", "123", archiveArticle, {
    useClock: true, initScript: stalledSaver,
  });
  await page.clock.runFor(50);
  await page.getByText("该内容尚未被保存站收录", { exact: false }).waitFor();
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

test("problem preview renders native fields first and patches late records in place", async (t) => {
  const detail = responseGate(t);
  const record = responseGate(t);
  const { page } = await fixture(t, {
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
  record.release();
  await preview.getByText("上次尝试", { exact: true }).waitFor();
  assert.ok(await oldButton.evaluate(el => el === document.activeElement));
  assert.equal(await tags.getAttribute("aria-expanded"), "true");
  assert.equal(await preview.evaluate(el => el.scrollTop), scrollTop);
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

test("user preview joins a native XHR and shows basic fields ahead of the profile", async (t) => {
  const basic = responseGate(t);
  const profile = responseGate(t);
  const supplement = Promise.withResolvers();
  const { page, requests } = await fixture(t, {
    html: fixtureHtml('<a id="user" href="/user/123">User</a>')
      .replace("</head>", '<meta name="csrf-token" content="fixture-only"></head>'),
    reply(route, url) {
      if (url.pathname === "/api/user/info/123") return basic.promise.then(() => route.fulfill({ json: {
        user: { uid: 123, name: "Native user", elo: { rating: 1800 }, color: "Blue", userRelationship: 0, followerCount: 2 },
      } }));
      if (url.pathname === "/api/user/updateRelationShip" && route.request().method() === "POST")
        return route.fulfill({ json: {} });
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
  profile.release();
  await preview.getByText("咕值", { exact: true }).waitFor();
  assert.ok(await focused(name));
  assert.ok(await following.isEnabled());
  assert.deepEqual(requests.filter(r => r.path === "/api/user/info/123").map(r => r.type), ["xhr"]);
});

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

async function ideFixture(t, submitReply = (route, index) =>
  route.fulfill({ json: { status: 200, data: { rid: index } } })) {
  const submit = Promise.withResolvers();
  const submitted = [];
  const toolbar = (title, actions = "") => `<div class="ide-toolbar"><div class="title"><span class="text">${title}</span></div><div class="actions">${actions}</div></div>`;
  const { page, requests } = await fixture(t, {
    path: "/problem/P1000#ide",
    html: fixtureHtml(`
      ${toolbar("代码", "<button>自测</button>")}<div contenteditable="true" class="cm-content">code</div>
      <div class="io-sample-block">输入 #1 <button>运行</button></div>
      <div class="io-sample-block">输入 #2 <button>运行</button></div>
      <div><div class="panel-layout" style="display:flex">
        <div>${toolbar("输入")}<textarea class="ide-textarea"></textarea></div>
        <div id="output">${toolbar("输出", '<span>AC</span><span class="run-result"></span>')}<textarea class="ide-textarea"></textarea></div>
      </div></div>
      <script>
        window.ideAcknowledged = 0;
        document.querySelectorAll('.io-sample-block button').forEach(button => button.onclick = () => {
          document.querySelector('#output .actions span:not(.run-result)')?.remove();
          window.beforeSampleSubmit?.();
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/ide_submit');
          xhr.addEventListener('loadend', () => {
            if (xhr.status === 200) window.ideAcknowledged++;
          }, { once: true });
          xhr.send(document.querySelector('.cm-content').textContent);
        });
        window.finishSample = (verdict = 'WA') => {
          document.querySelector('#output textarea').value = 'a\\nextra\\nb\\nc\\nd';
          document.querySelector('#output .actions span:not(.run-result)')?.remove();
          document.querySelector('#output .actions').insertAdjacentHTML('afterbegin', '<span>' + verdict + '</span>');
        };
      </script>`, { problem: { ...problem, samples: [["first", "a\nb\nc\nd"], ["second", "ok"]] } }),
    reply(route, url) {
      if (url.origin === origin && url.pathname === "/api/ide_submit" &&
          route.request().method() === "POST") {
        submitted.push(route.request().postData());
        submit.resolve();
        return submitReply(route, submitted.length);
      }
      if (url.pathname.includes("/api/ide_submit"))
        return route.fulfill({ status: 418, json: {}, headers: { "access-control-allow-origin": "*" } });
    },
  });
  return { page, requests, submitted, firstSubmit: submit.promise };
}

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
  assert.equal(await page.locator(".luogusp-ide-tabbar, .luogusp-ide-panel, #luogusp-ide-style").count(), 0);
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
  assert.deepEqual(submitted, ["code"]);
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
  const { page, firstSubmit } = await ideFixture(t, async (route) => {
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
    };
  });
  const lookalikes = page.waitForResponse((response) =>
    response.url().endsWith("/api/ide_submit-other") && response.status() === 418);
  await page.locator(".luogusp-ide-batch-btn").click();
  await firstSubmit;
  await page.locator(".luogusp-ide-stop").click();
  await (await lookalikes).finished();
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
    assert.deepEqual(submitted, ["code"]);
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
