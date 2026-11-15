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
let onQuery;
window.fetch = (...args) => {
  queries.push({ url: String(args[0]), at: performance.now() });
  onQuery?.();
  return rawFetch(...args);
};
const feature = createProblemColorFeature({ storage: { get: () => true } });
let holdMountFrame = false;
let deferredMount;
const lifecycle = createPageLifecycle({
  logError: (scope, error) => { throw new Error(`${scope}: ${error.message}`, { cause: error }); },
  routeAdapter: createBrowserRouteAdapter({ history, eventTarget: window,
    token: () => location.pathname + location.search }),
  documentAdapter: {
    schedule: (run) => {
      if (holdMountFrame) {
        deferredMount = run;
        return () => { deferredMount = null; };
      }
      const id = requestAnimationFrame(run);
      return () => cancelAnimationFrame(id);
    },
    whenReady: (run) => run(),
  },
});
lifecycle.register(feature);

// Match the verified Luogu list DOM, including the separate pid and title link.
const row = (pid) => `<div class="row"><div class="pid" title="${pid}">${pid}</div><div class="title"><a href="/problem/${pid}">题目标题</a></div></div>`;
const color = () => stage.querySelector(".pid")?.style.color;
const coloredPid = 'a > [style*="color"]';
const nativeNavigate = (url, render, { routeFirst = false } = {}) => new Promise((resolve, reject) => {
  if (routeFirst) history.pushState({}, "", url);
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url);
  xhr.setRequestHeader("x-lentille-request", "content-only");
  xhr.onloadend = () => {
    try {
      const data = JSON.parse(xhr.responseText).data;
      if (!routeFirst) history.pushState({}, "", url);
      render(data);
      resolve();
    } catch (error) { reject(error); }
  };
  xhr.onerror = reject;
  xhr.send();
});

