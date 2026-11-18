import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";
import { createMarkdownFullRenderer } from "../src/rendering/markdown-full.js";

function createRenderer(markedApi = marked) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://www.luogu.com.cn/",
    runScripts: "dangerously",
  });
  return {
    dom,
    renderer: createMarkdownFullRenderer({
      marked: markedApi,
      sanitizer: createDOMPurify(dom.window),
      katex,
      document: dom.window.document,
    }),
  };
}

test("full markdown renderer parses GFM, KaTeX, links, and images", () => {
  const { dom, renderer } = createRenderer();
  const result = renderer.renderMarkdown(
    "# Heading\n\n- [x] done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$\\frac{1}{2}$\n\n[link](https://example.test)\n\n![image](https://example.test/image.png)",
  );

  assert.equal(result.mode, "full");
  assert.deepEqual(result.warnings, []);
  const root = dom.window.document.createElement("div");
  root.innerHTML = result.html;
  assert.equal(root.querySelector("h1")?.textContent, "Heading");
  assert.equal(root.querySelector("input[type=checkbox]")?.checked, true);
  assert.equal(root.querySelectorAll("table tbody td").length, 2);
  assert.equal(root.querySelector(".katex") !== null, true);
  const link = root.querySelector("a");
  assert.equal(link?.target, "_blank");
  assert.equal(link?.rel, "noopener noreferrer");
  assert.equal(root.querySelector("img"), null);
  const imageLink = root.querySelector('a[href="https://example.test/image.png"]');
  assert.equal(imageLink?.textContent, "image");
  assert.equal(imageLink?.rel, "noopener noreferrer");
});

test("full markdown renderer removes executable HTML while retaining safe text", () => {
  const { dom, renderer } = createRenderer();
  const result = renderer.renderMarkdown(
    'safe <strong>text</strong>\n\n<script>window.__xss = true</script>\n\n<img src=x onerror="window.__xss = true">\n\n<a href="javascript:window.__xss = true">bad</a>\n\n<svg><g onload="window.__xss = true"></g></svg>\n\n<form id="attributes"><input name="action"></form>',
  );

  assert.equal(result.mode, "full");
  const root = dom.window.document.createElement("div");
  root.innerHTML = result.html;
  assert.equal(dom.window.__xss, undefined);
  assert.equal(root.querySelector("script"), null);
  assert.equal(root.querySelector("[onerror], [onload]"), null);
  assert.equal(root.querySelector('a[href^="javascript:"]'), null);
  assert.equal(root.textContent.includes("safe text"), true);
});

test("full markdown renderer falls back to MarkdownLite when Marked fails", () => {
  const { renderer } = createRenderer({
    parse() {
      throw new Error("synthetic failure");
    },
  });
  const result = renderer.renderMarkdown("# Lite heading\n\n**safe**");

  assert.equal(result.mode, "lite");
  assert.deepEqual(result.warnings, ["full-render-failed"]);
  assert.equal(
    result.html,
    "<p></p><h1>Lite heading</h1><p><strong>safe</strong></p>",
  );
});

test("full markdown renderer exposes a deterministic QA failure injection", () => {
  const { renderer } = createRenderer();
  const result = renderer.renderMarkdown("# Lite heading", {
    forceFullFailure: true,
  });

  assert.equal(result.mode, "lite");
  assert.deepEqual(result.warnings, ["full-render-failed"]);
  assert.equal(
    result.html,
    "<p></p><h1>Lite heading</h1><p></p>",
  );
});

