const ATTEMPTED_PROBLEMS_HEADING = "尝试过的题目";
const PRACTICE_PATH = /^\/user\/\d+\/practice\/?$/;

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
  if (!PRACTICE_PATH.test(pathname)) return true;
  if (!anchor || typeof anchor.closest !== "function") return false;
  const card = anchor.closest(".l-card");
  return directHeading(card) === ATTEMPTED_PROBLEMS_HEADING;
}
