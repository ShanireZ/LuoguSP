import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdownLite } from "../src/features/hidden-intro/markdown-lite.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "test/fixtures/markdown-renderer/markdown-lite-baseline.json",
    ),
    "utf8",
  ),
);

function sourceFor(fixture) {
  if (!fixture.repeat) return fixture.source;
  return `${fixture.source}${fixture.repeat.value.repeat(fixture.repeat.count)}`;
}

test("MarkdownLite preserves the hidden-intro baseline and blocks active HTML", () => {
  const originalKatex = globalThis.katex;
  globalThis.katex = {
    renderToString(formula, { displayMode }) {
      return `<span class="katex" data-display="${displayMode}">${formula}</span>`;
    },
  };

  try {
    for (const fixture of fixtures.cases) {
      const html = renderMarkdownLite(sourceFor(fixture), {
        katex: globalThis.katex,
      });
      for (const expected of fixture.expectContains || [])
        assert.ok(
          html.includes(expected),
          `${fixture.id} should contain ${JSON.stringify(expected)}`,
        );
      for (const forbidden of fixture.expectNotContains || [])
        assert.equal(
          html.includes(forbidden),
          false,
          `${fixture.id} should not contain ${JSON.stringify(forbidden)}`,
        );
      if (fixture.minimumHtmlLength)
        assert.ok(
          html.length >= fixture.minimumHtmlLength,
          `${fixture.id} should not truncate long input`,
        );
    }
  } finally {
    if (originalKatex === undefined) delete globalThis.katex;
    else globalThis.katex = originalKatex;
  }
});