for (const forceFullFailure of [false, true]) {
  test(`profile Markdown retains balanced image destinations and linked images in ${forceFullFailure ? "lite" : "full"} mode`, () => {
    const { dom, renderer } = createRenderer();
    const result = renderer.renderMarkdown([
      '![Cover](https://example.test/front(800).png "Cover title")',
      '[![Project screenshot](../screen(2).png "Screenshot title")](/article/fixture "Article title")',
      '[![Diagram](../diagram(2).png "Diagram title")](./gallery "Gallery title")',
      '[![Map](../map.png "Map title")](#chapter "Chapter title")',
      '**[Labeled `$code$` and $x$](/problem/P1000)**',
    ].join("\n\n"), { forceFullFailure });
    const root = dom.window.document.createElement("div");
    root.innerHTML = result.html;
    const links = [...root.querySelectorAll("a")];
    assert.deepEqual(links.map((link) => [link.getAttribute("href"), link.getAttribute("title")]), [
      ["https://example.test/front(800).png", "Cover title"],
      ["/article/fixture", "Article title"],
      ["https://www.luogu.com.cn/screen(2).png", "Screenshot title"],
      ["./gallery", "Gallery title"],
      ["https://www.luogu.com.cn/diagram(2).png", "Diagram title"],
      ["#chapter", "Chapter title"],
      ["https://www.luogu.com.cn/map.png", "Map title"],
      ["/problem/P1000", null],
    ]);
    assert.equal(links[1].textContent, "Project screenshot");
    assert.equal(links[2].textContent, "打开图片：Project screenshot");
    assert.ok(links.every((link) => link.target === "_blank" && link.rel === "noopener noreferrer"));
    assert.equal(root.querySelector("img, a a"), null);
    assert.equal(root.querySelector("strong > a > code")?.textContent, "$code$");
    assert.ok(root.querySelector("strong > a .katex"));
  });

  test(`profile Markdown preserves entity and reference image links in ${forceFullFailure ? "lite" : "full"} mode`, () => {
    const { dom, renderer } = createRenderer();
    const source = [
      '[![Diagram](./diagram.png?a=one&amp;b=two "Diagram &quot;A&quot;")](./gallery?mode=one&amp;page=2 "Gallery &amp; title")',
      '[![Map][map]][chapter]',
      '[chapter]: #section "Chapter title"\n[map]: ./map.png "Map title"',
      '[chapter]: /ignored',
    ].join("\n\n");
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown(source, { forceFullFailure }).html;
    assert.deepEqual(
      [...root.querySelectorAll("a")].map(({ textContent, href, title, rel }) => [textContent, href, title, rel]),
      [
        ["Diagram", "https://www.luogu.com.cn/gallery?mode=one&page=2", "Gallery & title", "noopener noreferrer"],
        ["打开图片：Diagram", "https://www.luogu.com.cn/diagram.png?a=one&b=two", 'Diagram "A"', "noopener noreferrer"],
        ["Map", "https://www.luogu.com.cn/#section", "Chapter title", "noopener noreferrer"],
        ["打开图片：Map", "https://www.luogu.com.cn/map.png", "Map title", "noopener noreferrer"],
      ],
    );
    assert.doesNotMatch(root.textContent, /\[(?:chapter|map)\]:/);
    assert.equal(root.querySelector("img, a a"), null);
    dom.window.close();
  });
}

for (const literal of ["%%LGMATH0&#58;0%%", "%%LGMATH0\\:0%%", "%%LGMATH&#48;:0%%"]) {
  test(`HTML and Markdown normalization cannot forge a math marker: ${literal}`, () => {
    const { dom, renderer } = createRenderer();
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown(literal + "\n\n$x$").html;
    assert.equal(root.firstElementChild.textContent, "%%LGMATH0:0%%");
    assert.equal(root.querySelectorAll(".katex").length, 1);
    dom.window.close();
  });
}
test("normalized author link attributes are not substituted as math", () => {
  const { dom, renderer } = createRenderer();
  const root = dom.window.document.createElement("div");
  root.innerHTML = renderer.renderMarkdown('[literal](https://example.test/%%LGMATH0&#58;0%% "$literal$")\n\n$x$').html;
  assert.equal(root.querySelector("a").getAttribute("href"), "https://example.test/%%LGMATH0:0%%");
  assert.equal(root.querySelector("a").getAttribute("title"), "$literal$");
  assert.equal(root.querySelectorAll(".katex").length, 1);
  dom.window.close();
});