async function run() {
  lifecycle.start();
  const firstPid = stage.querySelector(coloredPid);
  check(firstPid?.style.color === "rgb(254, 76, 97)", "detail not colored synchronously");
  check(getComputedStyle(firstPid).fontWeight === "400", "inline problem ID gained font weight");
  check(stage.querySelectorAll(coloredPid).length === 3 &&
    stage.querySelector('[data-luogusp-pid="P1425"] span')?.style.color === "rgb(243, 156, 17)", "native recommendations not colored synchronously");
  check(queries.length === 0, "detail queried despite native data");
  report("题目详情与推荐题首屏同步着色，零额外查询");

  await nativeNavigate("/training/100", (data) => { stage.innerHTML = row(data.training.problems[0].pid); });
  await frame();
  check(color() === "rgb(243, 156, 17)", "training missing color on first frame");
  check(getComputedStyle(stage.querySelector(".pid")).fontWeight === "400", "standalone problem ID gained font weight");
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
  check(stage.querySelector(coloredPid)?.style.color === "rgb(243, 156, 17)", "attempted problem not colored");
  check(!stage.querySelectorAll(".l-card a")[1].dataset.luoguspPid, "passed problem colored");
  report("练习页只处理尝试过的题目");

  const renderRecord = (data, nativeColor = "") => {
    const { id, problem: { pid } } = data.record || data.records.result[0];
    const rowClass = data.record ? "problem-row" : "problem";
    const status = data.record ? "" : `<div><a class="status" href="/record/${id}">Accepted</a></div>`;
    stage.innerHTML = `${status}<div class="${rowClass}"><a href="/problem/${pid}"><strong style="${nativeColor}">${pid}</strong> 标题</a></div>
      <a id="unrelated" href="/problem/${pid}">${pid} 其他链接</a>`;
  };
  for (const [path, expected] of [
    ["/record/list?user=116524", "rgb(42, 150, 151)"],
    ["/record/307939068", "rgb(181, 181, 248)"],
    ["/record/list?pid=P17832", "rgb(42, 150, 151)"],
  ]) {
    await nativeNavigate(path, renderRecord);
    await frame();
    const pid = stage.querySelector("strong");
    check(getComputedStyle(pid).color === expected, `academic record color missing on ${path}`);
    check(!pid.children.length && getComputedStyle(pid).fontWeight === "700", "native PID element changed");
    check(!stage.querySelector("#unrelated").dataset.luoguspPid && queries.length === 0, "record fetched or colored other links");
  }
  const lastRecordPid = stage.querySelector("strong");
  stage.querySelector("a.status").href = "/record/307939069";
  await frame();
  check(getComputedStyle(lastRecordPid).color === "rgb(167, 89, 242)", "reused row kept another record's color");
  lastRecordPid.style.color = "var(--lfe-color--purple-3)";
  await frame();
  check(!lastRecordPid.parentElement.dataset.luoguspPid && lastRecordPid.style.color === "var(--lfe-color--purple-3)", "native toggle lost color");
  await nativeNavigate("/record/list?pid=P17832&normal=1", (data) => renderRecord(data, "color:var(--lfe-color--cyan-3)"));
  await frame();
  const normalPid = stage.querySelector("strong");
  normalPid.style.removeProperty("color");
  await frame(); await pause(320);
  check(!normalPid.style.color && !normalPid.parentElement.dataset.luoguspPid && queries.length === 0, "normal mode native hide overridden");
  report("学术模式的三类评测记录使用原生数据与主题色，普通模式保留原生难度开关");

  // Reproduce a native response and DOM update while the next mount frame is
  // pending, as when the user switches tabs during a route transition.
  holdMountFrame = true;
  await nativeNavigate("/record/list?pid=P17832&background=1", renderRecord, { routeFirst: true });
  await frame();
  const backgroundPid = stage.querySelector("strong");
  check(getComputedStyle(backgroundPid).color === "rgb(42, 150, 151)", "record response missed while mount frame was pending");
  backgroundPid.style.removeProperty("color");
  document.dispatchEvent(new Event("visibilitychange"));
  check(getComputedStyle(backgroundPid).color === "rgb(42, 150, 151)", "tab activation did not refresh record colors");
  await nativeNavigate("/problem/list?page=4", (data) => { stage.innerHTML = row(data.problems.result[0].pid); }, { routeFirst: true });
  await frame();
  check(color() === "rgb(243, 156, 17)" && queries.length === 0, "problem list response missed while mount frame was pending");
  holdMountFrame = false;
  deferredMount?.();
  report("切页期间继续接收原生数据，回到标签页时重新检查题号");

  const mountedAt = performance.now();
  history.pushState({}, "", "/");
  stage.innerHTML = `<a id="native" href="/problem/P9996"><span class="lcolor--pink-3">P9996</span> 标题</a>
    <a id="uncolored" href="/problem/P9999"><span class="pid" style="font-weight: 550">P9999</span> 标题</a>`;
  await frame();
  await pause(260);
  check(queries.length === 0, "fallback began before 300ms");
  await pause(120);
  check(queries.length === 1 && queries[0].at - mountedAt >= 290, "fallback timing/count incorrect");
  const homePid = stage.querySelector("#uncolored .pid");
  check(homePid.style.color === "rgb(255, 193, 22)", "academic mode fallback color missing");
  check(getComputedStyle(homePid).fontWeight === "550", "home problem ID changed font weight");
  const native = stage.querySelector("#native");
  check(!native.dataset.luoguspPid && getComputedStyle(native.firstElementChild).color === "rgb(223, 65, 96)", "native class-based color overwritten");
  stage.insertAdjacentHTML("beforeend", '<a href="/problem/P9999">P9999</a>');
  await frame();
  check(stage.querySelectorAll("[data-luogusp-pid]").length === 2 && queries.length === 1, "cache not reused");
  report(`学术模式约 ${Math.round(queries[0].at - mountedAt)}ms 后查询；首页补色保留字重，原生颜色不重复处理`);

  homePid.style.color = "rgb(19, 194, 194)";
  await frame();
  check(homePid.style.color === "rgb(19, 194, 194)" && !homePid.closest("a").dataset.luoguspPid, "late native color overwritten");
  homePid.style.removeProperty("color");
  await frame();
  check(homePid.style.color === "rgb(255, 193, 22)" && queries.length === 1, "missing native color not filled from cache");
  history.pushState({}, "", "/record/303491732");
  await frame(); await frame();
  check(!stage.querySelector("[data-luogusp-pid]") && !homePid.style.color, "previous route's color survived on record details");
  report("动态原生颜色接管同一题号，切到记录详情清除 LuoguSP 颜色");

  const started = new Promise((resolve) => { onQuery = resolve; });
  history.pushState({}, "", "/?leave=1");
  stage.innerHTML = ["P9811", "P9812", "P9813"].map((pid) => `<a href="/problem/${pid}">${pid}</a>`).join(" ");
  await started;
  onQuery = null;
  history.pushState({}, "", "/record/303491732");
  stage.replaceChildren();
  await pause(650);
  check(queries.length === 2 && queries[1].url.includes("P9811"), "queued queries escaped after leaving the route");
  report("切离页面后，尚未送出的查询被取消");

  document.body.dataset.result = "passed";
}
run().catch((error) => {
  document.getElementById("failure").textContent = error.stack;
  document.body.dataset.result = "failed";
}).finally(() => { lifecycle.dispose(); window.fetch = rawFetch; });
