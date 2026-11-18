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

for (const [container, definition] of [
  ["quote", '> Before definition\n>\n> [target]: ./gallery "Gallery"\n> [picture]: ./diagram.png "Diagram"\n>\n> After definition'],
  ["list", '- Before definition\n- [target]: ./gallery "Gallery"\n- [picture]: ./diagram.png "Diagram"\n- After definition'],
  ["list item", '- Before definition\n  \n  [target]: ./gallery "Gallery"\n  [picture]: ./diagram.png "Diagram"\n  \n  After definition'],
]) {
  test(`Lite resolves but hides reference definitions nested in a ${container}`, () => {
    const { dom, renderer } = createRenderer();
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown([
      "[![Picture][picture]][target]",
      definition,
      "> [target]: ./duplicate",
      "After container",
    ].join("\n\n"), { forceFullFailure: true }).html;
    assert.deepEqual(
      [...root.querySelectorAll("a[href]")].map((link) => [link.getAttribute("href"), link.title]),
      [["./gallery", "Gallery"], ["https://www.luogu.com.cn/diagram.png", "Diagram"]],
    );
    assert.match(root.textContent, /Before definition/);
    assert.match(root.textContent, /After definition/);
    assert.match(root.textContent, /After container/);
    assert.doesNotMatch(root.textContent, /\.\/(?:gallery|diagram\.png|duplicate)/);
    dom.window.close();
  });
}

test("Lite retains ordered and unordered items before a hidden reference definition at EOF", () => {
  const { dom, renderer } = createRenderer();
  const root = dom.window.document.createElement("div");
  for (const [tag, items] of [["ul", ["- ", "- "]], ["ol", ["1. ", "2. "]]]) {
    for (const tail of ["", "\n\nAfter list."]) {
      root.innerHTML = renderer.renderMarkdown(
        `[Book][go]\n\n${items[0]}First step\n${items[1]}[go]: ./album "Title"${tail}`,
        { forceFullFailure: true },
      ).html;
      assert.deepEqual([...root.querySelectorAll(`${tag} > li`)].map((item) => item.textContent), ["First step"]);
      const link = root.querySelector("a");
      assert.equal(link.getAttribute("href"), "./album");
      assert.equal(link.title, "Title");
      assert.doesNotMatch(root.textContent, /\[go\]:|\.\/album/);
    }
  }
  dom.window.close();
});

for (const [ending, newline] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  test(`Lite preserves lists with a hidden definition before a terminal ${ending}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    for (const [tag, first, second] of [["ul", "-", "-"], ["ol", "1.", "2."]]) {
      root.innerHTML = renderer.renderMarkdown([
        "[Book][go]", "", `${first} First step`, `${second} [go]: ./album "Title"`, "",
      ].join(newline), { forceFullFailure: true }).html;
      assert.deepEqual([...root.querySelectorAll(`${tag} > li`)].map((item) => item.textContent), ["First step"]);
      const link = root.querySelector("a");
      assert.equal(link.getAttribute("href"), "./album");
      assert.equal(link.title, "Title");
      assert.doesNotMatch(root.textContent, /\[go\]:|\.\/album/);
    }
  });

  test(`Lite preserves quoted code before a terminal ${ending}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    for (const [lines, selector, expected] of [
      [["> ~~~html", "> <b>Example</b>", "> ~~~"], "blockquote pre code.language-html", "<b>Example</b>"],
      [["> Show `<b>one", "> two</b>`."], "blockquote code", "<b>one two</b>"],
    ]) {
      root.innerHTML = renderer.renderMarkdown([...lines, ""].join(newline), { forceFullFailure: true }).html;
      assert.equal(root.querySelector(selector)?.textContent, expected);
      assert.equal(root.querySelector("b"), null);
      assert.doesNotMatch(root.textContent, />\s*(?:Show|~~~)/);
    }
  });
}

