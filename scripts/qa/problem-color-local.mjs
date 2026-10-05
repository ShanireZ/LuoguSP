// Worktree-only browser fixture. Does not modify the immutable CDN release or QA stamp.
import { createServer } from "node:http";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { ESBUILD_BASELINE_TARGETS } from "../../baseline-targets.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { outputFiles } = await build({
  absWorkingDir: root,
  entryPoints: ["scripts/qa/problem-color-scenarios.js"],
  bundle: true, write: false, format: "iife", platform: "browser",
  target: ESBUILD_BASELINE_TARGETS,
});
const early = await build({
  absWorkingDir: root, entryPoints: ["scripts/qa/problem-color-early.js"],
  bundle: true, write: false, format: "iife", platform: "browser",
  target: ESBUILD_BASELINE_TARGETS,
});
const html = `<!doctype html><html><head><meta charset="utf-8"><title>LuoguSP difficulty browser check</title>
<style>body{font:16px system-ui;margin:32px;color:#333}li{margin:8px}#stage{padding:24px;border:1px solid #ddd}.row{display:flex;gap:24px;margin:12px}.pid{color:#404040}a{color:#3498db}pre{white-space:pre-wrap}</style>
<script id="lentille-context" type="application/json">{"data":{"problem":{"pid":"P1001","difficulty":1}}}</script></head>
<body><h1>LuoguSP 难度着色：工作树浏览器检查</h1><p>本地夹具使用现场核对的洛谷 DOM 与数据结构；不是线上发布验证。</p>
<ol id="results"></ol><main id="stage"><a href="/problem/P1001">P1001</a></main><pre id="failure"></pre><script src="/scenario.js"></script></body></html>`;
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/early.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    return res.end(early.outputFiles[0].text);
  }
  if (url.pathname === "/scenario.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    return res.end(outputFiles[0].text);
  }
  if (req.headers["x-lentille-request"] === "content-only") {
    const pid = url.pathname.startsWith("/training/") ? "B2002" : "P1002";
    const difficulty = url.searchParams.get("page") === "3" ? 4 : 2;
    const problem = { pid, difficulty };
    const data = url.pathname.startsWith("/training/") ? { training: { problems: [problem] } } :
      url.pathname.includes("/practice") ? { submitted: [problem], passed: [{ pid: "P9998", difficulty: 8 }] } :
      { problems: { result: [problem] } };
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data }));
  }
  if (url.searchParams.has("_contentOnly")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ currentData: { problem: { difficulty: 3 } } }));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(url.searchParams.has("early") ? html
    .replace('<script id="lentille-context"', '<script src="/early.js"></script><script id="lentille-context"')
    .replace('<script src="/scenario.js"></script>', `<script>queueMicrotask(() => {
      document.body.dataset.beforeReady = document.readyState;
      document.body.dataset.beforeColor = document.querySelector('#stage b')?.style.color || '';
    });</script>`) : html);
});
server.listen(0, "127.0.0.1", () => {
  console.log(`Open http://127.0.0.1:${server.address().port}/problem/P1001`);
  console.log(`Early boot: http://127.0.0.1:${server.address().port}/problem/P1001?early=1`);
});
