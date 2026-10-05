import { createProblemColorFeature } from "../../src/features/problem-color/feature.js";
import { createPageLifecycle } from "../../src/core/page-lifecycle.js";
import { createBrowserRouteAdapter } from "../../src/core/browser-route-adapter.js";

const stage = document.getElementById("stage");
const results = document.getElementById("results");
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const report = (message) => {
  const li = document.createElement("li"); li.textContent = `通过：${message}`; results.append(li);
};
const rawFetch = window.fetch;
const queries = [];
window.fetch = (...args) => {
  queries.push({ url: String(args[0]), at: performance.now() });
  return rawFetch(...args);
};
const feature = createProblemColorFeature({ storage: { get: () => true } });
const lifecycle = createPageLifecycle({
  logError: (scope, error) => { throw new Error(`${scope}: ${error.message}`, { cause: error }); },
  routeAdapter: createBrowserRouteAdapter({ history, eventTarget: window,
    token: () => location.pathname + location.search }),
  documentAdapter: {
    schedule: (run) => { const id = requestAnimationFrame(run); return () => cancelAnimationFrame(id); },
    whenReady: (run) => run(),
  },
});
lifecycle.register(feature);

// Match the verified Luogu list DOM, including the separate pid and title link.
const row = (pid) => `<div class="row"><div class="pid" title="${pid}">${pid}</div><div class="title"><a href="/problem/${pid}">题目标题</a></div></div>`;
const color = () => stage.querySelector(".pid")?.style.color;
const nativeNavigate = (url, render) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url);
  xhr.setRequestHeader("x-lentille-request", "content-only");
  xhr.onloadend = () => {
    try {
      const data = JSON.parse(xhr.responseText).data;
      history.pushState({}, "", url);
      render(data);
      resolve();
    } catch (error) { reject(error); }
  };
  xhr.onerror = reject;
  xhr.send();
});

async function run() {
  lifecycle.start();
  check(stage.querySelector("b")?.style.color === "rgb(254, 76, 97)", "detail not colored synchronously");
  check(queries.length === 0, "detail queried despite native data");
  report("题目详情首屏同步着色，零额外查询");

  await nativeNavigate("/training/100", (data) => { stage.innerHTML = row(data.training.problems[0].pid); });
  await frame();
  check(color() === "rgb(243, 156, 17)", "training missing color on first frame");
  check(queries.length === 0, "training queried despite native data");
  report("站内跳转至题单，第一帧题号已有颜色");

  await nativeNavigate("/problem/list?page=2", (data) => {
    const pid = data.problems.result[0].pid;
    const node = stage.querySelector(".pid");
    node.title = pid; node.textContent = pid;
    stage.querySelector("a").href = `/problem/${pid}`;
  });
  await frame();
  check(color() === "rgb(243, 156, 17)", "reused pagination row missing color");
  const sameNode = stage.querySelector(".pid");
  await nativeNavigate("/problem/list?page=3", () => {});
  await frame();
  check(stage.querySelector(".pid") === sameNode && color() === "rgb(82, 196, 26)", "same pid difficulty not refreshed");
  check(queries.length === 0, "pagination caused fallback requests");
  report("翻页复用题号、同题难度变更，第一帧更新且零额外查询");

  await nativeNavigate("/user/1/practice", (data) => {
    stage.innerHTML = `<div class="l-card"><h3>尝试过的题目</h3><a href="/problem/${data.submitted[0].pid}">${data.submitted[0].pid}</a></div>` +
      '<div class="l-card"><h3>已通过的题目</h3><a href="/problem/P9998">P9998</a></div>';
  });
  await frame();
  check(stage.querySelector(".l-card a b")?.style.color === "rgb(243, 156, 17)", "attempted problem not colored");
  check(!stage.querySelectorAll(".l-card a")[1].dataset.luoguspPid, "passed problem colored");
  report("练习页只处理尝试过的题目");

  history.pushState({}, "", "/record/list");
  stage.innerHTML = '<a href="/problem/P9997"><span class="pid" style="color:rgb(19,194,194)">P9997</span></a>';
  await frame(); await pause(320);
  check(!stage.querySelector("a").dataset.luoguspPid && queries.length === 0, "record list recolored or fetched");
  report("评测记录保留原生颜色，零查询");

  history.pushState({}, "", "/");
  stage.innerHTML = '<a href="/problem/P9999">P9999</a>';
  await frame();
  const mountedAt = performance.now();
  await pause(260);
  check(queries.length === 0, "fallback began before 300ms");
  await pause(120);
  check(queries.length === 1 && queries[0].at - mountedAt >= 290, "fallback timing/count incorrect");
  check(stage.querySelector("b")?.style.color === "rgb(255, 193, 22)", "fallback color missing");
  stage.insertAdjacentHTML("beforeend", '<a href="/problem/P9999">P9999</a>');
  await frame();
  check(stage.querySelectorAll("b").length === 2 && queries.length === 1, "cache not reused");
  report(`缺失数据约 ${Math.round(queries[0].at - mountedAt)}ms 后查询；同题新链接复用缓存`);

  document.body.dataset.result = "passed";
}
run().catch((error) => {
  document.getElementById("failure").textContent = error.stack;
  document.body.dataset.result = "failed";
}).finally(() => { lifecycle.dispose(); window.fetch = rawFetch; });
