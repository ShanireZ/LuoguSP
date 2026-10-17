const ATTEMPTED_PROBLEMS_HEADING = "尝试过的题目";
const PRACTICE_PATH = /^\/user\/\d+\/practice\/?$/;
// 評測記錄列表的題號由洛谷按難度上色；學習模式會關掉這層顏色。
// 外掛再染一次，要麼疊在原生顏色上，要麼把使用者刻意隱藏的難度漏回去。
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