test("Lite recognizes quoted indented code from its own block context", (t) => {
  const { dom, renderer } = createRenderer();
  t.after(() => dom.window.close());
  const root = dom.window.document.createElement("div");
  const code = '<b>Example</b>\n<img src="./quoted.png" alt="Literal">';
  for (const prefix of ["", "Unrelated `code`.\n\n", '[go]: ./album "Title"\n\n']) {
    root.innerHTML = renderer.renderMarkdown(prefix + code.split("\n")
      .map((line) => ">     " + line).join("\n"), { forceFullFailure: true }).html;
    assert.equal(root.querySelector("blockquote pre code")?.textContent, code);
    assert.equal(root.querySelector("b, img, a[href*='quoted.png']"), null);
  }
});

test("Lite excludes quoted list continuation indentation from a multiline code span", (t) => {
  const { dom, renderer } = createRenderer();
  t.after(() => dom.window.close());
  const root = dom.window.document.createElement("div");
  for (const [marker, indent] of [["-", "  "], ["1.", "   "]]) {
    root.innerHTML = renderer.renderMarkdown([
      `> ${marker} Show \`<b>one`, `> ${indent}two</b>\` and [link][go].`,
      ">", '> [go]: ./album "Title"',
    ].join("\n"), { forceFullFailure: true }).html;
    assert.equal(root.querySelector("blockquote code")?.textContent, "<b>one two</b>");
    const link = root.querySelector("blockquote a");
    assert.equal(link.getAttribute("href"), "./album");
    assert.equal(link.title, "Title");
    assert.equal(root.querySelector("blockquote b"), null);
  }
});

test("Lite preserves fenced and inline code inside quotes", () => {
  const { dom, renderer } = createRenderer();
  const root = dom.window.document.createElement("div");
  root.innerHTML = renderer.renderMarkdown([
    '> ~~~html\n> <b>Example</b>\n> <img src="./example.png" alt="Literal">\n> ~~~',
    '> Show `<b>one\n> two</b>` and [link][quote].\n>\n> [quote]: ./quote "Quote"',
    '> **Bold text**',
  ].join("\n\n"), { forceFullFailure: true }).html;
  assert.equal(root.querySelector("blockquote pre code.language-html")?.textContent,
    '<b>Example</b>\n<img src="./example.png" alt="Literal">');
  assert.equal(root.querySelector("blockquote code:not(.language-html)")?.textContent, "<b>one two</b>");
  assert.equal(root.querySelector("blockquote strong").textContent, "Bold text");
  assert.equal(root.querySelector("blockquote a[title='Quote']").getAttribute("href"), "./quote");
  assert.equal(root.querySelector("blockquote b, img, a[href*='example.png']"), null);
  assert.doesNotMatch(root.textContent, /\[quote\]:/);
  dom.window.close();
});

for (const [kind, quote, links] of [
  ["Markdown link titles", '> [![Map](./cover.png\n> "Cover title")](./gallery\n> "Gallery title")',
    [["Map", "./gallery", "Gallery title"], ["打开图片：Map", "https://www.luogu.com.cn/cover.png", "Cover title"]]],
  ["a split raw anchor end", '> <a href="./gallery" title="Gallery title">Map</a\n> >\n> Outside the link.',
    [["Map", "./gallery", "Gallery title"]]],
]) {
  test(`Lite resolves ${kind} within its quote`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown(quote, { forceFullFailure: true }).html;
    assert.deepEqual([...root.querySelectorAll("blockquote a")].map((link) =>
      [link.textContent, link.getAttribute("href"), link.title]), links);
    assert.doesNotMatch(root.textContent, /[>]|@@LGB|\]\(/);
    assert.equal(root.querySelector("img, a a"), null);
  });
}

