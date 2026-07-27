import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarkdownRenderer } from "../scripts/renderer/build-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("markdown renderer bundle is self-contained and reproducible", async () => {
  const first = await buildMarkdownRenderer({ root });
  const second = await buildMarkdownRenderer({ root });
  const source = first.toString("utf8");

  assert.equal(first.equals(second), true);
  assert.ok(first.length > 100000);
  assert.match(source, /apiVersion/);
  assert.match(source, /renderMarkdown/);
  for (const globalName of [
    "window.marked",
    "window.DOMPurify",
    "window.katex",
    "window.hljs",
  ])
    assert.equal(source.includes(globalName), false, globalName);
});
