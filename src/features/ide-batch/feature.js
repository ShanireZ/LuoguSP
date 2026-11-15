import { defineConfigurableFeature } from "../../app/feature-descriptor.js";
import { IDE_BATCH_LABEL, createBatchButtonHint } from "./batch-hint.js";
import {
  diffIdeLines,
  idePane,
  normalizeIdeOut,
} from "./result-view.js";
import { createIdeBatchRunner } from "./runner.js";
import {
  createIdeSubmissionMatcher,
  readIdeCompilerSettings,
  sameIdeCompilerSettings,
  watchIdeCompilerSettings,
} from "./run-configuration.js";
import { IDE_BATCH_STYLE } from "./style.js";
import { observeIdeOutput } from "./output-observer.js";
import { readIdeSubmitResponse } from "./submit-response.js";
import { createIdeTabControls } from "./tab-controls.js";

export function createIdeBatchFeature({ storage, problemData }) {
  const SELECTORS = {
    ideToolbar: ".ide-toolbar",
    ideToolbarText: ".title .text",
    ideToolbarActions: ".actions",
    ideRunResult: ".run-result",
    ideTextarea: "textarea.ide-textarea",
    ideSampleBlock: ".io-sample-block",
    cmContent: ".cm-content",
  };
  const injectStyle = () => {
    if (IDE_VIEW.style?.isConnected) return;
    const style = document.createElement("style");
    style.id = "luogusp-ide-style";
    style.textContent = IDE_BATCH_STYLE;
    (document.head || document.documentElement).appendChild(style);
    IDE_VIEW.style = style;
  };

  // ============================================================
  // IDE 模式一鍵測試所有範例
  // 洛谷新版題目頁（columba）IDE 模式（#ide）下，逐組驅動題面範例的原生「執行」，
  // 洛谷以 rid 配對推送結果，輸出面板未公開這個識別碼。
  // 同一份文件中，只在沒有未確認的執行時才啟動下一個範例。
  // 錨點與配色均來自 2026-07 洛谷 columba IDE 的真實頁面觀測。
  // ============================================================
  function ideToolbarByTitle(title, root = document) {
    for (const tb of root.querySelectorAll(SELECTORS.ideToolbar)) {
      const t = tb.querySelector(SELECTORS.ideToolbarText);
      if (t && t.textContent.trim() === title) return tb;
    }
    return null;
  }

  const IDE_VIEW = {
    activeTab: "custom", // custom=原生輸入輸出 / samples=範例面板
    button: null,
    style: null,
    tabBar: null,
    panel: null,
    ioLayout: null, // 原生 輸入|輸出 水平分欄（tab 切換時顯隱）
    hiddenInput: null,
    restoreInputAttributes: null,
    rowsEl: null,
    summaryEl: null,
    stopBtn: null,
  };

  function ideModeActive() {
    return (
      location.hash === "#ide" && !!document.querySelector(SELECTORS.ideToolbar)
    );
  }

  function currentPid() {
    const m = location.pathname.match(/^\/problem\/([A-Za-z0-9_]+)/);
    return m ? m[1] : "";
  }
  async function getIdeSamples(signal) {
    const pid = currentPid();
    if (!pid || !problemData) return null;
    const href = location.href;
    const samples = problemData.peek(pid, { href })?.data.problem.samples;
    if (samples) return samples;
    try {
      return (await problemData.load(pid, { href, signal }))?.data.problem.samples ?? null;
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
  const codeActions = () => ideToolbarByTitle("代码")?.querySelector(SELECTORS.ideToolbarActions);

  const IDE_SUBMIT_PATH = "/api/ide_submit";
  const IDE_RESULT_UNCONFIRMED = "上次运行结果未确认，请刷新页面后重试";
  const IDE_CONFIGURATION_STALE = "代码或编译设置已更改 · 结果已过期";
  // The native run can outlive the userscript's route and its HTTP waiter.
  let pendingNativeAttempt = null;
  let ideSubmitWaiter = null;

  function isIdeSubmitUrl(url) {
    try {
      const target = new URL(url, document.baseURI);
      return target.origin === location.origin && target.pathname === IDE_SUBMIT_PATH;
    } catch {
      return false;
    }
  }

  function cancelIdeSubmitWaiter(runId) {
    if (!ideSubmitWaiter) return;
    if (runId != null && ideSubmitWaiter.runId !== runId) return;
    const waiter = ideSubmitWaiter;
    ideSubmitWaiter = null;
    waiter.resolve(null);
  }
  function installIdeSubmitObserver() {
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    const submitRequests = new WeakMap();
    let active = true;
    const open = function (method, url) {
      submitRequests.delete(this);
      if (active && pendingNativeAttempt && String(method).toUpperCase() === "POST" &&
          isIdeSubmitUrl(url))
        submitRequests.set(this, pendingNativeAttempt);
      return rawOpen.apply(this, arguments);
    };
    const send = function (body) {
      const attempt = active && submitRequests.get(this);
      const waiter = ideSubmitWaiter;
      if (attempt && waiter?.attempt === attempt && !attempt.claimed) {
        const match = attempt.match(body);
        if (match !== "matched") {
          attempt.configurationMismatch ||= match === "configuration-mismatch";
          return rawSend.apply(this, arguments);
        }
        attempt.claimed = true;
        const readResult = () => isIdeSubmitUrl(this.responseURL) ? readIdeSubmitResponse(this) : { status: 0 };
        const confirmInlineOutput = () => {
          if (this.readyState !== XMLHttpRequest.DONE) return;
          this.removeEventListener("readystatechange", confirmInlineOutput);
          if (!active || ideSubmitWaiter !== waiter) return;
          const { inlineOutput } = readResult();
          // At DONE the exact matched response is readable. Native handling can
          // paint an inline verdict in its load handler, before our loadend.
          if (inlineOutput !== undefined) waiter.confirmOutput(inlineOutput);
        };
        this.addEventListener("readystatechange", confirmInlineOutput);
        this.addEventListener(
          "loadend",
          () => {
            this.removeEventListener("readystatechange", confirmInlineOutput);
            const result = readResult();
            if (result.rejected && pendingNativeAttempt === attempt)
              pendingNativeAttempt = null;
            if (!active || ideSubmitWaiter !== waiter) return;
            ideSubmitWaiter = null;
            if (result.accepted && !result.outputResult) waiter.confirmOutput(result.inlineOutput);
            waiter.resolve(result);
          },
          { once: true },
        );
      }
      return rawSend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open = open;
    XMLHttpRequest.prototype.send = send;
    return () => {
      active = false;
      cancelIdeSubmitWaiter();
      if (XMLHttpRequest.prototype.open === open)
        XMLHttpRequest.prototype.open = rawOpen;
      if (XMLHttpRequest.prototype.send === send)
        XMLHttpRequest.prototype.send = rawSend;
    };
  }
  function waitIdeSubmit(ms, runId, attempt, confirmOutput) {
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
      ideSubmitWaiter = { runId, resolve: fn, attempt, confirmOutput };
    });
  }
  function outputParts(root) {
    const tb = ideToolbarByTitle("输出", root);
    if (!tb) return null;
    const actions = tb.querySelector(SELECTORS.ideToolbarActions);
    const spans = actions ? [...actions.querySelectorAll("span")] : [];
    return {
      panel: tb.parentElement,
      pill: spans.find((s) => !s.classList.contains("run-result")) || null,
      rr: actions ? actions.querySelector(SELECTORS.ideRunResult) : null,
      textarea: tb.parentElement
        ? tb.parentElement.querySelector(SELECTORS.ideTextarea)
        : null,
    };
  }
  async function runOneSample(runBtn, match, { runId, drive, isCurrent, wait, signal }) {
    let output;
    let attempt;
    const uncertain = (note) => ({ verdict: "UKE", note, uncertain: true });
    const submit = (parts) => {
      attempt = { match, claimed: false, configurationMismatch: false };
      const root = parts.panel.parentElement || parts.panel;
      output = observeIdeOutput({
        root, readParts: () => outputParts(root), signal, isCurrent,
      });
      const submitP = waitIdeSubmit(10000, runId, attempt, output.confirmSubmit);
      if (!drive(() => {
        pendingNativeAttempt = attempt;
        runBtn.click();
        return true;
      })) {
        cancelIdeSubmitWaiter(runId);
        return null;
      }
      return submitP;
    };
    const before = outputParts();
    if (!before) return { verdict: "UKE", note: "IDE 面板不存在" };
    try {
      const first = submit(before);
      if (!first) return null;
      let submission = await first;
      if (submission?.status === 429) {
        output.dispose();
        if (!(await wait(3000)) || !isCurrent()) return { verdict: "UKE", note: "页面已切换" };
        const parts = outputParts();
        if (!parts) return { verdict: "UKE", note: "IDE 面板不存在" };
        const retry = submit(parts);
        if (!retry) return null;
        submission = await retry;
      }
      if (submission?.rejected)
        return { verdict: "UKE", note: `提交失败 HTTP ${submission.status}` };
      if (!submission?.accepted) return {
        ...uncertain("未能确认提交结果，请刷新页面后重试"),
        stale: !attempt.claimed && attempt.configurationMismatch,
      };
      const { kind, ...result } = submission.outputResult ?? await output.wait();
      if (kind === "result" && isCurrent() && pendingNativeAttempt === attempt) {
        pendingNativeAttempt = null;
        return result;
      }
      return uncertain(IDE_RESULT_UNCONFIRMED);
    } finally {
      output?.dispose();
    }
  }

  // 提示狀態機搬到了 batch-hint.js（那邊記著它為什麼必須恢復成固定文案）。
  const ideHint = createBatchButtonHint({
    findButton: () => IDE_VIEW.button,
  });

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
      // CE：不顯示三欄，直接展示原生編譯紀錄。
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
    const outputLines = (value) => {
      const output = normalizeIdeOut(value);
      return output ? output.split("\n") : [];
    };
    const expLines = outputLines(sample[1]);
    const actLines = outputLines(r.output);
    const diff = r.verdict === "AC" ? null : diffIdeLines(expLines, actLines);
    const expectedPane = idePane("期望输出", expLines, diff?.expected, "（空）");
    const actualPane = idePane("实际输出", actLines, diff?.actual, "（未产生输出）");
    const expectedFirst = diff?.expected.values().next().value ?? Infinity;
    const actualFirst = diff?.actual.values().next().value ?? Infinity;
    const first = (actualFirst <= expectedFirst ? actualPane : expectedPane)
      .querySelector(".luogusp-ide-diffline");
    if (first) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "luogusp-ide-jump";
      jump.textContent = "跳到第一处差异";
      jump.addEventListener("click", () => {
        first.focus({ preventScroll: true });
        first.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
      p.detail.append(jump);
    }
    p.detail.append(
      idePane("输入", normalizeIdeOut(sample[0]).split("\n"), null, "（空）"),
      expectedPane,
      actualPane,
    );
  }

  function finishIdeSummary(results, stale) {
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
    let text = stale ? IDE_CONFIGURATION_STALE : `${ac}/${rs.length} 通过`;
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
    expandIdeRow(rs.findIndex((r) => r && r.verdict !== "AC"));
  }

  function showIdeStale(active) {
    if (!IDE_VIEW.summaryEl || !document.contains(IDE_VIEW.summaryEl)) return;
    if (active) {
      if (IDE_VIEW.stopBtn) IDE_VIEW.stopBtn.disabled = true;
      IDE_VIEW.summaryEl.textContent = `${IDE_CONFIGURATION_STALE}，正在停止…`;
    } else IDE_VIEW.summaryEl.textContent += ` · ${IDE_CONFIGURATION_STALE}`;
  }
  function hookIdeStaleAndGuard(controls) {
    // CodeMirror emits input when the user edits its contenteditable.
    const stale = (e) => {
      if (e.target && e.target.closest && e.target.closest(SELECTORS.cmContent))
        controls.markStale();
    };
    document.addEventListener("input", stale, true);
    // 批測中攔掉使用者手點原生 執行/自測（處理程序化點擊帶 driving 標記放行）
    const guard = (e) => {
      if (!controls.isRunning() || controls.isDriving()) return;
      const t =
        e.target &&
        e.target.closest &&
        e.target.closest(
          `${SELECTORS.ideSampleBlock} :is(a, button), ${SELECTORS.ideToolbar} .run`,
        );
      if (t) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => {
      document.removeEventListener("input", stale, true);
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
    if (!actions || IDE_VIEW.button?.parentElement === actions) return;
    const selfTest = [...actions.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "自测",
    );
    if (!selfTest) return;
    IDE_VIEW.button?.remove();
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
    IDE_VIEW.button = btn;
  }

  function mountIdeTabs(controls) {
    const inputTb = ideToolbarByTitle("输入");
    if (!inputTb) return;
    const ioLayout = inputTb.closest(".panel-layout"); // 底部 輸入|輸出 水平分欄
    const host = ioLayout && ioLayout.parentElement;
    if (!host) return;
    if (
      IDE_VIEW.ioLayout === ioLayout &&
      IDE_VIEW.tabBar?.parentElement === host &&
      IDE_VIEW.panel?.parentElement === host
    )
      return;
    if (IDE_VIEW.ioLayout) {
      controls.invalidate();
      unmountIdeTabs();
    }
    const { tabBar, panel, restoreInputAttributes } = createIdeTabControls(ioLayout, switchIdeTab);
    IDE_VIEW.restoreInputAttributes = restoreInputAttributes;
    panel.innerHTML =
      '<div class="luogusp-ide-head">' +
      '<span class="luogusp-ide-title">样例测试</span>' +
      '<span class="luogusp-ide-summary" role="status">尚未运行</span>' +
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
  function restoreIdeInput() {
    const previous = IDE_VIEW.hiddenInput;
    IDE_VIEW.hiddenInput = null;
    if (!previous) return;
    const { style } = previous.layout;
    if (style.display === "none" && style.getPropertyPriority("display") === "")
      style.setProperty("display", previous.display, previous.priority);
  }
  function syncIdeTabVisibility() {
    const { tabBar, panel, ioLayout } = IDE_VIEW;
    if (!tabBar || !document.contains(tabBar) || !panel || !ioLayout) return;
    const samples = IDE_VIEW.activeTab === "samples";
    const focusWillHide = (samples ? ioLayout : panel).contains(document.activeElement);
    if (samples && !IDE_VIEW.hiddenInput) {
      IDE_VIEW.hiddenInput = {
        layout: ioLayout,
        display: ioLayout.style.display,
        priority: ioLayout.style.getPropertyPriority("display"),
      };
      ioLayout.style.display = "none";
    }
    if (!samples) restoreIdeInput();
    panel.style.display = samples ? "" : "none";
    tabBar.querySelectorAll(".luogusp-ide-tab").forEach((t) => {
      const selected = t.dataset.tab === IDE_VIEW.activeTab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      if (selected && focusWillHide) t.focus({ preventScroll: true });
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
        <button type="button" class="luogusp-ide-rowhead" aria-expanded="false" aria-controls="luogusp-ide-detail-${i}">
          <span class="luogusp-ide-chev" aria-hidden="true">▶</span>样例 #${i + 1}
          <span class="luogusp-ide-meta"></span>
          <span class="luogusp-ide-pill" style="${IDE_PILL_WAIT}">等待</span>
        </button>
        <div class="luogusp-ide-detail" id="luogusp-ide-detail-${i}"></div>
      </div>`,
      )
      .join("");
    rowsEl.querySelectorAll(".luogusp-ide-rowhead").forEach((h) => {
      h.addEventListener("click", () => {
        const row = h.parentElement;
        expandIdeRow(row.classList.contains("open") ? -1 : Number(row.dataset.idx));
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
    const previous = IDE_VIEW.rowsEl.querySelector(".luogusp-ide-row.open");
    const next = ideRowParts(i)?.row;
    if (previous === next) return;
    if (previous) {
      const button = previous.querySelector(".luogusp-ide-rowhead");
      const detail = previous.querySelector(".luogusp-ide-detail");
      if (detail.contains(document.activeElement)) button.focus({ preventScroll: true });
      button.setAttribute("aria-expanded", "false");
      previous.classList.remove("open");
    }
    if (next) {
      next.querySelector(".luogusp-ide-rowhead").setAttribute("aria-expanded", "true");
      next.classList.add("open");
    }
  }

  function ensureIdeBatchUI(controls) {
    if (!ideModeActive()) {
      controls.invalidate();
      unmountIdeBatchUI();
      return;
    }
    injectStyle();
    mountIdeButton(controls);
    mountIdeTabs(controls);
    syncIdeTabVisibility();
  }

  function unmountIdeTabs() {
    stopWatchingCompiler?.();
    stopWatchingCompiler = null;
    restoreIdeInput();
    IDE_VIEW.restoreInputAttributes?.();
    IDE_VIEW.restoreInputAttributes = null;
    IDE_VIEW.tabBar?.remove();
    IDE_VIEW.panel?.remove();
    IDE_VIEW.activeTab = "custom";
    IDE_VIEW.tabBar = IDE_VIEW.panel = IDE_VIEW.ioLayout = null;
    IDE_VIEW.rowsEl = IDE_VIEW.summaryEl = IDE_VIEW.stopBtn = null;
  }

  function unmountIdeBatchUI() {
    ideHint.cancel();
    unmountIdeTabs();
    IDE_VIEW.button?.remove();
    IDE_VIEW.style?.remove();
    IDE_VIEW.button = IDE_VIEW.style = null;
  }

  let disabledSelfTest = null;
  let stopWatchingCompiler = null;
  function restoreIdeRunControls() {
    if (IDE_VIEW.button) IDE_VIEW.button.disabled = false;
    if (disabledSelfTest) disabledSelfTest.disabled = false;
    disabledSelfTest = null;
  }

  const ideBrowserDriver = {
    mountKey: () => document.body,
    prepare: async ({ runId, signal }) => {
      if (pendingNativeAttempt)
        return { kind: "hint", message: IDE_RESULT_UNCONFIRMED };
      mountIdeTabs(ideBrowserDriver.controls);
      const pid = currentPid();
      const routeToken = `${location.pathname}${location.search}${location.hash}`;
      const source = readIdeCode();
      const compilerSettings = readIdeCompilerSettings(codeActions());
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
      if (!source.trim())
        return { kind: "hint", message: "代码为空" };
      if (!compilerSettings)
        return { kind: "hint", message: "无法确认 IDE 编译设置" };
      const configuration = Object.freeze({ source, ...compilerSettings });
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
      const actions = codeActions();
      const selfTest = actions
        ? [...actions.querySelectorAll("button")].find(
            (button) => (button.textContent || "").trim() === "自测",
          )
        : null;
      if (selfTest?.disabled ||
          inputToolbar?.querySelector('.run-status, .run[disabled], .run[aria-disabled="true"]'))
        return { kind: "hint", message: "洛谷 IDE 正在运行，请稍后重试" };
      return {
        kind: "ready",
        runId,
        pid,
        routeToken,
        configuration,
        matchSubmission: createIdeSubmissionMatcher(configuration),
        samples,
        runButtons,
        count,
        input,
        inputSnapshot: input ? input.value : null,
        selfTest,
      };
    },
    isCurrent: (context) =>
      ideModeActive() &&
      currentPid() === context.pid &&
      `${location.pathname}${location.search}${location.hash}` ===
        context.routeToken,
    configurationMatches: ({ configuration }) =>
      readIdeCode() === configuration.source &&
      sameIdeCompilerSettings(configuration, readIdeCompilerSettings(codeActions())),
    hint: (message) => ideHint.show(message),
    begin: (context) => {
      stopWatchingCompiler?.();
      stopWatchingCompiler = watchIdeCompilerSettings(
        codeActions, context.configuration, ideBrowserDriver.controls.markStale,
      );
      if (IDE_VIEW.button) IDE_VIEW.button.disabled = true;
      if (context.selfTest && !context.selfTest.disabled) {
        context.selfTest.disabled = true;
        disabledSelfTest = context.selfTest;
      }
      if (IDE_VIEW.stopBtn) {
        IDE_VIEW.stopBtn.style.display = "";
        IDE_VIEW.stopBtn.disabled = false;
      }
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
    setStopping: (sampleRunning) => {
      if (IDE_VIEW.stopBtn) IDE_VIEW.stopBtn.disabled = true;
      if (IDE_VIEW.summaryEl) IDE_VIEW.summaryEl.textContent = sampleRunning
        ? "当前样例完成后停止…" : "正在停止…";
    },
    runSample: async (context, index, task) => {
      try {
        const match = (body) => context.matchSubmission(body, context.samples[index][0]);
        return await runOneSample(context.runButtons[index], match, task);
      } catch (error) {
        cancelIdeSubmitWaiter(task.runId);
        if (pendingNativeAttempt)
          return { verdict: "UKE", note: IDE_RESULT_UNCONFIRMED, uncertain: true };
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
    finish: (_context, results, { stale }) => {
      restoreIdeRunControls();
      if (IDE_VIEW.stopBtn) IDE_VIEW.stopBtn.style.display = "none";
      finishIdeSummary(results, stale);
    },
    cancel: () => {
      cancelIdeSubmitWaiter();
      restoreIdeRunControls();
    },
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
        if (frame !== null) cancelAnimationFrame(frame);
        unmountIdeBatchUI();
      };
    },
  };

  const ideBatchRunner = createIdeBatchRunner({
    ideDriver: ideBrowserDriver,
    clock: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    },
    logError: (error) => console.error("LuoguSP ide batch:", error),
  });
  return defineConfigurableFeature({
    id: "ide-batch",
    key: "ideBatchSampleTest",
    label: "IDE 模式一键测试所有样例",
    storage,
    mount: () => {
      if (location.hash !== "#ide") return;
      ideBatchRunner.mount();
      return () => ideBatchRunner.unmount();
    },
  });
}
