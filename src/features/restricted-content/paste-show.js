// 2026-09 洛谷雲剪貼簿詳情是 columba 範本 paste.show。
// PasteShow 讀 lentille data.paste / data.canEdit，元資訊在
// .paste-show-card .meta-row > .meta-left 裡，標籤是「發佈時間」。
// 不寫 expireTime：元件會據此繪製「已過期 / 臨期」，保存站沒有這個欄位。

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