test("Lite keeps a quoted fence between paragraphs with unmatched backticks", (t) => {
  const { dom, renderer } = createRenderer();
  t.after(() => dom.window.close());
  const root = dom.window.document.createElement("div");
  const code = '<img src="./cover.png" alt="Literal">';
  root.innerHTML = renderer.renderMarkdown([
    "Before `", `> ~~~html\n> ${code}\n> ~~~`, "After `",
  ].join("\n\n"), { forceFullFailure: true }).html;
  assert.equal(root.querySelector("blockquote pre code")?.textContent, code);
  assert.deepEqual([...root.querySelectorAll(":scope > p")].map((p) => p.textContent), ["Before `", "After `"]);
  assert.equal(root.querySelector("img, a"), null);
  assert.doesNotMatch(root.textContent, /@@LGB/);
});

test("Lite preserves continued and loose lists with a hidden final definition", (t) => {
  const { dom, renderer } = createRenderer();
  t.after(() => dom.window.close());
  const root = dom.window.document.createElement("div");
  root.innerHTML = renderer.renderMarkdown([
    "[Book][go]", '- First step\n  Continued detail.\n- [local]: ./other "Other"',
    '3. First numbered step\n\n4. Second numbered step\n\n5. [go]: ./album "Title"',
  ].join("\n\n"), { forceFullFailure: true }).html;
  assert.equal(root.querySelector("ul > li")?.innerHTML, "First step<br>Continued detail.");
  assert.deepEqual([...root.querySelectorAll("ol")].map((list) => list.start), [3]);
  assert.deepEqual([...root.querySelectorAll("ol > li > p")].map((item) => item.textContent),
    ["First numbered step", "Second numbered step"]);
  const link = root.querySelector("a");
  assert.equal(link.getAttribute("href"), "./album");
  assert.equal(link.title, "Title");
  assert.doesNotMatch(root.textContent, /\[(?:go|local)\]:|\.\/(?:album|other)/);
});

test("Lite preserves empty list items and hides definition-only items", (t) => {
  const { dom, renderer } = createRenderer();
  t.after(() => dom.window.close());
  const root = dom.window.document.createElement("div");
  root.innerHTML = renderer.renderMarkdown([
    "[Book][go]",
    '7. Step one\n8.\n9. Step three\n10. [go]: ./album "Title"\n11. [go]: ./duplicate',
    "> - First bullet\n> -\n> - Third bullet",
  ].join("\n\n"), { forceFullFailure: true }).html;
  assert.equal(root.querySelector("ol")?.start, 7);
  assert.deepEqual([...root.querySelectorAll("ol > li")].map((item) => item.textContent),
    ["Step one", "", "Step three"]);
  assert.deepEqual([...root.querySelectorAll("blockquote > ul > li")].map((item) => item.textContent),
    ["First bullet", "", "Third bullet"]);
  const link = root.querySelector("a");
  assert.equal(link.getAttribute("href"), "./album");
  assert.equal(link.title, "Title");
  assert.doesNotMatch(root.textContent, /\[go\]:|\.\/(?:album|duplicate)/);
});

for (const forceFullFailure of [false, true]) test(`ordered list ordinals survive hidden reference definitions in ${forceFullFailure ? "lite" : "full"} mode`, (t) => {
  const { dom, renderer } = createRenderer();
  t.after(() => dom.window.close());
  const root = dom.window.document.createElement("div");
  root.innerHTML = renderer.renderMarkdown([
    "[Book][go]",
    '> 7. [head]: ./first\n> 8. Step eight\n> 9. [go]: ./album "Title"\n> 10.\n> 11. Step eleven\n> 12. [end]: ./last',
    "- One\n- [go]: ./duplicate\n-\n- Four",
  ].join("\n\n"), { forceFullFailure }).html;
  assert.deepEqual([...root.querySelectorAll("ol")].map((list) => list.start), [7]);
  const items = [...root.querySelectorAll("blockquote > ol > li")];
  assert.deepEqual(items.map((item) => item.textContent), ["Step eight", "", "Step eleven"]);
  assert.deepEqual(items.map((item) => item.getAttribute("value")), ["8", "10", null]);
  assert.deepEqual([...root.querySelectorAll("ul > li")].map((item) => [item.textContent, item.hasAttribute("value")]),
    [["One", false], ["", false], ["Four", false]]);
  const link = root.querySelector("a");
  assert.equal(link.getAttribute("href"), "./album");
  assert.equal(link.title, "Title");
  assert.doesNotMatch(root.textContent, /\[(?:head|go|end)\]:|\.\/(?:first|album|last|duplicate)/);
});

