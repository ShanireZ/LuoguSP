import { runLuoguSP } from "../../src/bootstrap/run-app.js";

const queries = [];
const rawFetch = window.fetch;
window.fetch = (...args) => { queries.push(String(args[0])); return rawFetch(...args); };
runLuoguSP({ release() {} }, {
  storageAdapter: {
    has: () => true,
    get: (key) => key === "LuoguSP.addProblemsColor",
    set() {},
  },
});
const earlyOpen = XMLHttpRequest.prototype.open;
document.addEventListener("DOMContentLoaded", () => {
  const results = document.getElementById("results");
  const checks = [
    [document.body.dataset.beforeReady === "loading", "检查点确实早于 DOMContentLoaded"],
    [document.body.dataset.beforeColor === "rgb(254, 76, 97)", "解析器刚创建题号时已着色"],
    [earlyOpen === XMLHttpRequest.prototype.open, "完整应用接管同一实例，没有重复挂载"],
    [queries.length === 0, "首屏没有额外查询"],
  ];
  for (const [ok, label] of checks) {
    const li = document.createElement("li");
    li.textContent = `${ok ? "通过" : "失败"}：${label}`;
    results.append(li);
  }
  document.body.dataset.result = checks.every(([ok]) => ok) ? "passed" : "failed";
}, { once: true });
