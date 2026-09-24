// 2026-09 洛谷云剪贴板详情是 columba 模板 paste.show。
// PasteShow 读 lentille data.paste / data.canEdit，元信息在
// .paste-show-card .meta-row > .meta-left 里，标签是「发布时间」。
// 不写 expireTime：组件会据此渲染「已过期 / 临期」，保存站没有这个字段。

const PASTE_TIME_LABEL = /发布时间|发表时间|存档时间/;

export function buildPasteShowContext({
  id,
  content,
  user,
  time,
  viewer,
  now,
}) {
  return {
    instance: "main",
    template: "paste.show",
    status: 200,
    locale: "zh-CN",
    data: {
      paste: {
        id: String(id || ""),
        user,
        time: Number(time) || 0,
        public: true,
        data: String(content || ""),
      },
      canEdit: false,
    },
    user: viewer || null,
    time: now,
  };
}

export function findPasteChrome(root) {
  if (!root || typeof root.querySelector !== "function") return null;
  const row = root.querySelector(".paste-show-card .meta-row");
  if (!row || !row.children) return null;
  const meta = [...row.children].find(
    (node) => node.classList && node.classList.contains("meta-left"),
  );
  if (!meta || !meta.children) return null;
  const timeRow = [...meta.children].find((node) =>
    PASTE_TIME_LABEL.test(node.textContent || ""),
  );
  if (!timeRow) return null;
  return { actionsHost: row, timeRow };
}

export function pasteTimeLabel(timeRow) {
  const text = (timeRow && timeRow.textContent) || "";
  if (text.includes("发布时间")) return "发布时间";
  if (text.includes("发表时间")) return "发表时间";
  return null;
}
