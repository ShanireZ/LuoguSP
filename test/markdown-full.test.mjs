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

for (const [context, wrap] of [
  ["a div", (anchor) => `<div>\n${anchor}\n</div>`],
  ["a standalone anchor", (anchor) => anchor],
]) {
  test(`Full closes a split raw HTML image anchor in ${context}`, (t) => {
    const { dom, renderer } = createRenderer();
    t.after(() => dom.window.close());
    const root = dom.window.document.createElement("div");
    const result = renderer.renderMarkdown([
      wrap('<a href="./gallery" title="Gallery </a >">\n' +
        '<img src="./cover.png" alt="Map </a >" title="Cover </a >"></a\n\n>'),
      "Expected separate paragraph.",
      'Example: `</a >`. [Link](./text "Literal </a >")',
      "~~~html\n</a\n\n>\n~~~",
    ].join("\n\n"));
    assert.equal(result.mode, "full");
    root.innerHTML = result.html;
    assert.deepEqual([...root.querySelectorAll("a[href]")].map((link) =>
      [link.textContent.trim(), link.getAttribute("href"), link.title]), [
      ["Map </a >", "./gallery", "Gallery </a >"],
      ["打开图片：Map </a >", "https://www.luogu.com.cn/cover.png", "Cover </a >"],
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
