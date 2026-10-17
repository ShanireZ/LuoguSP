import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { IDE_BATCH_LABEL, createBatchButtonHint } from "./batch-hint.js";
import {
  diffLineNumbers,
  idePane,
  normalizeIdeOut,
} from "./result-view.js";
import { createIdeBatchRunner } from "./runner.js";
import { IDE_BATCH_STYLE } from "./style.js";

export function createIdeBatchFeature({
  storage,
  idePreparationAdapter,
}) {
  const SELECTORS = {
    ideToolbar: ".ide-toolbar",
    ideToolbarText: ".title .text",
    ideToolbarActions: ".actions",
    ideRunResult: ".run-result",
    ideTextarea: "textarea.ide-textarea",
    ideSampleBlock: ".io-sample-block",
    cmContent: ".cm-content",
    lentilleContext: "script#lentille-context",
  };
  const injectStyle = () => {
    if (document.getElementById("luogusp-ide-style")) return;
    const style = document.createElement("style");
    style.id = "luogusp-ide-style";
    style.textContent = IDE_BATCH_STYLE;
    (document.head || document.documentElement).appendChild(style);
  };

  // ============================================================
  // IDE 模式一鍵測試所有範例
  // 洛谷新版題目頁（columba）IDE 模式（#ide）下，逐組驅動題面範例的原生「執行」，
  // 結果從輸出面板 DOM 捕獲（結果經頁面常駐 WS 推送，網路層拿不到——勿改走攔截）。
  // 錨點與配色均來自 2026-07 洛谷 columba IDE 的真實頁面觀測。
  // ============================================================
  function ideToolbarByTitle(title) {
    for (const tb of document.querySelectorAll(SELECTORS.ideToolbar)) {
      const t = tb.querySelector(SELECTORS.ideToolbarText);
      if (t && t.textContent.trim() === title) return tb;
    }
    return null;
  }

  const IDE_VIEW = {
    activeTab: "custom", // custom=原生輸入輸出 / samples=範例面板
    tabBar: null,
    panel: null,
    ioLayout: null, // 原生 輸入|輸出 水平分欄（tab 切換時顯隱）
    rowsEl: null,
    summaryEl: null,
    stopBtn: null,
  };

  function ideModeActive() {
    return (
      location.hash === "#ide" && !!document.querySelector(SELECTORS.ideToolbar)
    );
  }

  function lentilleProblem() {
    try {
      const el = document.querySelector(SELECTORS.lentilleContext);
      if (!el) return null;
      const json = JSON.parse(el.textContent);
      return (json && json.data && json.data.problem) || null;
    } catch (e) {
      return null;
    }
  }
  function currentPid() {
    const m = location.pathname.match(/^\/problem\/([A-Za-z0-9_]+)/);
    return m ? m[1] : "";
  }
  async function getIdeSamples(signal) {
    const pid = currentPid();
    if (!pid) return null;
    const p = lentilleProblem();
    if (p && p.pid === pid && Array.isArray(p.samples)) return p.samples;
    // SPA 換題後 lentille-context 滯留舊題（真機實測）→ 新版內容介面備援。
    // 注意：舊 `?_contentOnly=1` 在 columba 頁面已死（回傳整頁 HTML），
    // 正確姿勢是帶 x-lentille-request 頭（真機實測 2026-07-22）。
    try {
      const res = await fetch(`/problem/${pid}`, {
        headers: { "x-lentille-request": "content-only" },
        signal,
      });
      const json = await res.json();
      const prob = json && json.data && json.data.problem;
      if (prob && Array.isArray(prob.samples)) return prob.samples;
    } catch (e) {
      if (!signal || !signal.aborted)
        console.error("LuoguSP ide samples:", e);
    }
    return null;
  }
  function sampleRunButtons() {
    // 「輸入 #N」「輸出 #N」各一塊都帶「執行」；只取輸入塊的，按 DOM 序=範例序
    const btns = [];
    for (const block of document.querySelectorAll(SELECTORS.ideSampleBlock)) {
      if (!/^(输入|Input)/i.test((block.textContent || "").trim())) continue;
      const run = [...block.querySelectorAll("a, button")].find(
        (b) => (b.textContent || "").trim() === "运行",
      );
      if (run) btns.push(run);
    }
    return btns;
  }
  function readIdeCode() {
    const content = document.querySelector(SELECTORS.cmContent);
    if (!content) return "";
    // 洛谷建置把 CM6 的 cmView 命名為 cmTile；拿不到就退化為可見文字（空程式碼檢測夠用）
    const view = content.cmTile && content.cmTile.view;
    if (view && view.state && view.state.doc) return view.state.doc.toString();
    return content.textContent || "";
  }

  let ideSubmitWaiter = null;
  let ideSubmitPatchDispose = null;
  function cancelIdeSubmitWaiter(runId) {
    if (!ideSubmitWaiter) return;
    if (runId != null && ideSubmitWaiter.runId !== runId) return;
    const waiter = ideSubmitWaiter;
    ideSubmitWaiter = null;
    waiter.resolve(null);
  }
  function installIdeSubmitObserver() {
    if (ideSubmitPatchDispose) return ideSubmitPatchDispose;
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    const submitRequests = new WeakMap();
    let active = true;
    const open = function (method, url) {
      if (active)
        submitRequests.set(
          this,
          typeof url === "string" && url.indexOf("/api/ide_submit") !== -1,
        );
      return rawOpen.apply(this, arguments);
    };
    const send = function () {
      if (active && submitRequests.get(this))
        this.addEventListener("loadend", () => {
          if (ideSubmitWaiter) {
            const w = ideSubmitWaiter;
            ideSubmitWaiter = null;
            w.resolve(this.status);
          }
        });
      return rawSend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open = open;
    XMLHttpRequest.prototype.send = send;
    const dispose = () => {
      active = false;
      cancelIdeSubmitWaiter();
      if (XMLHttpRequest.prototype.open === open)
        XMLHttpRequest.prototype.open = rawOpen;
      if (XMLHttpRequest.prototype.send === send)
        XMLHttpRequest.prototype.send = rawSend;
      if (ideSubmitPatchDispose === dispose) ideSubmitPatchDispose = null;
    };
    ideSubmitPatchDispose = dispose;
    return dispose;
  }
  function waitIdeSubmit(ms, runId) {
    cancelIdeSubmitWaiter();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (ideSubmitWaiter && ideSubmitWaiter.resolve === fn)
          ideSubmitWaiter = null;
        resolve(null);
      }, ms);
      const fn = (status) => {
        clearTimeout(timer);
        resolve(status);
      };
      ideSubmitWaiter = { runId, resolve: fn };
    });
  }
  function outputParts() {
    const tb = ideToolbarByTitle("输出");
    if (!tb) return null;
    const actions = tb.querySelector(SELECTORS.ideToolbarActions);
    const spans = actions ? [...actions.querySelectorAll("span")] : [];
    return {
      pill: spans.find((s) => !s.classList.contains("run-result")) || null,
      rr: actions ? actions.querySelector(SELECTORS.ideRunResult) : null,
      textarea: tb.parentElement
        ? tb.parentElement.querySelector(SELECTORS.ideTextarea)
        : null,
    };
  }
  // 完成錨點：膠囊 存在→消失→重現（實測清空 300~560ms、結果 1~3.5s）
  // 注意：此處不看 stopReq——設計口徑是「當前組跑完即停」，停止只在組間生效
  async function waitIdePill(
    present,
    timeoutMs,
    isCurrent = () => true,
    wait,
  ) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (!isCurrent()) return null;
      const parts = outputParts();
      if (!parts) return null; // IDE 已卸載
      if (!!parts.pill === present) return parts.pill || true;
      if (!(await wait(150))) return null;
    }
    return null;
  }

  async function runOneSample(runBtn, runId, drive, isCurrent, wait) {
    const before = outputParts();
    if (!before) return { verdict: "UKE", note: "IDE 面板不存在" };
    const hadPill = !!before.pill;
    let submitP = waitIdeSubmit(10000, runId);
    drive(() => runBtn.click());
    let status = await submitP;
    if (status === 429) {
      if (!(await wait(3000))) return { verdict: "UKE", note: "页面已切换" };
      if (!isCurrent()) return { verdict: "UKE", note: "页面已切换" };
      submitP = waitIdeSubmit(10000, runId);
      drive(() => runBtn.click());
      status = await submitP;
    }
    if (status == null || status < 200 || status >= 300)
      return {
        verdict: "UKE",
        note: status == null ? "未观测到提交请求" : `提交失败 HTTP ${status}`,
      };
    if (
      hadPill &&
      (await waitIdePill(false, 5000, isCurrent, wait)) === null
    )
      return { verdict: "UKE", note: "旧结果未清空，疑似运行未开始" };
    const pill = await waitIdePill(true, 30000, isCurrent, wait);
    if (!pill || pill === true)
      return { verdict: "UKE", note: "30s 未返回结果" };
    const parts = outputParts();
    return {
      verdict: (pill.textContent || "").trim() || "UKE",
      pillStyle: pill.getAttribute("style") || "",
      detail: parts.rr ? parts.rr.textContent.trim() : "",
      output: parts.textarea ? parts.textarea.value : "",
    };
  }

  // 提示狀態機搬到了 batch-hint.js（那邊記著它為什麼必須恢復成固定文案）。
  const ideHint = createBatchButtonHint({
    findButton: () => document.querySelector(".luogusp-ide-batch-btn"),
  });
  const ideBatchHint = (msg, running = false) => ideHint.show(msg, running);

  // 判定口徑同洛谷：CRLF 歸一、去行尾空格、去末尾空行。僅用於 diff 繪製與交叉檢核，
  // 最終判定以原生膠囊為準（AC/WA 由洛谷前端本機比較）。
  function applyIdeResult(i, r, sample) {
    const p = ideRowParts(i);
    if (!p) return;
    p.pill.textContent = r.verdict;
    p.pill.setAttribute(
      "style",
      r.pillStyle || "background-color:#3d3d3d;border-color:#333;color:#fff;",
    );
    p.detail.innerHTML = "";
    p.detail.classList.remove("luogusp-ide-log");
    if (r.verdict === "CE") {
      // CE：不顯示三欄，直接展示從輸出框捕獲的編譯紀錄
      p.meta.textContent = "";
      p.detail.classList.add("luogusp-ide-log");
      p.detail.appendChild(
        idePane(
          "编译信息",
          String(r.output || "").split("\n"),
          null,
          "（无编译输出）",
        ),
      );
      return;
    }
    p.meta.textContent = r.detail || "";
    if (r.note) {
      const note = document.createElement("p");
      note.className = "luogusp-ide-note";
      note.textContent = r.note;
      p.detail.appendChild(note);
      if (r.output == null) {
        p.detail.classList.add("luogusp-ide-log"); // UKE 無產物，只留說明
        return;
      }
    }
    if (r.verdict === "RE" && r.detail) {
      const note = document.createElement("p");
      note.className = "luogusp-ide-note";
      note.textContent = r.detail; // RE 原因位於原生 run-result
      p.detail.appendChild(note);
      p.meta.textContent = "";
    }
    const expLines = normalizeIdeOut(sample[1]).split("\n");
    const actLines = normalizeIdeOut(r.output).split("\n");
    const bad =
      r.verdict === "AC" ? new Set() : diffLineNumbers(expLines, actLines);
    p.detail.append(
      idePane("输入", normalizeIdeOut(sample[0]).split("\n"), null, "（空）"),
      idePane("期望输出", expLines, bad, "（空）"),
      idePane(
        "实际输出",
        actLines,
        bad,
        r.verdict === "AC" ? "（空）" : "（未产生输出）",
      ),
    );
  }

  function finishIdeSummary(results) {
    if (!IDE_VIEW.summaryEl || !results) return;
    const rs = results;
    const counts = {};
    let ac = 0,
      tested = 0;
    rs.forEach((r) => {
      if (!r) return;
      tested++;
      if (r.verdict === "AC") ac++;
      else counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    });
    let text = `${ac}/${rs.length} 通过`;
    for (const k in counts) text += ` · ${counts[k]} ${k}`;
    if (tested < rs.length) {
      text += " · 已停止";
      rs.forEach((r, i) => {
        if (r) return;
        const p = ideRowParts(i);
        if (p) p.pill.textContent = "未测";
      });
    }
    IDE_VIEW.summaryEl.textContent = text;
    const firstBad = rs.findIndex((r) => r && r.verdict !== "AC");
    if (firstBad !== -1) expandIdeRow(firstBad);
    else if (IDE_VIEW.rowsEl)
      IDE_VIEW.rowsEl
        .querySelectorAll(".luogusp-ide-row.open")
        .forEach((r) => r.classList.remove("open"));
  }

  function showIdeStale() {
    if (IDE_VIEW.summaryEl && document.contains(IDE_VIEW.summaryEl))
      IDE_VIEW.summaryEl.textContent += " · 结果可能已过期，建议重新测试";
  }
  function hookIdeStaleAndGuard(controls) {
    // 程式碼變更 → 過期標註（CM6 是 contenteditable，input/keydown 均會冒泡）
    const stale = (e) => {
      if (e.target && e.target.closest && e.target.closest(SELECTORS.cmContent))
        controls.markStale();
    };
    document.addEventListener("input", stale, true);
    document.addEventListener("keydown", stale, true);
    // 批測中攔掉使用者手點原生 執行/自測（處理程序化點擊帶 driving 標記放行）
    const guard = (e) => {
      if (!controls.isRunning() || controls.isDriving()) return;
      const t =
        e.target &&
        e.target.closest &&
        e.target.closest(
          `${SELECTORS.ideSampleBlock} a, ${SELECTORS.ideToolbar} a.run`,
        );
      if (t) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => {
      document.removeEventListener("input", stale, true);
      document.removeEventListener("keydown", stale, true);
      document.removeEventListener("click", guard, true);
    };
  }

  // 克隆原生控件時，範本身上的浮泡/讀屏名字會一起被抄走 —— 換了文字也換不掉它。
  // 側欄「外掛設定」就是這麼把「文章廣場」的浮泡帶出來的（2026-08-20 owner 報的）。
  // ★ 這裡是同形防禦：IDE 頁要登入，我沒法量「自測」按鈕到底帶不帶 title，
  //   所以按最壞情況剝淨；真站上若本來就沒有，這兩行等於空轉。data-v-* 是作用域 CSS，絕不能碰。
  function dropInheritedNames(el) {
    for (const node of [el, ...el.querySelectorAll("*")])
      for (const name of ["title", "aria-label", "aria-labelledby"])
        node.removeAttribute(name);
  }

  function mountIdeButton(controls) {
    const tb = ideToolbarByTitle("代码");
    if (!tb) return;
    const actions = tb.querySelector(SELECTORS.ideToolbarActions);
    if (!actions || actions.querySelector(".luogusp-ide-batch-btn")) return;
    const selfTest = [...actions.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "自测",
    );
    if (!selfTest) return;
    // 克隆原生「自測」按鈕繼承洛谷樣式（含 data-v 作用域），只換文字
    const btn = selfTest.cloneNode(true);
    btn.textContent = IDE_BATCH_LABEL;
    dropInheritedNames(btn);
    btn.classList.add("luogusp-ide-batch-btn");
    btn.disabled = false;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      controls.start();
    });
    actions.insertBefore(btn, selfTest);
  }

  function mountIdeTabs(controls) {
    if (IDE_VIEW.tabBar && document.contains(IDE_VIEW.tabBar)) return;
    const inputTb = ideToolbarByTitle("输入");
    if (!inputTb) return;
    const ioLayout = inputTb.closest(".panel-layout"); // 底部 輸入|輸出 水平分欄
    const host = ioLayout && ioLayout.parentElement;
    if (!host) return;
    host
      .querySelectorAll(".luogusp-ide-tabbar, .luogusp-ide-panel")
      .forEach((e) => e.remove());
    const tabBar = document.createElement("div");
    tabBar.className = "luogusp-ide-tabbar";
    tabBar.innerHTML =
      '<span class="luogusp-ide-tab" data-tab="custom">自定义测试</span>' +
      '<span class="luogusp-ide-tab" data-tab="samples">样例测试</span>';
    tabBar.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) switchIdeTab(t.dataset.tab);
    });
    const panel = document.createElement("div");
    panel.className = "luogusp-ide-panel";
    panel.innerHTML =
      '<div class="luogusp-ide-head">' +
      '<span class="luogusp-ide-title">样例测试</span>' +
      '<span class="luogusp-ide-summary">尚未运行</span>' +
      '<span class="luogusp-ide-headbtns"></span>' +
      "</div>" +
      '<div class="luogusp-ide-rows"></div>';
    // 停止/重新測試：同樣克隆原生「自測」繼承樣式
    const tpl = [
      ...document.querySelectorAll(`${SELECTORS.ideToolbar} button`),
    ].find(
      (b) =>
        (b.textContent || "").trim() === "自测" ||
        b.classList.contains("luogusp-ide-batch-btn"),
    );
    const headBtns = panel.querySelector(".luogusp-ide-headbtns");
    const mkBtn = (text, cls, onClick) => {
      const b = tpl ? tpl.cloneNode(true) : document.createElement("button");
      b.textContent = text;
      dropInheritedNames(b);
      b.className = (tpl ? tpl.className : "") + " " + cls;
      b.classList.remove("luogusp-ide-batch-btn");
      b.disabled = false;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      headBtns.appendChild(b);
      return b;
    };
    IDE_VIEW.stopBtn = mkBtn("停止", "luogusp-ide-stop", controls.stop);
    IDE_VIEW.stopBtn.style.display = "none";
    mkBtn("重新测试", "luogusp-ide-rerun", controls.start);
    host.insertBefore(tabBar, ioLayout);
    host.appendChild(panel);
    IDE_VIEW.tabBar = tabBar;
    IDE_VIEW.panel = panel;
    IDE_VIEW.ioLayout = ioLayout;
    IDE_VIEW.rowsEl = panel.querySelector(".luogusp-ide-rows");
    IDE_VIEW.summaryEl = panel.querySelector(".luogusp-ide-summary");
    syncIdeTabVisibility();
  }
  function switchIdeTab(tab) {
    IDE_VIEW.activeTab = tab;
    syncIdeTabVisibility();
  }
  function syncIdeTabVisibility() {
    const { tabBar, panel, ioLayout } = IDE_VIEW;
    if (!tabBar || !document.contains(tabBar) || !panel || !ioLayout) return;
    const samples = IDE_VIEW.activeTab === "samples";
    ioLayout.style.display = samples ? "none" : "";
    panel.style.display = samples ? "" : "none";
    tabBar.querySelectorAll(".luogusp-ide-tab").forEach((t) => {
      t.classList.toggle("on", (t.dataset.tab === "samples") === samples);
    });
  }

  const IDE_PILL_WAIT =
    "background-color:#bfbfbf;border-color:#b3b3b3;color:#fff;";
  const IDE_PILL_RUN =
    "background-color:#3498db;border-color:#2f89c5;color:#fff;";
  function renderIdeRows(samples) {
    const rowsEl = IDE_VIEW.rowsEl;
    if (!rowsEl) return;
    rowsEl.innerHTML = samples
      .map(
        (s, i) => `
      <div class="luogusp-ide-row" data-idx="${i}">
        <div class="luogusp-ide-rowhead">
          <span class="luogusp-ide-chev">▶</span>样例 #${i + 1}
          <span class="luogusp-ide-meta"></span>
          <span class="luogusp-ide-pill" style="${IDE_PILL_WAIT}">等待</span>
        </div>
        <div class="luogusp-ide-detail"></div>
      </div>`,
      )
      .join("");
    rowsEl.querySelectorAll(".luogusp-ide-rowhead").forEach((h) => {
      h.addEventListener("click", () => {
        const row = h.parentElement;
        const was = row.classList.contains("open");
        rowsEl
          .querySelectorAll(".luogusp-ide-row.open")
          .forEach((r) => r.classList.remove("open"));
        if (!was) row.classList.add("open");
      });
    });
  }
  function ideRowParts(i) {
    const row =
      IDE_VIEW.rowsEl &&
      IDE_VIEW.rowsEl.querySelector(`.luogusp-ide-row[data-idx="${i}"]`);
    if (!row) return null;
    return {
      row,
      pill: row.querySelector(".luogusp-ide-pill"),
      meta: row.querySelector(".luogusp-ide-meta"),
      detail: row.querySelector(".luogusp-ide-detail"),
    };
  }
  function expandIdeRow(i) {
    if (!IDE_VIEW.rowsEl) return;
    IDE_VIEW.rowsEl
      .querySelectorAll(".luogusp-ide-row.open")
      .forEach((r) => r.classList.remove("open"));
    const p = ideRowParts(i);
    if (p) p.row.classList.add("open");
  }

  function ensureIdeBatchUI(controls) {
    if (!ideModeActive()) {
      unmountIdeBatchUI();
      controls.invalidate();
      return;
    }
    mountIdeButton(controls);
    mountIdeTabs(controls);
    syncIdeTabVisibility();
  }

  function unmountIdeBatchUI() {
    IDE_VIEW.activeTab = "custom"; // 復位，防再次進入時預設落在空面板
    IDE_VIEW.tabBar = IDE_VIEW.panel = IDE_VIEW.ioLayout = null;
    IDE_VIEW.rowsEl = IDE_VIEW.summaryEl = IDE_VIEW.stopBtn = null;
  }

  const ideBrowserDriver = {
    mountKey: () => document.body,
    prepare: async ({ runId, signal }) => {
      mountIdeTabs(ideBrowserDriver.controls);
      const pid = currentPid();
      const routeToken = `${location.pathname}${location.search}${location.hash}`;
      const samples = await getIdeSamples(signal);
      if (
        !pid ||
        currentPid() !== pid ||
        `${location.pathname}${location.search}${location.hash}` !==
          routeToken ||
        !ideModeActive()
      )
        return { kind: "hint", message: "页面已切换" };
      if (!samples || !samples.length)
        return { kind: "hint", message: "本题无样例" };
      if (!readIdeCode().trim())
        return { kind: "hint", message: "代码为空" };
      const runButtons = sampleRunButtons();
      if (!runButtons.length)
        return { kind: "hint", message: "找不到样例运行按钮" };
      const count = Math.min(samples.length, runButtons.length);
      if (runButtons.length !== samples.length)
        console.error(
          "LuoguSP ide batch: 样例数与运行按钮数不一致",
          samples.length,
          runButtons.length,
        );
      const inputToolbar = ideToolbarByTitle("输入");
      const input =
        inputToolbar && inputToolbar.parentElement
          ? inputToolbar.parentElement.querySelector(SELECTORS.ideTextarea)
          : null;
      const codeToolbar = ideToolbarByTitle("代码");
      const actions =
        codeToolbar && codeToolbar.querySelector(SELECTORS.ideToolbarActions);
      const selfTest = actions
        ? [...actions.querySelectorAll("button")].find(
            (button) => (button.textContent || "").trim() === "自测",
          )
        : null;
      return {
        kind: "ready",
        runId,
        pid,
        routeToken,
        samples,
        runButtons,
        count,
        input,
        inputSnapshot: input ? input.value : null,
        batchButton: document.querySelector(".luogusp-ide-batch-btn"),
        selfTest,
      };
    },
    isCurrent: (context) =>
      ideModeActive() &&
      currentPid() === context.pid &&
      `${location.pathname}${location.search}${location.hash}` ===
        context.routeToken,
    hint: (message) => ideBatchHint(message),
    begin: (context) => {
      if (context.batchButton) context.batchButton.disabled = true;
      if (context.selfTest) context.selfTest.disabled = true;
      if (IDE_VIEW.stopBtn) IDE_VIEW.stopBtn.style.display = "";
      switchIdeTab("samples");
      renderIdeRows(context.samples);
      if (IDE_VIEW.summaryEl) IDE_VIEW.summaryEl.textContent = "测试中…";
    },
    setRunning: (_context, index) => {
      const parts = ideRowParts(index);
      if (parts) {
        parts.pill.setAttribute("style", IDE_PILL_RUN);
        parts.pill.textContent = "运行中";
      }
      expandIdeRow(index);
    },
    runSample: async (context, index, task) => {
      try {
        return await runOneSample(
          context.runButtons[index],
          task.runId,
          task.drive,
          task.isCurrent,
          task.wait,
        );
      } catch (error) {
        cancelIdeSubmitWaiter(task.runId);
        throw error;
      }
    },
    applyResult: (context, index, result) =>
      applyIdeResult(index, result, context.samples[index]),
    restore: (context) => {
      if (context.input && context.inputSnapshot != null) {
        context.input.value = context.inputSnapshot;
        context.input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    finish: (context, results) => {
      if (context.batchButton) context.batchButton.disabled = false;
      if (context.selfTest) context.selfTest.disabled = false;
      if (IDE_VIEW.stopBtn) IDE_VIEW.stopBtn.style.display = "none";
      finishIdeSummary(results);
    },
    cancel: () => cancelIdeSubmitWaiter(),
    markStale: showIdeStale,
    mount: (controls) => {
      ideBrowserDriver.controls = controls;
      const unpatchSubmit = installIdeSubmitObserver();
      const unhook = hookIdeStaleAndGuard(controls);
      let frame = null;
      const tick = () => {
        frame = null;
        try {
          ensureIdeBatchUI(controls);
        } catch (error) {
          console.error("LuoguSP ide batch:", error);
        }
      };
      const queue = () => {
        if (frame === null) frame = requestAnimationFrame(tick);
      };
      const observer = new MutationObserver(() => {
        if (
          location.hash === "#ide" ||
          IDE_VIEW.tabBar ||
          controls.isRunning()
        )
          queue();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      ensureIdeBatchUI(controls);
      return () => {
        observer.disconnect();
        unpatchSubmit();
        unhook();
        ideHint.cancel();
        if (frame !== null) cancelAnimationFrame(frame);
        cancelIdeSubmitWaiter();
        unmountIdeBatchUI();
      };
    },
  };

  const idePreparation = idePreparationAdapter;
  const ideDriver = idePreparation
    ? {
        prepare: async ({ signal }) => {
          idePreparation.mountTabs();
          const pid = idePreparation.currentPid();
          const samples = await idePreparation.loadSamples(signal);
          if (
            !pid ||
            idePreparation.currentPid() !== pid ||
            !idePreparation.isModeActive()
          )
            return { kind: "hint", message: "页面已切换" };
          if (!samples || !samples.length)
            return { kind: "hint", message: "本题无样例" };
          return { kind: "ready", count: 0, pid, samples };
        },
        isCurrent: () => true,
        hint: (message) => idePreparation.hint(message),
        runSample: async () => ({ verdict: "UKE" }),
      }
    : ideBrowserDriver;
  const ideBatchRunner = createIdeBatchRunner({
    ideDriver,
    clock: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    },
    logError: (error) => console.error("LuoguSP ide batch:", error),
  });
  const startIdeBatch = () => ideBatchRunner.start();

  const descriptor = defineConfigurableFeature({
    id: "ide-batch",
    key: "ideBatchSampleTest",
    label: "IDE 模式一键测试所有样例",
    storage,
    mount: () => {
      injectStyle();
      ideBatchRunner.mount();
      return () => ideBatchRunner.unmount();
    },
  });
  return Object.freeze({
    ...descriptor,
    start: startIdeBatch,
    getState: () => ideBatchRunner.getState(),
  });
}
