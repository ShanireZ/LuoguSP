// article.show submits vote=-1|0|1 and uses the server's {upvotes, voted}.
// Favor sends no query for add or remove=1 for removal, and may return no body.
const VOTE_VALUES = new Set(["-1", "0", "1"]);
const FAVOR_FIELDS = new Set(["_empty", "favored", "favorCount", "favors"]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isSuccessStatus = (status) => Number.isInteger(status) && status >= 200 && status < 300;
const isResponseObject = (body) => isObject(body) &&
  !["error", "errorMessage", "errors"].some((key) => Object.hasOwn(body, key)) &&
  (!Object.hasOwn(body, "success") || body.success === true) &&
  (!Object.hasOwn(body, "code") || isSuccessStatus(body.code)) &&
  (!Object.hasOwn(body, "status") || isSuccessStatus(body.status));

export function articleWriteRequestUrl({ origin, lid, method, url, status, URL: URLCtor = URL } = {}) {
  if (typeof origin !== "string" || typeof lid !== "string" ||
    String(method).toUpperCase() !== "POST" || !isSuccessStatus(status)) return null;
  try {
    const request = new URLCtor(url, origin);
    const { origin: requestOrigin, pathname } = request;
    if (requestOrigin === origin &&
      (pathname === `/article/${lid}/vote` || pathname === `/article/${lid}/favor`))
      return request;
  } catch {
    // Invalid URL.
  }
  return null;
}

function responseMatches(request, { responseUrl, redirected, contentType, URL: URLCtor = URL }) {
  if (redirected || typeof responseUrl !== "string" ||
    /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(contentType?.trim())) return false;
  try {
    const response = new URLCtor(responseUrl);
    return response.origin === request.origin &&
      response.pathname === request.pathname && response.search === request.search;
  } catch {
    return false;
  }
}

function parseBody(text) {
  if (text === "") return {};
  if (typeof text !== "string") return null;
  try {
    const body = JSON.parse(text);
    if (!isResponseObject(body)) return null;
    if (!Object.hasOwn(body, "data")) return body;
    return isResponseObject(body.data) ? body.data : null;
  } catch {
    return null;
  }
}

export function interpretArticleWrite(config = {}) {
  const request = articleWriteRequestUrl(config);
  if (!request || !responseMatches(request, config)) return null;
  const body = parseBody(config.responseText);
  if (!body) return null;

  if (request.pathname.endsWith("/vote")) {
    const votes = request.searchParams.getAll("vote");
    const upvote = body.upvotes ?? body.upvote;
    if (votes.length !== 1 || !VOTE_VALUES.has(votes[0]) ||
      body.voted !== Number(votes[0]) || !Number.isSafeInteger(upvote)) return null;
    return { kind: "vote", voted: body.voted, upvote };
  }

  // Accepted work has no completed favorite state, including a provisional JSON body.
  if (config.status === 202) return null;
  const emptyAcknowledgement = Object.keys(body).every((key) => key === "_empty");
  if (emptyAcknowledgement && ![200, 204, 205].includes(config.status)) return null;
  const removals = request.searchParams.getAll("remove");
  if (removals.length && (removals.length !== 1 || removals[0] !== "1")) return null;
  const favored = removals.length === 0;
  const count = body.favorCount ?? body.favors;
  if (Object.keys(body).some((key) => !FAVOR_FIELDS.has(key)) ||
    (Object.hasOwn(body, "_empty") && body._empty !== true) ||
    (Object.hasOwn(body, "favored") && body.favored !== favored) ||
    (["favorCount", "favors"].some((key) => Object.hasOwn(body, key)) &&
      (!Number.isSafeInteger(count) || count < 0))) return null;
  const base = config.current?.favorCount;
  const change = config.current?.favored === favored ? 0 : favored ? 1 : -1;
  const favorCount = count ?? (Number.isSafeInteger(base) ? Math.max(0, base + change) : null);
  return favorCount === null ? { kind: "favor", favored } : { kind: "favor", favored, favorCount };
}
