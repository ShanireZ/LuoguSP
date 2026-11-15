export function observeIdeOutput({
  root, readParts, signal, isCurrent,
  MutationObserverImpl = globalThis.MutationObserver,
  clock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  },
}) {
  let baselinePill;
  let expectedOutput;
  let cleared = false;
  let confirmed = false;
  let result;
  let resolveResult;
  let timer = null;
  const promise = new Promise((resolve) => { resolveResult = resolve; });
  const finish = (value) => {
    if (result) return;
    result = value;
    observer.disconnect();
    if (timer !== null) clock.clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    resolveResult(value);
  };
  const cancel = () => finish({ kind: "cancelled" });
  const armTimeout = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = clock.setTimeout(
      () => finish({ kind: cleared ? "timeout" : "uncleared" }),
      cleared ? 30000 : 5000,
    );
  };
  const check = (mutations = []) => {
    if (!isCurrent() || !root.isConnected) return cancel();
    if (!confirmed) return;
    const parts = readParts();
    const sawRemoval = !cleared && mutations.some((mutation) =>
      Array.from(mutation.removedNodes).some((node) =>
        node === baselinePill || node.contains(baselinePill),
      ),
    );
    if (!cleared && (!parts?.pill || sawRemoval)) {
      cleared = true;
      if (timer !== null) armTimeout();
    }
    const verdict = parts?.pill?.textContent.trim();
    if (!cleared || !verdict) return;
    const output = parts.textarea?.value || "";
    if (expectedOutput !== undefined && output !== expectedOutput) return;
    finish({
      kind: "result",
      verdict,
      pillStyle: parts.pill.getAttribute("style") || "",
      detail: parts.rr?.textContent.trim() || "",
      output,
    });
  };
  const observer = new MutationObserverImpl(check);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });

  return {
    confirmSubmit(inlineOutput) {
      if (confirmed || result) return;
      if (!isCurrent() || !root.isConnected) return cancel();
      baselinePill = readParts()?.pill;
      expectedOutput = inlineOutput?.replace(/\r\n?/g, "\n");
      cleared = !baselinePill;
      confirmed = true;
      observer.observe(root, {
        childList: true, subtree: true, characterData: true,
        attributeFilter: ["class", "style"],
      });
    },
    wait() {
      if (!result && timer === null) {
        check();
        if (!result) armTimeout();
      }
      return promise;
    },
    dispose: cancel,
  };
}
