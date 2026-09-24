const ATTEMPTED_PROBLEMS_HEADING = "尝试过的题目";
const PRACTICE_PATH = /^\/user\/\d+\/practice\/?$/;
// 评测记录列表的题号由洛谷按难度上色；学习模式会关掉这层颜色。
// 插件再染一次，要么叠在原生颜色上，要么把用户刻意隐藏的难度漏回去。
const RECORD_LIST_PATH = /^\/record\/list\/?$/;

function directHeading(card) {
  for (const child of card?.children || []) {
    if (child.tagName === "H3")
      return (child.textContent || "").trim();
  }
  return "";
}

export function isProblemAnchorColorable(
  anchor,
  pathname = globalThis.location?.pathname || "",
) {
  if (RECORD_LIST_PATH.test(pathname)) return false;
  if (!PRACTICE_PATH.test(pathname)) return true;
  if (!anchor || typeof anchor.closest !== "function") return false;
  const card = anchor.closest(".l-card");
  return directHeading(card) === ATTEMPTED_PROBLEMS_HEADING;
}
