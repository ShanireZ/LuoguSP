export function observeIdeOutput({
  root, readParts, previousPill, signal, isCurrent,
  MutationObserverImpl = globalThis.MutationObserver,
  clock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  },
}) {
  let cleared = !previousPill;
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
    const parts = readParts();
    const sawRemoval = !cleared && mutations.some((mutation) =>
      Array.from(mutation.removedNodes).some((node) =>
        node === previousPill || node.contains(previousPill),
      ),
    );
    if (!cleared && (!parts?.pill || sawRemoval)) {
      cleared = true;
      if (timer !== null) armTimeout();
    }
    const verdict = parts?.pill?.textContent.trim();
    if (!cleared || !verdict) return;
    finish({
      kind: "result",
      verdict,
      pillStyle: parts.pill.getAttribute("style") || "",
      detail: parts.rr?.textContent.trim() || "",
      output: parts.textarea?.value || "",
    });
  };
  const observer = new MutationObserverImpl(check);
  if (signal.aborted) cancel();
  else {
    signal.addEventListener("abort", cancel, { once: true });
    observer.observe(root, {
      childList: true, subtree: true, characterData: true,
      attributeFilter: ["class", "style"],
    });
  }

  return {
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
