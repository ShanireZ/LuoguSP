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
<style>body{font:16px system-ui;margin:32px;color:#333}li{margin:8px}#stage{padding:24px;border:1px solid #ddd}.row{display:flex;gap:24px;margin:12px}.pid{color:#404040}a{color:#3498db}.lcolor--pink-3{color:#df4160}pre{white-space:pre-wrap}</style>
<style>:root{--lfe-color--cyan-3:rgb(42, 150, 151);--lfe-color--purple-3:rgb(167, 89, 242);--lfe-color--lapis-4:rgb(181, 181, 248)}</style>
<script id="lentille-context" type="application/json">{"data":{"problem":{"pid":"P1001","difficulty":1},"recommendations":[{"pid":"P1421","difficulty":1},{"pid":"P1425","difficulty":2}]}}</script></head>
<body><h1>LuoguSP 难度着色：工作树浏览器检查</h1><p>本地夹具使用现场核对的洛谷 DOM 与数据结构；不是线上发布验证。</p>
<ol id="results"></ol><main id="stage"><a href="/problem/P1001">P1001</a><a href="/problem/P1421">P1421</a><a href="/problem/P1425">P1425</a></main><pre id="failure"></pre><script src="/scenario.js"></script></body></html>`;
export const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/early.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    return res.end(early.outputFiles[0].text);
  }
  if (url.pathname === "/scenario.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    return res.end(outputFiles[0].text);
  }
  if (url.searchParams.has("_contentOnly")) {
    if (req.headers["x-lentille-request"] !== "content-only") {
      res.writeHead(400);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      user: { learningMode: 1 },
      data: { problem: { pid: url.pathname.split("/").pop(), difficulty: 3 } },
    }));
  }
  if (req.headers["x-lentille-request"] === "content-only") {
    if (url.pathname.startsWith("/record/")) {
      const isList = url.pathname === "/record/list";
      const pid = url.searchParams.get("pid") || "P9997";
      const problem = { pid, difficulty: isList ? 5 : 8 };
      const record = { id: 307939068, problem };
      const data = isList ? { records: { result: [
        record, { id: 307939069, problem: { pid, difficulty: 7 } },
      ] } } : { record };
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        template: isList ? "record.list" : "record.show",
        user: { learnMode: !url.searchParams.has("normal") },
        data,
      }));
    }
    const pid = url.pathname.startsWith("/training/") ? "B2002" : "P1002";
    const difficulty = url.searchParams.get("page") === "3" ? 4 : 2;
    const problem = { pid, difficulty };
    const data = url.pathname.startsWith("/training/") ? { training: { problems: [problem] } } :
      url.pathname.includes("/practice") ? { submitted: [problem], passed: [{ pid: "P9998", difficulty: 8 }] } :
      { problems: { result: [problem] } };
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data }));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(url.searchParams.has("early") ? html
    .replace('<script id="lentille-context"', '<script src="/early.js"></script><script id="lentille-context"')
    .replace('<script src="/scenario.js"></script>', `<script>queueMicrotask(() => {
      document.body.dataset.beforeReady = document.readyState;
      document.body.dataset.beforeColor = document.querySelector('#stage a > [style*="color"]')?.style.color || '';
    });</script>`) : html);
});
server.listen(0, "127.0.0.1", () => {
  console.log(`Open http://127.0.0.1:${server.address().port}/problem/P1001`);
  console.log(`Early boot: http://127.0.0.1:${server.address().port}/problem/P1001?early=1`);
});