test("author markup allows value on list items only", (t) => {
  const { dom, renderer } = createRenderer();
  t.after(() => dom.window.close());
  const root = dom.window.document.createElement("div");
  root.innerHTML = renderer.renderMarkdown('<ol start="3"><li value="4"><span value="12">Four</span></li><li>Five</li></ol>').html;
  assert.equal(root.querySelector("ol").start, 3);
  assert.deepEqual([...root.querySelectorAll("ol > li")].map((item) => item.textContent), ["Four", "Five"]);
  assert.deepEqual([...root.querySelectorAll("[value]")].map((node) => [node.localName, node.getAttribute("value")]),
    [["li", "4"]]);
});

test("Lite preserves a list with a fence and a nested quote inside a quote", (t) => {
  const { dom, renderer } = createRenderer();
  t.after(() => dom.window.close());
  const root = dom.window.document.createElement("div");
  root.innerHTML = renderer.renderMarkdown(
    "> - Item\n>   ~~~html\n>   <b>Literal</b>\n>   ~~~\n>\n> > Nested quote.",
    { forceFullFailure: true },
  ).html;
  assert.equal(root.querySelector("blockquote > ul > li > pre > code")?.textContent, "<b>Literal</b>");
  assert.equal(root.querySelector("blockquote > blockquote")?.textContent, "Nested quote.");
  assert.equal(root.querySelector("b"), null);
});