test("Lite uses the Markdown URL policy for raw HTML image links", () => {
  const { dom, renderer } = createRenderer();
  const root = dom.window.document.createElement("div");
  root.innerHTML = renderer.renderMarkdown([
    '<a href="./gallery?theme=light&amp;size=2" title="Index &gt; list"><img src="./cover.png" alt="Cover"></a>',
    '<a href="https://user:pass@example.test/gallery">Credentialed link</a>',
  ].join("\n\n"), { forceFullFailure: true }).html;
  assert.deepEqual(
    [...root.querySelectorAll("a[href]")].map(({ textContent, href, title, rel }) => [textContent, href, title, rel]),
    [
      ["Cover", "https://www.luogu.com.cn/gallery?theme=light&size=2", "Index > list", "noopener noreferrer"],
      ["打开图片：Cover", "https://www.luogu.com.cn/cover.png", "", "noopener noreferrer"],
    ],
  );
  assert.match(root.textContent, /Credentialed link/);
  assert.equal(root.querySelector("img, a a"), null);
  dom.window.close();
});

for (const forceFullFailure of [false, true]) {
  const mode = forceFullFailure ? "lite" : "full";
  for (const length of [10000, 100000]) {
    test(`marker collision work stays bounded and preserves literals in ${mode} at ${length}`, () => {
      const { dom, renderer } = createRenderer();
      const stem = forceFullFailure ? "@@LGB" : "%%LGMATH";
      const run = stem + "X".repeat(length);
      const source = [run, `${stem}0:0%% ${stem}1:1@@`, "`$literal$`", "[link](https://example.test/$path$)", "$x+1$"].join("\n\n");
      const includes = String.prototype.includes;
      let work = 0;
      String.prototype.includes = function (search, ...args) {
        if (String(search).startsWith(stem)) {
          work += this.length + String(search).length;
          if (work > source.length * 8) throw new Error("Marker search exceeded linear scan budget");
        }
        return includes.call(this, search, ...args);
      };
      let result;
      try { result = renderer.renderMarkdown(source, { forceFullFailure }); }
      finally { String.prototype.includes = includes; }
      const root = dom.window.document.createElement("div");
      root.innerHTML = result.html;
      assert.ok(root.textContent.includes(run));
      assert.ok(root.textContent.includes(`${stem}0:0%% ${stem}1:1@@`));
      assert.equal(root.querySelector("code").textContent, "$literal$");
      assert.equal(root.querySelector("a").getAttribute("href"), "https://example.test/$path$");
      assert.equal(root.querySelectorAll(".katex").length, 1);
      dom.window.close();
    });
  }
  test("literal dollar delimiters in code and link attributes survive " + mode + " rendering", () => {
    const { dom, renderer } = createRenderer();
    const source = [
      'A literal \\$x\\$ and code `$code$`.',
      '[link](https://example.test/$path$ "$title$")',
      '[`$label$`](/problem/P1000)',
      '<code>$$</code> and $$x+1$$',
      '$x^{2} + y^{2}$',
      '$$\n\\frac{1}{2}\n$$',
    ].join("\n\n");
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown(source, { forceFullFailure }).html;
    assert.equal(root.querySelector("code")?.textContent, "$code$");
    assert.equal(root.querySelector("a code")?.textContent, "$label$");
    assert.ok(root.textContent.includes("A literal $x$"));
    assert.equal(root.querySelector("a")?.getAttribute("href"), "https://example.test/$path$");
    assert.equal(root.querySelector("a")?.getAttribute("title"), "$title$");
    assert.equal(root.querySelectorAll(".katex").length, 3);
    assert.equal(root.querySelectorAll(".katex-display").length, 2);
  });

  test("math past the size and count limits stays as text in " + mode + " rendering", () => {
    const { dom, renderer } = createRenderer();
    const oversized = "$" + "x".repeat(4097) + "$";
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown(
      [oversized, ...Array(64).fill("$x$"), "$beyond$"].join("\n\n"),
      { forceFullFailure },
    ).html;
    assert.equal(root.querySelectorAll(".katex").length, 64);
    assert.ok(root.textContent.includes(oversized));
    assert.ok(root.textContent.includes("$beyond$"));
  });
}
