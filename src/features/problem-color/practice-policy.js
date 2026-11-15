const ATTEMPTED_PROBLEMS_HEADING = "尝试过的题目";
const PRACTICE_PATH = /^\/user\/\d+\/practice\/?$/;
// 洛谷管理評測記錄列表與詳情的題號顏色，包含難度顯示開關。
const RECORD_PATH = /^\/record\/(?:list|\d+)\/?$/;

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
  if (RECORD_PATH.test(pathname)) return false;
  if (!PRACTICE_PATH.test(pathname)) return true;
  if (!anchor || typeof anchor.closest !== "function") return false;
  const card = anchor.closest(".l-card");
  return directHeading(card) === ATTEMPTED_PROBLEMS_HEADING;
}
