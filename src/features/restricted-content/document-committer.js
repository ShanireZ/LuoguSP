export function serializeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}

export function createRestrictedDocumentCommitter(config) {
  const { documentAdapter, resourcePolicy } = config || {};
  if (
    !documentAdapter ||
    typeof documentAdapter.open !== "function" ||
    typeof documentAdapter.write !== "function" ||
    typeof documentAdapter.close !== "function"
  )
    throw new TypeError("Document Committer requires a document adapter");
  if (!resourcePolicy || typeof resourcePolicy.isAllowed !== "function")
    throw new TypeError("Document Committer requires a resource policy");
  const committed = new WeakSet();
  const commit = (prepared) => {
    if (
      !prepared ||
      typeof prepared !== "object" ||
      typeof prepared.html !== "string" ||
      !prepared.html.startsWith("<!DOCTYPE html>") ||
      !prepared.html.includes('<div id="app"') ||
      committed.has(prepared)
    )
      throw Object.assign(new Error("受限文档提交数据无效"), {
        kind: "invariant",
      });
    const resourceTags =
      prepared.html.match(
        /<(?:script|link)\b[^>]*(?:src|href)\s*=[^>]+>/gi,
      ) || [];
    const resources = resourceTags.map((tag) => {
      const match = tag.match(/(?:src|href)\s*=\s*(["'])([^"']+)\1/i);
      if (!match)
        throw Object.assign(new Error("受限文档资源地址格式无效"), {
          kind: "invariant",
        });
      return match[2];
    });
    if (!resources.every(resourcePolicy.isAllowed))
      throw Object.assign(new Error("受限文档包含未授权资源"), {
        kind: "invariant",
      });
    committed.add(prepared);
    try {
      if (typeof prepared.install === "function") prepared.install();
      documentAdapter.open();
      documentAdapter.write(prepared.html);
      documentAdapter.close();
    } catch (error) {
      if (typeof prepared.rollback === "function") prepared.rollback();
      throw error;
    }
  };
  return Object.freeze({ commit });
}
