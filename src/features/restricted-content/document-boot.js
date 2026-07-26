export function createRestrictedDocumentBoot(config) {
  const {
    pageAdapter,
    saverWorkflow,
    documentBuilder,
    documentCommitter,
    pageLifecycle,
    createAbortController = () => new AbortController(),
    logError = () => {},
  } = config || {};
  if (!pageAdapter || typeof pageAdapter.detect !== "function")
    throw new TypeError("Restricted Document Boot requires a page adapter");
  if (!saverWorkflow || typeof saverWorkflow.ensureArchived !== "function")
    throw new TypeError("Restricted Document Boot requires Saver Workflow");
  if (!documentBuilder || typeof documentBuilder.prepare !== "function")
    throw new TypeError("Restricted Document Boot requires a document builder");
  if (!documentCommitter || typeof documentCommitter.commit !== "function")
    throw new TypeError("Restricted Document Boot requires a document committer");
  if (!pageLifecycle || typeof pageLifecycle.replaceDocument !== "function")
    throw new TypeError("Restricted Document Boot requires Page Lifecycle");

  let taskId = 0;
  let activeController = null;
  let rebuiltPath = "";
  const isCancelled = (error) =>
    error &&
    (error.kind === "cancelled" ||
      error.name === "AbortError" ||
      error.category === "cancelled");
  const mount = (lifecycleContext) => {
    const currentTask = ++taskId;
    let info;
    try {
      info = pageAdapter.detect();
    } catch (error) {
      logError(error);
      if (typeof pageAdapter.hideLoader === "function")
        pageAdapter.hideLoader();
      return () => {};
    }
    if (!info) {
      if (typeof pageAdapter.hideLoader === "function")
        pageAdapter.hideLoader();
      return () => {
        if (typeof documentBuilder.dispose === "function")
          documentBuilder.dispose();
      };
    }
    const controller = createAbortController();
    activeController = controller;
    pageAdapter.showLoader();
    const current = () =>
      currentTask === taskId &&
      !controller.signal.aborted &&
      (!lifecycleContext || lifecycleContext.isCurrent());
    (async () => {
      try {
        const archive = await saverWorkflow.ensureArchived(info.type, info.id, {
          signal: controller.signal,
          onAccepted: () => {
            if (current())
              pageAdapter.showLoader(
                "该内容尚未被保存站收录，已自动发起收录…",
              );
          },
        });
        if (!current()) return;
        if (archive.kind !== "archived") {
          if (archive.category === "cancelled") return;
          if (archive.stage === "lookup")
            return pageAdapter.showUnavailable(
              info,
              `LuoguSP：${archive.reason}，未自动发起收录。`,
            );
          return pageAdapter.showFailure(
            info,
            archive.kind === "unknown"
              ? "收录请求已发送，但保存站未在超时前确认结果，请稍后刷新页面查看。"
              : archive.stage === "create"
                ? "向保存站发起收录请求失败。"
              : archive.reason || "保存站在限定时间内未能完成收录。",
          );
        }
        const prepared = await documentBuilder.prepare(
          info,
          archive.data,
          controller.signal,
        );
        if (!current()) return;
        const replaced = pageLifecycle.replaceDocument(() => {
          documentCommitter.commit(prepared);
          rebuiltPath = info.path || "";
          return () => {
            if (typeof prepared.afterReady === "function")
              prepared.afterReady();
          };
        });
        if (!replaced)
          pageAdapter.showFailure(
            info,
            "原生页面提交失败，请刷新页面后重试。",
          );
      } catch (error) {
        if (!current() || isCancelled(error)) return;
        logError(error);
        pageAdapter.showFailure(
          info,
          error && error.userMessage
            ? error.userMessage
            : `原生页面装配失败：${error}`,
        );
      } finally {
        if (activeController === controller) activeController = null;
      }
    })();
    return () => {
      if (currentTask === taskId) {
        taskId++;
        controller.abort();
        if (activeController === controller) activeController = null;
      }
      if (typeof documentBuilder.dispose === "function")
        documentBuilder.dispose();
      if (typeof pageAdapter.hideLoader === "function")
        pageAdapter.hideLoader();
    };
  };
  const onRoute = () => {
    if (
      rebuiltPath &&
      pageAdapter.currentPath() !== rebuiltPath &&
      pageAdapter.isRestrictedRoute(pageAdapter.currentPath())
    )
      pageAdapter.reload();
  };
  const dispose = () => {
    taskId++;
    if (activeController) activeController.abort();
    activeController = null;
    rebuiltPath = "";
    if (typeof documentBuilder.dispose === "function")
      documentBuilder.dispose();
    if (typeof pageAdapter.hideLoader === "function")
      pageAdapter.hideLoader();
  };
  const getState = () =>
    Object.freeze({ taskId, rebuiltPath, running: !!activeController });
  return Object.freeze({ mount, onRoute, dispose, getState });
}
