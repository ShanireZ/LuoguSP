// 關注 / 取消關注。契約 2026-08-13 在 owner 授權下實測抓取（對 owner 自己的另一個帳號
// 關注→取消，狀態已複核還原）：
//
//   POST /api/user/updateRelationShip      ← 注意 Ship 的 S 大寫；同源，無 query
//   Content-Type: application/json
//   X-CSRF-TOKEN: <meta[name=csrf-token]>
//   X-Requested-With: XMLHttpRequest
//   {"uid": 116524, "relationship": 1}     ← 1 = 關注，0 = 取消
//   → 200 {"_empty":true}
//
// ★★ 回應體**不回傳新狀態**（就是個 `{"_empty":true}`）。這與 `article.favor` 完全同款：
//    用戶端先套用關係與粉絲數，請求失敗時復原。

export const FOLLOW_ENDPOINT = "/api/user/updateRelationShip";
// ★★ 枚舉來自 `GET /_lfe/config` 的 `UserRelationship`（2026-08-14 實測）：
//    [{Unrelated,0},{Following,1},{Blacklisted,2}]。上一輪「洛谷沒有枚舉字典端點」作廢。
export const RELATIONSHIP_UNRELATED = 0;
export const RELATIONSHIP_FOLLOWING = 1;
export const RELATIONSHIP_BLACKLISTED = 2;

// 同一個端點同時管關注與拉黑，區別只在 relationship 的取值。
export function buildRelationRequest(config) {
  const { uid, relationship, csrfToken } = config || {};
  const target = Number(uid);
  if (!Number.isSafeInteger(target) || target <= 0) return null;
  if (
    relationship !== RELATIONSHIP_UNRELATED &&
    relationship !== RELATIONSHIP_FOLLOWING &&
    relationship !== RELATIONSHIP_BLACKLISTED
  )
    return null;
  if (typeof csrfToken !== "string" || !csrfToken) return null;
  return Object.freeze({
    url: FOLLOW_ENDPOINT,
    method: "POST",
    headers: Object.freeze({
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      "x-requested-with": "XMLHttpRequest",
    }),
    body: JSON.stringify({ uid: target, relationship }),
  });
}

// 屏蔽 / 取消屏蔽。★ 原生的兩條硬規則，照抄：
//   1. **正在關注的人不能拉黑**（洛谷自己會拒，並提示「你無法拉黑正在關注的人」）；
//   2. 動作前必須確認 —— 這是替使用者對第三方做的、有社交後果的寫入。
// 未知關係一律不許操作。
export function planBlockToggle(state) {
  const relation = state && state.relation;
  if (relation !== "unrelated" && relation !== "blacklisted") return null;
  const block = relation === "unrelated";
  return Object.freeze({
    block,
    relationship: block ? RELATIONSHIP_BLACKLISTED : RELATIONSHIP_UNRELATED,
    optimistic: Object.freeze({ relation: block ? "blacklisted" : "unrelated" }),
    rollback: Object.freeze({ relation }),
  });
}

// 樂觀切換：立刻回一個「先按成功算」的狀態，同時給出精確的回復狀態。
// 洛谷未知的關係值不允許操作 —— 猜錯方向會替使用者做錯事。拉黑狀態下也不許改關注。
export function planFollowToggle(state) {
  const relation = state && state.relation;
  if (relation !== "following" && relation !== "unrelated") return null;
  const follow = relation === "unrelated";
  const before = state.followerCount;
  const knownCount = Number.isFinite(before);
  return Object.freeze({
    follow,
    optimistic: Object.freeze({
      relation: follow ? "following" : "unrelated",
      ...(knownCount ? { followerCount: Math.max(0, before + (follow ? 1 : -1)) } : {}),
    }),
    rollback: Object.freeze({ relation, ...(knownCount ? { followerCount: before } : {}) }),
  });
}

async function confirmedRelationResponse(response, expectedUrl) {
  if (response?.ok !== true || response.status !== 200 || response.redirected !== false || response.url !== expectedUrl ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")?.trim())) return false;
  const data = await response.json();
  return data?._empty === true && Object.keys(data).length === 1 && Object.hasOwn(data, "_empty");
}

export function createFollowAction(config) {
  const {
    origin,
    request,
    csrfToken,
    onState,
  } = config || {};

  // 同一帳號對同一個使用者的寫入不可競速。
  const inFlight = new Set();
  const keyFor = (viewer, uid) => `${viewer}:${uid}`;

  const send = async (viewer, state, plan, relationship, label) => {
    const uid = Number(state.uid);
    const key = keyFor(viewer, uid);
    if (!Number.isSafeInteger(viewer) || viewer <= 0 || viewer === uid || inFlight.has(key))
      return null;
    const payload = buildRelationRequest({
      uid,
      relationship,
      csrfToken: typeof csrfToken === "function" ? csrfToken() : csrfToken,
    });
    // 拿不到 CSRF 就別發 —— 發出去只會被洛谷拒絕，還白改一次介面。
    if (!payload) return null;
    inFlight.add(key);
    let confirmed = false;
    try {
      if (typeof onState === "function") onState(viewer, uid, plan.optimistic, "pending");
      const expectedUrl = new URL(payload.url, origin).href;
      confirmed = await confirmedRelationResponse(await request(payload), expectedUrl);
    } catch {
      // Redirects, network failures and malformed JSON all leave the write unconfirmed.
    } finally {
      inFlight.delete(key);
    }
    if (typeof onState === "function") {
      if (confirmed) onState(viewer, uid, plan.optimistic, "confirmed");
      else onState(viewer, uid, plan.rollback, "failed", `${label}未获确认，已恢复原状态。`);
    }
    return confirmed ? plan.optimistic : null;
  };

  const toggle = async (viewer, state) => {
    const plan = planFollowToggle(state);
    if (!plan) return null;
    return send(
      viewer,
      state,
      plan,
      plan.follow ? RELATIONSHIP_FOLLOWING : RELATIONSHIP_UNRELATED,
      plan.follow ? "关注" : "取消关注",
    );
  };

  // ★★ 屏蔽是替使用者對**第三方**做的社交動作，必須先讓他點頭 —— 但**確認在視圖層做**
  //    （卡內就地確認，owner 2026-08-14 拍板），這裡拿到呼叫就直接發。
  //    結構守衛盯著「視圖層必須先問一句」，見 test/hover-card-render.test.mjs。
  const block = async (viewer, state) => {
    const plan = planBlockToggle(state);
    if (!plan) return null;
    return send(viewer, state, plan, plan.relationship, plan.block ? "屏蔽" : "取消屏蔽");
  };

  return Object.freeze({
    toggle,
    block,
    isBusy: (viewer, uid) => inFlight.has(keyFor(viewer, uid)),
  });
}