for (const [context, wrap, title, alt, end] of [
  ["a div", (anchor) => `<div>\n${anchor}\n</div>`, "Gallery </a >", "Map </a >", "</a\n\n>"],
  ["a standalone anchor", (anchor) => anchor, "Gallery </a >", "Map </a >", "</a\n\n>"],
  ["a div with a multiline title", (anchor) => `<div>\n${anchor}\n</div>`,
    "Example </a\n\n> in title", "Map </a\n\n> in alt", "</a\n\n>"],
  ["a paragraph with a blank line before the end tag", (anchor) => `Before ${anchor}`,
    "Gallery </a >", "Map </a >", "\n\n</a\n\n>"],
]) {
  test(`Full closes a split raw HTML image anchor in ${context}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const result = renderer.renderMarkdown([
      wrap(`<a href="./gallery" title="${title}">\n` +
        `<img src="./cover.png" alt="${alt}" title="Cover </a >">${end}`),
      "Expected separate paragraph.",
      'Example: `</a >`. [Link](./text "Literal </a >")',
      "~~~html\n</a\n\n>\n~~~",
    ].join("\n\n"));
    assert.equal(result.mode, "full");
    root.innerHTML = result.html;
    assert.deepEqual([...root.querySelectorAll("a[href]")].map((link) =>
      [link.textContent.trim(), link.getAttribute("href"), link.title]), [
      [alt, "./gallery", title],
      [`打开图片：${alt}`, "https://www.luogu.com.cn/cover.png", "Cover </a >"],
      ["Link", "./text", "Literal </a >"],
    ]);
    assert.ok([...root.querySelectorAll("p")].some((node) =>
      node.textContent === "Expected separate paragraph." && !node.querySelector("a")));
    assert.equal(root.querySelector("img"), null);
    assert.deepEqual([...root.querySelectorAll("code")].map((node) => node.textContent.trim()),
      ["</a >", "</a\n\n>"]);
  });
}

for (const forceFullFailure of [false, true]) {
  test(`a multiline HTML anchor end confines the image label in ${forceFullFailure ? "lite" : "full"} mode`, () => {
    const { dom, renderer } = createRenderer();
    const root = dom.window.document.createElement("div");
    const anchors = ["</a\n>", "</A \t\n >", "</a\n\n>"].map((end) =>
      '<a href="./gallery"><img src="./cover.png" alt="Map">' + end);
    if (!forceFullFailure) anchors.push("- " + anchors[0].replace("\n", "\n  "),
      "> " + anchors[0].replace("\n", "\n> "));
    for (const anchor of anchors) {
      root.innerHTML = renderer.renderMarkdown([
        anchor,
        "Expected separate paragraph.",
        'Example: `</a >`. [Link](./text "Literal </a >")',
        '~~~html\n<a href="./example">Example</a\n>\n~~~',
      ].join("\n\n"), { forceFullFailure }).html;
      assert.deepEqual([...root.querySelectorAll("a[href]")].map((link) =>
        [link.textContent, link.getAttribute("href")]), [
        ["Map", "./gallery"],
        ["打开图片：Map", "https://www.luogu.com.cn/cover.png"],
        ["Link", "./text"],
      ]);
      assert.ok([...root.querySelectorAll("p")].some((node) =>
        node.textContent === "Expected separate paragraph." && !node.querySelector("a")));
      assert.equal(root.querySelector("img"), null);
      assert.equal(root.querySelector("a[href='./text']").title, "Literal </a >");
      assert.deepEqual([...root.querySelectorAll("code")].map((node) => node.textContent.trim()),
        ["</a >", '<a href="./example">Example</a\n>']);
    }
    dom.window.close();
  });

  test(`tag-shaped Markdown literals stay text in ${forceFullFailure ? "lite" : "full"} mode`, () => {
    const { dom, renderer } = createRenderer();
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown([
      '[Text](./text "Inline <b>title</b>")',
      "[![<b>Picture</b>][picture]][album]",
      '[album]: ./album "Reference <b>title</b>"\n[picture]: ./diagram.png "Image <b>title</b>"',
      'Show `<img src="./example.png" alt="Example">` and `<a href="./demo">Demo</a>` in code.',
      '<b title="ignored">Visible raw tag</b>',
    ].join("\n\n"), { forceFullFailure }).html;
    const links = [...root.querySelectorAll("a[href]")];
    assert.deepEqual(links.map(({ textContent, title }) => [textContent, title]), [
      ["Text", "Inline <b>title</b>"],
      ["<b>Picture</b>", "Reference <b>title</b>"],
      ["打开图片：<b>Picture</b>", "Image <b>title</b>"],
    ]);
    assert.deepEqual([...root.querySelectorAll("code")].map((node) => node.textContent), [
      '<img src="./example.png" alt="Example">',
      '<a href="./demo">Demo</a>',
    ]);
    assert.equal(root.querySelector("b")?.textContent, "Visible raw tag");
    assert.equal(root.querySelector("img"), null);
    assert.doesNotMatch(root.innerHTML, /@@LGB/);
    dom.window.close();
  });
}

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

  test(`display math keeps blank lines and negative terms together in ${mode} rendering`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const fence = "$$\n- c\n$$";
    const source = [
      "$$\na +\n\nb\n$$",
      "$$\n- x\n$$",
      "> $$\n> - y\n> $$",
      "- $$\n  - z\n  $$",
      "$$\nx^2\n$$",
      `~~~text\n${fence}\n~~~`,
      '`$$literal$$` and [Link](./$path$ "$title$").',
    ].join("\n\n");
    const result = renderer.renderMarkdown(source, { forceFullFailure });
    assert.equal(result.mode, mode);
    root.innerHTML = result.html;
    assert.deepEqual([...root.querySelectorAll(".katex-display .katex-html")].map((node) => node.textContent),
      ["a+b", "−x", "−y", "−z", "x2"]);
    assert.equal(root.querySelectorAll("ul").length, 1);
    assert.equal(root.querySelector("blockquote .katex-display .katex-html")?.textContent, "−y");
    assert.equal(root.querySelector("ul > li .katex-display .katex-html")?.textContent, "−z");
    assert.equal(root.querySelector("pre > code")?.textContent.trimEnd(), fence);
    assert.equal(root.querySelector("p > code")?.textContent, "$$literal$$");
    assert.deepEqual([root.querySelector("a")?.getAttribute("href"), root.querySelector("a")?.title],
      ["./$path$", "$title$"]);
  });

  test(`display math follows prose in ${mode} rendering without splitting literal inline content`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const literal = "inside\n$$\na+b\n$$\nafter";
    const source = [
      "Prose before a blank formula line.\n$$\na +\n\nb\n$$\nAfter the formula.",
      "Prose before a negative term.\n$$\n- x\n$$",
      "> Quoted prose.\n> $$\n> - y\n> $$\n> After the formula.",
      "> Quoted blank formula line.\n> $$\n> c +\n>\n> d\n> $$",
      `\`${literal}\` is code.`,
      `> **\`${literal.replaceAll("\n", "\n> ")}\` is quoted code.**`,
      `[Markdown link](./$path$ "${literal}")`,
      `Prose with a <a href="./$raw$" title="${literal}">raw link</a>.`,
      `~~~text\n${literal}\n~~~`,
      "Incomplete display.\n$$\nz",
    ].join("\n\n");
    const result = renderer.renderMarkdown(source, { forceFullFailure });
    assert.equal(result.mode, mode);
    root.innerHTML = result.html;
    assert.deepEqual([...root.querySelectorAll(".katex-display .katex-html")].map((node) => node.textContent),
      ["a+b", "−x", "−y", "c+d"]);
    assert.equal(root.querySelector("p .katex-display, ul, ol"), null);
    assert.deepEqual([...root.querySelectorAll("blockquote .katex-display .katex-html")].map((node) => node.textContent),
      ["−y", "c+d"]);
    assert.deepEqual([...root.querySelectorAll("p code")].map((code) => code.textContent),
      [literal.replaceAll("\n", " "), literal.replaceAll("\n", " ")]);
    assert.deepEqual([...root.querySelectorAll("a")].map((link) => [link.getAttribute("href"), link.title]),
      [["./$path$", literal], ["./$raw$", literal]]);
    assert.equal(root.querySelector("pre > code")?.textContent.trimEnd(), literal);
    assert.match(root.textContent, /Incomplete display\.\s*\$\$\s*z\s*$/);
  });

  for (const [gap, content] of [["", "- x"], ["", "a +\n\nb"], ["\n\n", "x"]]) {
    test(`display math preserves complete inline literals across paragraph breaks in ${mode}: ${JSON.stringify(content)}`, (t) => {
      const { dom, renderer } = createRenderer();
      t.after(() => dom.window.close());
      const root = dom.window.document.createElement("div");
      const literal = `inside\n${gap}$$\n${content}\n$$\nafter`;
      const result = renderer.renderMarkdown([
        `Code: \`${literal}\`.\nSame paragraph.`,
        `> Quoted \`${literal.replaceAll("\n", "\n> ")}\`.`,
        `[Markdown link](./path "${literal}")`,
        `Raw <a href="./raw" title="${literal}">raw link</a\n\n> stays outside.`,
        `~~~text\n${literal}\n~~~`,
        'Ordinary prose <a href="./control">control</a\n> stays outside.\n$$\n- y\n$$',
        "Incomplete.\n$$\nz",
      ].join("\n\n"), { forceFullFailure });
      assert.equal(result.mode, mode);
      root.innerHTML = result.html;
      assert.deepEqual([...root.querySelectorAll(".katex-display .katex-html")].map((node) => node.textContent), ["−y"]);
      const code = root.querySelector("p > code");
      assert.equal(code?.textContent, literal.replaceAll("\n", " "));
      assert.match(code?.parentElement.textContent, /Same paragraph\.$/);
      assert.equal(root.querySelector("blockquote p > code")?.textContent, literal.replaceAll("\n", " "));
      assert.equal(root.querySelector("pre > code")?.textContent.trimEnd(), literal);
      assert.deepEqual([...root.querySelectorAll("a")].map((link) => [link.getAttribute("href"), link.title, link.textContent]),
        [["./path", literal, "Markdown link"], ["./raw", literal, "raw link"], ["./control", "", "control"]]);
      assert.match(root.textContent, /stays outside\./);
      assert.match(root.textContent, /Incomplete\.\s*\$\$\s*z\s*$/);
    });
  }

  test(`complete link titles cross a blank after closing math delimiters in ${mode}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const title = "Part one\n$$\n- x\n$$\n\nPart two";
    root.innerHTML = renderer.renderMarkdown([
      `Before <a href="./notes" title="${title}">Notes</a>.`,
      `Before [Markdown notes](./markdown "${title}").`,
      'Before <a href="./unfinished" title="Unfinished\n$$\n- y\n$$\n\nOrdinary paragraph.',
      'Before `Unmatched\n$$\n- z\n$$\n\n~~~text\nfenced ` text\n~~~',
    ].join("\n\n"), { forceFullFailure }).html;
    assert.deepEqual([...root.querySelectorAll(".katex-display .katex-html")].map((node) => node.textContent), ["−y", "−z"]);
    assert.deepEqual([...root.querySelectorAll("a[href]")].map((link) => [link.getAttribute("href"), link.title]),
      [["./notes", title], ["./markdown", title]]);
    assert.equal(root.querySelector("pre > code")?.textContent.trimEnd(), "fenced ` text");
    assert.match(root.textContent, /Ordinary paragraph\./);
  });

  test(`tight lists preserve inline code and titles alongside real formulas in ${mode}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const literal = "line\n$$\nx\n$$\nafter";
    const indented = literal.replaceAll("\n", "\n  ");
    root.innerHTML = renderer.renderMarkdown([
      `- Code: \`${indented}\`.`,
      `- [Markdown notes](./markdown "${indented}").`,
      `- <a href="./notes" title="${indented}">Raw notes</a>.`,
      "- Prose.\n  $$\n  - y\n  $$\n  After math.\n  - Nested item.",
      "- Incomplete `code.\n  $$\n  - z\n  $$",
      "- Next.",
    ].join("\n"), { forceFullFailure }).html;
    assert.deepEqual([...root.querySelectorAll(".katex-display .katex-html")].map(node => node.textContent),
      ["−y", "−z"]);
    assert.equal(root.querySelector("ul > li > code")?.textContent, literal.replaceAll("\n", " "));
    assert.deepEqual([...root.querySelectorAll("ul > li > a")].map(link => [link.getAttribute("href"), link.title]),
      [["./markdown", literal], ["./notes", literal]]);
    assert.equal(root.querySelector("ul ul li")?.textContent.trim(), "Nested item.");
    assert.equal(root.querySelector(":scope > ul > li:last-child")?.textContent.trim(), "Next.");
  });

  test(`consecutive tentative formula blocks preserve complete literals and adjacent prose in ${mode}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const first = "first\n$$\n- x\n$$\nafter";
    const second = "second\n$$\n- y\n$$\nend";
    const together = first + "\n" + second;
    root.innerHTML = renderer.renderMarkdown([
      `Code: \`${together}\`.`,
      `First \`${first}\` and \`${second}\`.\nContinued prose.\n$$\n- z\n$$`,
      `Before [Notes](./notes "${together}").`,
      `Before <a href="./raw" title="${first}\n\n${second}">Raw notes</a>.`,
    ].join("\n\n"), { forceFullFailure }).html;
    assert.deepEqual([...root.querySelectorAll(".katex-display .katex-html")].map(node => node.textContent), ["−z"]);
    const code = [...root.querySelectorAll("p > code")];
    assert.deepEqual(code.map(node => node.textContent), [together, first, second].map(text => text.replaceAll("\n", " ")));
    assert.equal(code[1].parentElement, code[2].parentElement);
    assert.match(code[1].parentElement.textContent, /Continued prose\.$/);
    assert.deepEqual([...root.querySelectorAll("a")].map(link => [link.getAttribute("href"), link.title]),
      [["./notes", together], ["./raw", first + "\n\n" + second]]);
  });

  test(`quoted reference definitions leave no empty list rows in ${mode}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown([
      '7. First\n8. > [go]: ./notes "Notes"\n9. Next [go].',
      '10. > > [go]: ./duplicate\n11. > Visible quote.\n12.',
    ].join("\n"), { forceFullFailure }).html;
    const items = [...root.querySelectorAll("ol > li")];
    assert.deepEqual(items.map(item => [item.textContent.trim(), item.getAttribute("value")]),
      [["First", null], ["Next go.", "9"], ["Visible quote.", "11"], ["", null]]);
    const link = items[1].querySelector("a");
    assert.equal(link?.getAttribute("href"), "./notes");
    assert.equal(link?.title, "Notes");
    assert.equal(items[2].querySelector("blockquote")?.textContent.trim(), "Visible quote.");
  });

  test(`a recovered tight-list literal keeps a non-one ordered sublist in ${mode}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    root.innerHTML = renderer.renderMarkdown(
      "- Code: `line\n  $$\n  x\n  $$\n  after`.\n  2. Nested ordered.\n  3. Next nested.\n- Sibling.",
      { forceFullFailure },
    ).html;
    assert.equal(root.querySelector("li > code")?.textContent, "line $$ x $$ after");
    assert.equal(root.querySelector(".katex-display"), null);
    const nested = root.querySelector("li > ol");
    assert.equal(nested?.start, 2);
    assert.deepEqual([...nested.children].map(li => li.textContent.trim()), ["Nested ordered.", "Next nested."]);
    assert.equal(root.querySelector(":scope > ul > li:last-child")?.textContent.trim(), "Sibling.");
  });

  test(`a split anchor ending before or after a recovered literal keeps its boundaries in ${mode}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const title = "First\n$$\n- x\n$$\nThen\n$$\n- y\n$$\nEnd";
    root.innerHTML = renderer.renderMarkdown([
      "Before <a href='./first'>anchor</a\n> then `first\n$$\n- x\n$$\nend`\n- Next",
      `Before <a href="./raw" title="${title}">Notes</a\n\n> Outside.\n$$\n- z\n$$\nAfter formula.`,
    ].join("\n\n"), { forceFullFailure }).html;
    assert.deepEqual([...root.querySelectorAll("li")].map(li => li.textContent.trim()), ["Next"]);
    assert.equal(root.querySelector("p > code")?.textContent, "first $$ - x $$ end");
    assert.deepEqual([...root.querySelectorAll("a")].map(link => [link.getAttribute("href"), link.title, link.textContent]),
      [["./first", "", "anchor"], ["./raw", title, "Notes"]]);
    assert.deepEqual([...root.querySelectorAll(".katex-display .katex-html")].map(math => math.textContent), ["−z"]);
    assert.equal(root.querySelector('a[href="./raw"]').parentElement.textContent.trim(), "Before Notes Outside.");
  });

  test(`a lone delimiter inside a closed literal keeps the following formula in ${mode}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const literal = "First\n$$\n- x\nEnd";
    const suffix = "\n$$\ny\n$$";
    for (const markup of [
      `Before \`${literal}\`.`,
      `Before [Notes](./md "${literal}").`,
      `Before <a href="./raw" title="${literal}">Notes</a>.`,
    ]) {
      root.innerHTML = renderer.renderMarkdown(markup + suffix, { forceFullFailure }).html;
      assert.deepEqual([...root.querySelectorAll(".katex-display .katex-html")].map(math => math.textContent), ["y"]);
      const inline = root.querySelector("p > code, p > a");
      assert.equal(inline?.localName === "code" ? inline.textContent : inline?.title,
        inline?.localName === "code" ? literal.replaceAll("\n", " ") : literal);
    }
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
