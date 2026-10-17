// 把一次「官方寫請求 + 伺服器回應」翻譯成已確認的互動狀態。
// 契約取自官方 article.show 元件（columba chunk columba~0bd2df6a7ee2b996.js）：
//   POST /article/{lid}/vote?vote=<-1|0|1> → 回應體 {upvotes, voted}，元件直接覆蓋計數與個人狀態；
//   POST /article/{lid}/favor[?remove=1]   → 回應體不參與狀態，元件自行 favored=!favored、favorCount±1。
// 因此點讚的計數是伺服器確認值，收藏的計數在回應體缺計數時按同一套 ±1 推導。
// 非 2xx 一律回傳 null：寫失敗不得留下任何樂觀狀態（含持久化）。
const VOTE_VALUES = new Set([-1, 0, 1]);

function parseBody(responseText) {
  if (typeof responseText !== "string" || !responseText.trim()) return {};
  try {
    const parsed = JSON.parse(responseText);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  } catch (error) {
    return {};
  }
}

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (value !== null && value !== undefined && value !== "" &&
      Number.isFinite(parsed))
      return parsed;
  }
  return null;
};

export function interpretArticleWrite(config) {
  const {
    origin,
    lid,
    method,
    url,
    status,
    responseText,
    current,
    URL: URLCtor = URL,
  } = config || {};
  if (typeof origin !== "string" || typeof lid !== "string") return null;
  if (String(method || "").toUpperCase() !== "POST") return null;
  if (!(Number(status) >= 200 && Number(status) < 300)) return null;
  let requestUrl = null;
  try {
    requestUrl = new URLCtor(String(url), origin);
  } catch (error) {
    return null;
  }
  if (requestUrl.origin !== origin) return null;

  const body = parseBody(responseText);
  const known = current || {};
  if (requestUrl.pathname === `/article/${lid}/vote`) {
    const responded = Number(body.voted);
    const requested = Number(requestUrl.searchParams.get("vote"));
    const voted = VOTE_VALUES.has(responded)
      ? responded
      : VOTE_VALUES.has(requested)
        ? requested
        : null;
    if (voted === null) return null;
    const upvote = firstNumber(body.upvotes, body.upvote);
    const result = { kind: "vote", voted };
    if (upvote !== null) result.upvote = upvote;
    return result;
  }
  if (requestUrl.pathname === `/article/${lid}/favor`) {
    const favored = requestUrl.searchParams.get("remove") !== "1";
    const responded = firstNumber(body.favorCount, body.favors);
    const base = firstNumber(known.favorCount);
    const favorCount =
      responded !== null
        ? responded
        : base === null
          ? null
          : Math.max(0, base + (favored ? 1 : -1));
    const result = { kind: "favor", favored };
    if (favorCount !== null) result.favorCount = favorCount;
    return result;
  }
  return null;
}
