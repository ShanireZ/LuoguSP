import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  createRendererClient,
} from "../src/features/hidden-intro/renderer-client.js";

test("renderer client applies the versioned renderer result and reports lite mode", async () => {
  const dom = new JSDOM("<!doctype html><body><div id=root></div></body>");
  let highlights = 0;
  const client = createRendererClient({
    loader: {
      load: async () => ({
        origin: "https://fallback.example",
        module: {
          renderMarkdown: () => ({
            html: "<p>safe</p>",
            mode: "lite",
            warnings: ["full-render-failed"],
          }),
          enhanceCodeBlocks: () => {
            highlights++;
          },
        },
      }),
      getState: () => ({ status: "loaded" }),
    },
  });
  const root = dom.window.document.querySelector("#root");

  const result = await client.renderInto(root, "source");

  assert.equal(root.innerHTML, "<p>safe</p>");
  assert.deepEqual(result, {
    mode: "lite",
    warnings: ["full-render-failed"],
    origin: "https://fallback.example",
  });
  assert.equal(highlights, 1);
});

test("renderer client forwards deterministic QA render options", async () => {
  const dom = new JSDOM("<!doctype html><body><div id=root></div></body>");
  let receivedOptions;
  const client = createRendererClient({
    renderOptions: Object.freeze({ forceFullFailure: true }),
    loader: {
      load: async () => ({
        origin: "https://primary.example",
        module: {
          renderMarkdown(source, options) {
            receivedOptions = options;
            return {
              html: `<p>${source}</p>`,
              mode: "lite",
              warnings: ["full-render-failed"],
            };
          },
          enhanceCodeBlocks: () => {},
        },
      }),
      getState: () => ({ status: "loaded" }),
    },
  });

  await client.renderInto(
    dom.window.document.querySelector("#root"),
    "source",
  );

  assert.deepEqual(receivedOptions, { forceFullFailure: true });
});

test("renderer client does not mutate the target after cancellation", async () => {
  const dom = new JSDOM("<!doctype html><body><div id=root>original</div></body>");
  const controller = new AbortController();
  let resolveLoad;
  const client = createRendererClient({
    loader: {
      load: () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      getState: () => ({ status: "loading" }),
    },
  });
  const root = dom.window.document.querySelector("#root");
  const rendering = client.renderInto(root, "source", {
    signal: controller.signal,
  });
  controller.abort();
  resolveLoad({
    origin: "https://primary.example",
    module: {
      renderMarkdown: () => ({
        html: "<p>late</p>",
        mode: "full",
        warnings: [],
      }),
      enhanceCodeBlocks: () => {},
    },
  });

  await assert.rejects(() => rendering, { kind: "cancelled" });
  assert.equal(root.textContent, "original");
});
