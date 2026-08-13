// 关注 / 取消关注。契约 2026-08-13 在 owner 授权下实测抓取（对 owner 自己的另一个账号
// 关注→取消，状态已复核还原）：
//
//   POST /api/user/updateRelationShip      ← 注意 Ship 的 S 大写；同源，无 query
//   Content-Type: application/json
//   X-CSRF-TOKEN: <meta[name=csrf-token]>
//   X-Requested-With: XMLHttpRequest
//   {"uid": 116524, "relationship": 1}     ← 1 = 关注，0 = 取消
//   → 200 {"_empty":true}
//
// ★★ 响应体**不回传新状态**（就是个 `{"_empty":true}`）。这与 `article.favor` 完全同款：
//    客户端自己 toggle 并 `followerCount ± 1`。所以必须**乐观更新 + 失败回滚** ——
//    这正是 canary.7 在收藏计数上踩过的那个坑，别再踩第二遍。

export const FOLLOW_ENDPOINT = "/api/user/updateRelationShip";
export const RELATIONSHIP_FOLLOWING = 1;
export const RELATIONSHIP_UNRELATED = 0;

export function buildFollowRequest(config) {
  const { uid, follow, csrfToken } = config || {};
  const target = Number(uid);
  if (!Number.isSafeInteger(target) || target <= 0) return null;
  if (typeof follow !== "boolean") return null;
  if (typeof csrfToken !== "string" || !csrfToken) return null;
  return Object.freeze({
    url: FOLLOW_ENDPOINT,
    method: "POST",
    headers: Object.freeze({
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      "x-requested-with": "XMLHttpRequest",
    }),
    body: JSON.stringify({
      uid: target,
      relationship: follow ? RELATIONSHIP_FOLLOWING : RELATIONSHIP_UNRELATED,
    }),
  });
}

// 乐观切换：立刻回一个「先按成功算」的状态，同时给出精确的回滚状态。
// 洛谷未知的关系值（0/1 之外，例如黑名单）不允许操作 —— 猜错方向会替用户做错事。
export function planFollowToggle(state) {
  const relation = state && state.relation;
  if (relation !== "following" && relation !== "unrelated") return null;
  const follow = relation === "unrelated";
  const before = Number.isFinite(Number(state.followerCount))
    ? Number(state.followerCount)
    : null;
  const after =
    before === null ? null : Math.max(0, before + (follow ? 1 : -1));
  return Object.freeze({
    follow,
    optimistic: Object.freeze({
      relation: follow ? "following" : "unrelated",
      followerCount: after,
    }),
    rollback: Object.freeze({ relation, followerCount: before }),
  });
}

export function createFollowAction(config) {
  const { request, csrfToken, onState, logError = () => {} } = config || {};

  // 同一个用户的写请求串行化：连点两次不能让两个请求竞速，最后落地的状态会随机。
  const inFlight = new Set();

  const toggle = async (state) => {
    const uid = Number(state && state.uid);
    if (!Number.isSafeInteger(uid) || uid <= 0) return null;
    if (inFlight.has(uid)) return null;
    const plan = planFollowToggle(state);
    if (!plan) return null;
    const payload = buildFollowRequest({
      uid,
      follow: plan.follow,
      csrfToken: typeof csrfToken === "function" ? csrfToken() : csrfToken,
    });
    // 拿不到 CSRF 就别发 —— 发出去只会被洛谷拒绝，还白改一次界面。
    if (!payload) return null;
    inFlight.add(uid);
    if (typeof onState === "function") onState(uid, plan.optimistic, "pending");
    try {
      const response = await request(payload);
      if (!response || response.ok === false)
        throw new Error(
          `关注请求失败：HTTP ${response ? response.status : "无响应"}`,
        );
      if (typeof onState === "function")
        onState(uid, plan.optimistic, "confirmed");
      return plan.optimistic;
    } catch (error) {
      logError(error);
      // ★ 回滚。响应体不带状态，服务器没确认就必须退回原样，不能留一个假的「已关注」。
      if (typeof onState === "function") onState(uid, plan.rollback, "failed");
      return null;
    } finally {
      inFlight.delete(uid);
    }
  };

  return Object.freeze({ toggle, isBusy: (uid) => inFlight.has(Number(uid)) });
}
