import test from "node:test";
import assert from "node:assert/strict";
import {
  completeRestrictedArticleInteraction,
} from "../src/features/restricted-content/article-interaction-state.js";
import {
  createArticleInteractionStore,
} from "../src/features/restricted-content/article-interaction-store.js";
import {
  interpretArticleWrite,
} from "../src/features/restricted-content/article-write-observer.js";
import {
  createArticleInteractionTracker,
  prepareRestrictedArticleInteraction,
} from "../src/features/restricted-content/article-interaction-tracker.js";
import {
  createRestrictedReplyXhrAdapter,
} from "../src/features/restricted-content/reply-xhr-adapter.js";

const ORIGIN = "https://www.luogu.com.cn";
const LID = "abc";

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    keys: () => [...map.keys()],
    raw: (key) => map.get(key),
  };
}

function fixedClock(start = 1_800_000_000_000) {
  const clock = { ms: start };
  clock.now = () => clock.ms;
  return clock;
}

// 官方 article.show 互动条契约（columba 20260730-2078 chunk columba~0bd2df6a7ee2b996.js）：
//   收藏 I(favored) → POST article.favor，favored 为真时带 query {remove:1}；响应体不参与状态；
//        客户端自行做 favored=!favored、favorCount±1。
//   点赞 B(intent) → 先算 vote = (article.voted === intent ? 0 : intent)，
//        POST article.vote?vote=<vote>，再用响应体 {upvotes,voted} 覆盖 article.upvote/voted。
// 这两个映射决定“刷新后还能不能撤回”，所以在测试里显式复刻。
const officialFavorUrl = (favored) =>
  `/article/${LID}/favor${favored ? "?remove=1" : ""}`;
const officialVoteUrl = (articleVoted, intent) =>
  `/article/${LID}/vote?vote=${articleVoted === intent ? 0 : intent}`;

function seededTracker({ storage, clock, uid = 52918, current }) {
  const store = createArticleInteractionStore({
    storage,
    now: clock.now,
  });
  const tracker = createArticleInteractionTracker({
    store,
    origin: ORIGIN,
    lid: LID,
    uid,
  });
  tracker.seed(current);
  return { store, tracker };
}

test("a confirmed official vote outranks the stale Saver count", () => {
  const stale = completeRestrictedArticleInteraction({
    article: { lid: LID, upvote: 5, favorCount: 4 },
    archived: {},
    viewer: { uid: 52918 },
  });
  assert.equal(stale.article.upvote, 5);
  assert.equal(stale.article.voted, null);

  const confirmed = completeRestrictedArticleInteraction({
    article: { lid: LID, upvote: 5, favorCount: 4 },
    archived: {},
    viewer: { uid: 52918 },
    archivedAt: 1_000,
    confirmed: { upvote: 61, voted: 1, at: 2_000 },
  });
  assert.equal(confirmed.article.upvote, 61);
  assert.equal(confirmed.article.voted, 1);
  assert.equal(confirmed.voted, 1);
  // 保存站未确认的字段保持存档快照，不被伪造。
  assert.equal(confirmed.article.favorCount, 4);
  assert.equal(confirmed.favored, null);
});

test("a confirmed favourite survives a component remount", () => {
  const storage = memoryStorage();
  const clock = fixedClock();
  const { store, tracker } = seededTracker({
    storage,
    clock,
    current: { upvote: 5, favorCount: 4, voted: null, favored: null },
  });

  tracker.observeWrite({
    method: "POST",
    url: officialFavorUrl(null),
    status: 200,
    responseText: "{}",
  });

  // 重新引导页面（组件重挂载）时读取的确认状态。
  const restored = store.read({ uid: 52918, lid: LID });
  assert.equal(restored.favored, true);
  assert.equal(restored.favorCount, 5);

  const remounted = completeRestrictedArticleInteraction({
    article: { lid: LID, upvote: 5, favorCount: 4 },
    archived: {},
    viewer: { uid: 52918 },
    archivedAt: clock.ms - 60_000,
    confirmed: restored,
  });
  assert.equal(remounted.favored, true);
  assert.equal(remounted.article.favorCount, 5);
});

test("a page refresh restores state so the next click cancels through Luogu", () => {
  const storage = memoryStorage();
  const clock = fixedClock();
  const first = seededTracker({
    storage,
    clock,
    current: { upvote: 60, favorCount: 4, voted: null, favored: null },
  });

  first.tracker.observeWrite({
    method: "POST",
    url: officialVoteUrl(null, 1),
    status: 200,
    responseText: JSON.stringify({ upvotes: 61, voted: 1 }),
  });
  first.tracker.observeWrite({
    method: "POST",
    url: officialFavorUrl(null),
    status: 200,
    responseText: "{}",
  });

  // 整页刷新：新的 store 实例只能读回持久化记录。
  clock.ms += 3_600_000;
  const reloaded = createArticleInteractionStore({ storage, now: clock.now });
  const merged = completeRestrictedArticleInteraction({
    article: { lid: LID, upvote: 60, favorCount: 4 },
    archived: {},
    viewer: { uid: 52918 },
    archivedAt: clock.ms - 7_200_000,
    confirmed: reloaded.read({ uid: 52918, lid: LID }),
  });

  assert.equal(merged.favored, true);
  assert.equal(merged.voted, 1);
  assert.equal(merged.article.voted, 1);
  assert.equal(merged.article.upvote, 61);
  assert.equal(merged.article.favorCount, 5);
  // 官方组件据此发起撤回，而不是重复点赞或重复收藏。
  assert.equal(officialVoteUrl(merged.article.voted, 1), `/article/${LID}/vote?vote=0`);
  assert.equal(officialFavorUrl(merged.favored), `/article/${LID}/favor?remove=1`);
});

test("a failed official write leaves counts and the confirmed record untouched", () => {
  const storage = memoryStorage();
  const clock = fixedClock();
  const { store, tracker } = seededTracker({
    storage,
    clock,
    current: { upvote: 60, favorCount: 4, voted: null, favored: null },
  });

  assert.equal(
    tracker.observeWrite({
      method: "POST",
      url: officialVoteUrl(null, 1),
      status: 403,
      responseText: '{"errorMessage":"denied"}',
    }),
    null,
  );
  assert.equal(
    tracker.observeWrite({
      method: "POST",
      url: officialFavorUrl(null),
      status: 500,
      responseText: "",
    }),
    null,
  );

  assert.equal(store.read({ uid: 52918, lid: LID }), null);
  assert.deepEqual(tracker.snapshot(), {
    upvote: 60,
    favorCount: 4,
    voted: null,
    favored: null,
  });
});

test("confirmed state never leaks across accounts or to anonymous visitors", () => {
  const storage = memoryStorage();
  const clock = fixedClock();
  const { store, tracker } = seededTracker({
    storage,
    clock,
    current: { upvote: 60, favorCount: 4, voted: null, favored: null },
  });
  tracker.observeWrite({
    method: "POST",
    url: officialFavorUrl(null),
    status: 200,
    responseText: "{}",
  });

  assert.equal(store.read({ uid: 52918, lid: LID }).favored, true);
  assert.equal(store.read({ uid: 99999, lid: LID }), null);
  assert.equal(store.read({ uid: null, lid: LID }), null);
  assert.equal(store.read({ uid: 52918, lid: "other" }), null);

  // 匿名访客的写入不得落盘，也不得污染登录账号的记录。
  const anonymous = createArticleInteractionTracker({
    store,
    origin: ORIGIN,
    lid: LID,
    uid: null,
  });
  anonymous.seed({ upvote: 60, favorCount: 4, voted: null, favored: null });
  anonymous.observeWrite({
    method: "POST",
    url: officialVoteUrl(null, 1),
    status: 200,
    responseText: JSON.stringify({ upvotes: 61, voted: 1 }),
  });
  assert.equal(store.read({ uid: null, lid: LID }), null);
  assert.equal(store.read({ uid: 52918, lid: LID }).voted, null);
});

test("a newer Saver snapshot refreshes counts but never the personal state", () => {
  const confirmed = {
    voted: 1,
    favored: true,
    upvote: 61,
    favorCount: 5,
    at: 2_000,
  };

  const staleSaver = completeRestrictedArticleInteraction({
    article: { lid: LID, upvote: 12, favorCount: 3 },
    archived: {},
    viewer: { uid: 52918 },
    archivedAt: 1_000,
    confirmed,
  });
  assert.equal(staleSaver.article.upvote, 61);
  assert.equal(staleSaver.article.favorCount, 5);

  const fresherSaver = completeRestrictedArticleInteraction({
    article: { lid: LID, upvote: 88, favorCount: 9 },
    archived: {},
    viewer: { uid: 52918 },
    archivedAt: 3_000,
    confirmed,
  });
  assert.equal(fresherSaver.article.upvote, 88);
  assert.equal(fresherSaver.article.favorCount, 9);
  assert.equal(fresherSaver.voted, 1);
  assert.equal(fresherSaver.favored, true);
  assert.equal(fresherSaver.article.voted, 1);
});

test("the write observer reads Luogu's confirmed vote payload and cancel intents", () => {
  const current = { upvote: 60, favorCount: 4, voted: 1, favored: true };
  assert.deepEqual(
    interpretArticleWrite({
      origin: ORIGIN,
      lid: LID,
      method: "POST",
      url: `/article/${LID}/vote?vote=0`,
      status: 200,
      responseText: JSON.stringify({ upvotes: 60, voted: 0 }),
      current,
    }),
    { kind: "vote", voted: 0, upvote: 60 },
  );
  assert.deepEqual(
    interpretArticleWrite({
      origin: ORIGIN,
      lid: LID,
      method: "POST",
      url: `/article/${LID}/favor?remove=1`,
      status: 200,
      responseText: "",
      current,
    }),
    { kind: "favor", favored: false, favorCount: 3 },
  );
  // 响应体没有计数时按官方组件的本地 ±1 推导；-1 不能把计数推成负数。
  assert.deepEqual(
    interpretArticleWrite({
      origin: ORIGIN,
      lid: LID,
      method: "POST",
      url: `/article/${LID}/favor?remove=1`,
      status: 200,
      responseText: "",
      current: { upvote: 60, favorCount: 0, voted: 1, favored: true },
    }),
    { kind: "favor", favored: false, favorCount: 0 },
  );
  // 无关请求、读请求和其他文章一律不产生确认状态。
  for (const request of [
    { method: "GET", url: `/article/${LID}/favor` },
    { method: "POST", url: `/article/${LID}/reply` },
    { method: "POST", url: "/article/other/vote?vote=1" },
    { method: "POST", url: `https://evil.example/article/${LID}/vote?vote=1` },
  ])
    assert.equal(
      interpretArticleWrite({
        origin: ORIGIN,
        lid: LID,
        status: 200,
        responseText: "{}",
        current,
        ...request,
      }),
      null,
    );
});

test("the reply XHR adapter reports official writes without touching them", async () => {
  const observed = [];
  const sent = [];
  class FakeXhr {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.responseText = "";
      this.response = "";
      this.responseType = "";
      this.withCredentials = false;
      this.upload = {};
      this.headers = [];
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers.push([name, value]);
    }
    getAllResponseHeaders() {
      return "content-type: application/json\r\n";
    }
    getResponseHeader() {
      return "application/json";
    }
    send(body) {
      sent.push({
        method: this.method,
        url: this.url,
        body,
        headers: this.headers,
        withCredentials: this.withCredentials,
      });
      this.status = 200;
      this.readyState = 4;
      this.responseText = JSON.stringify({ upvotes: 61, voted: 1 });
      this.response = this.responseText;
      queueMicrotask(() => this.onloadend?.({ type: "loadend" }));
    }
    abort() {}
    addEventListener(type, listener) {
      this[`on${type}`] = listener;
    }
    removeEventListener(type, listener) {
      if (this[`on${type}`] === listener) this[`on${type}`] = null;
    }
  }

  const { XMLHttpRequest: AdaptedXhr } = createRestrictedReplyXhrAdapter({
    XMLHttpRequest: FakeXhr,
    URL,
    origin: ORIGIN,
    lid: LID,
    replies: [],
    onWrite: (event) => observed.push(event),
  });
  const xhr = new AdaptedXhr();
  xhr.open("POST", `/article/${LID}/vote?vote=1`);
  xhr.setRequestHeader("X-CSRF-TOKEN", "same-origin-token");
  const done = new Promise((resolve) => {
    xhr.onloadend = resolve;
  });
  xhr.send("{}");
  await done;

  assert.deepEqual(sent, [
    {
      method: "POST",
      url: `/article/${LID}/vote?vote=1`,
      body: "{}",
      headers: [["X-CSRF-TOKEN", "same-origin-token"]],
      withCredentials: false,
    },
  ]);
  assert.equal(observed.length, 1);
  assert.deepEqual(
    {
      method: observed[0].method,
      url: observed[0].url,
      status: observed[0].status,
      responseText: observed[0].responseText,
    },
    {
      method: "POST",
      url: `/article/${LID}/vote?vote=1`,
      status: 200,
      responseText: JSON.stringify({ upvotes: 61, voted: 1 }),
    },
  );
  // 写响应原样交还官方组件。
  assert.equal(xhr.status, 200);
  assert.equal(xhr.responseText, JSON.stringify({ upvotes: 61, voted: 1 }));
  assert.equal(xhr.getResponseHeader("x-luogusp-source"), "application/json");
});

test("boot preparation merges the stored record and seeds the tracker", () => {
  const clock = fixedClock();
  const storage = memoryStorage();
  const store = createArticleInteractionStore({ storage, now: clock.now });
  store.save({ uid: 52918, lid: LID, voted: 1, favored: true, upvote: 61, favorCount: 5 });

  const boot = {
    store,
    origin: ORIGIN,
    lid: LID,
    article: { lid: LID, upvote: 12, favorCount: 3 },
    archived: {},
    archivedAt: clock.ms - 60_000,
  };
  const signedIn = prepareRestrictedArticleInteraction({
    ...boot,
    viewer: { uid: 52918 },
  });
  assert.equal(signedIn.interaction.favored, true);
  assert.equal(signedIn.interaction.article.upvote, 61);
  assert.equal(signedIn.interaction.article.favorCount, 5);
  assert.deepEqual(signedIn.tracker.snapshot(), {
    upvote: 61,
    favorCount: 5,
    voted: 1,
    favored: true,
  });

  // 退出登录/换账号：读不到上一个账号的确认状态，计数回落到保存站快照。
  for (const viewer of [null, { uid: 99999 }]) {
    const other = prepareRestrictedArticleInteraction({ ...boot, viewer });
    assert.equal(other.interaction.favored, null);
    assert.equal(other.interaction.voted, null);
    assert.equal(other.interaction.article.upvote, 12);
    assert.equal(other.interaction.article.favorCount, 3);
  }
});

test("the 不推荐 downvote confirms, persists and cancels like the upvote", () => {
  const storage = memoryStorage();
  const clock = fixedClock();
  const { store, tracker } = seededTracker({
    storage,
    clock,
    current: { upvote: 19, favorCount: 17, voted: null, favored: null },
  });

  // 官方：B(-1) → vote = (voted === -1 ? 0 : -1)。首次点击发 -1。
  assert.equal(officialVoteUrl(null, -1), `/article/${LID}/vote?vote=-1`);
  tracker.observeWrite({
    method: "POST",
    url: officialVoteUrl(null, -1),
    status: 200,
    responseText: JSON.stringify({ upvotes: 18, voted: -1 }),
  });

  const record = store.read({ uid: 52918, lid: LID });
  assert.equal(record.voted, -1);
  assert.equal(record.upvote, 18);

  const merged = completeRestrictedArticleInteraction({
    article: { lid: LID, upvote: 19, favorCount: 17 },
    archived: {},
    viewer: { uid: 52918 },
    archivedAt: clock.ms - 60_000,
    confirmed: record,
  });
  // 官方按 -1 === article.voted 点亮「不推荐」，按 1 === article.voted 点亮「点赞」。
  assert.equal(merged.article.voted, -1);
  assert.equal(merged.voted, -1);
  assert.equal(merged.article.upvote, 18);
  // 刷新后再点「不推荐」必须走撤回，而不是重复投一次 -1。
  assert.equal(
    officialVoteUrl(merged.article.voted, -1),
    `/article/${LID}/vote?vote=0`,
  );
  // 而此时点「点赞」应当直接切换成 1，不是撤回。
  assert.equal(
    officialVoteUrl(merged.article.voted, 1),
    `/article/${LID}/vote?vote=1`,
  );

  tracker.observeWrite({
    method: "POST",
    url: officialVoteUrl(-1, -1),
    status: 200,
    responseText: JSON.stringify({ upvotes: 19, voted: 0 }),
  });
  assert.equal(store.read({ uid: 52918, lid: LID }).voted, 0);
});

test("a vote-only confirmation never fabricates a zero favourite count", () => {
  const storage = memoryStorage();
  const clock = fixedClock();
  const { store, tracker } = seededTracker({
    storage,
    clock,
    current: { upvote: 19, favorCount: 17, voted: null, favored: null },
  });
  tracker.observeWrite({
    method: "POST",
    url: officialVoteUrl(null, 1),
    status: 200,
    responseText: JSON.stringify({ upvotes: 25, voted: 1 }),
  });

  // ★ Number(null) === 0：未确认的计数一旦被规范化成 0，就会反过来盖掉保存站的真实值。
  const record = store.read({ uid: 52918, lid: LID });
  assert.equal(record.upvote, 25);
  assert.equal(record.favorCount, null);
  assert.equal(record.favored, null);

  const merged = completeRestrictedArticleInteraction({
    article: { lid: LID, upvote: 19, favorCount: 17 },
    archived: {},
    viewer: { uid: 52918 },
    archivedAt: clock.ms - 60_000,
    confirmed: record,
  });
  assert.equal(merged.article.upvote, 25);
  assert.equal(merged.article.favorCount, 17);
  assert.equal(merged.voted, 1);
  assert.equal(merged.favored, null);

  // 反向同理：只确认过收藏时，点赞数必须留给保存站快照。
  const favorOnly = seededTracker({
    storage: memoryStorage(),
    clock,
    current: { upvote: 19, favorCount: 17, voted: null, favored: null },
  });
  favorOnly.tracker.observeWrite({
    method: "POST",
    url: officialFavorUrl(null),
    status: 200,
    responseText: "{}",
  });
  const favorRecord = favorOnly.store.read({ uid: 52918, lid: LID });
  assert.equal(favorRecord.favorCount, 18);
  assert.equal(favorRecord.upvote, null);
  assert.equal(favorRecord.voted, null);
});

test("a confirmed write that cannot be persisted reports instead of failing silently", () => {
  const reports = [];
  const clock = fixedClock();

  // 拿不到当前账号：官方写成功了，但状态无处可存 —— 刷新后必然撤不回，必须报出来。
  const anonymous = createArticleInteractionTracker({
    store: createArticleInteractionStore({ storage: memoryStorage(), now: clock.now }),
    origin: ORIGIN,
    lid: LID,
    uid: null,
    onPersistFailure: (detail) => reports.push(detail),
  });
  anonymous.seed({ upvote: 60, favorCount: 4, voted: null, favored: null });
  anonymous.observeWrite({
    method: "POST",
    url: officialFavorUrl(null),
    status: 200,
    responseText: "{}",
  });
  assert.deepEqual(reports, [{ lid: LID, reason: "no-account" }]);

  // 存储不可用（隐私模式、配额、被宿主环境挡住）同样必须报出来。
  const blocked = createArticleInteractionTracker({
    store: createArticleInteractionStore({ storage: null }),
    origin: ORIGIN,
    lid: LID,
    uid: 52918,
    onPersistFailure: (detail) => reports.push(detail),
  });
  blocked.seed({ upvote: 60, favorCount: 4, voted: null, favored: null });
  blocked.observeWrite({
    method: "POST",
    url: officialVoteUrl(null, 1),
    status: 200,
    responseText: JSON.stringify({ upvotes: 61, voted: 1 }),
  });
  assert.deepEqual(reports[1], { lid: LID, reason: "storage-unavailable" });

  // 成功落盘时不得产生噪音。
  const working = createArticleInteractionTracker({
    store: createArticleInteractionStore({ storage: memoryStorage(), now: clock.now }),
    origin: ORIGIN,
    lid: LID,
    uid: 52918,
    onPersistFailure: (detail) => reports.push(detail),
  });
  working.seed({ upvote: 60, favorCount: 4, voted: null, favored: null });
  working.observeWrite({
    method: "POST",
    url: officialFavorUrl(null),
    status: 200,
    responseText: "{}",
  });
  assert.equal(reports.length, 2);
});

test("the interaction store expires, caps and survives corrupt payloads", () => {
  const clock = fixedClock();
  const storage = memoryStorage();
  const store = createArticleInteractionStore({
    storage,
    now: clock.now,
    ttlMs: 1_000,
    maxEntries: 2,
  });

  store.save({ uid: 7, lid: "aaa", favored: true });
  clock.ms += 400;
  store.save({ uid: 7, lid: "bbb", favored: true });
  clock.ms += 400;
  store.save({ uid: 7, lid: "ccc", favored: true });
  assert.equal(store.read({ uid: 7, lid: "aaa" }), null);
  assert.equal(store.read({ uid: 7, lid: "bbb" }).favored, true);
  assert.equal(store.read({ uid: 7, lid: "ccc" }).favored, true);

  clock.ms += 1_001;
  assert.equal(store.read({ uid: 7, lid: "ccc" }), null);

  const broken = memoryStorage({ "luogusp.article-interaction.v2": "{oops" });
  const recovered = createArticleInteractionStore({
    storage: broken,
    now: clock.now,
  });
  assert.equal(recovered.read({ uid: 7, lid: "ccc" }), null);
  assert.equal(recovered.save({ uid: 7, lid: "ccc", favored: true }).favored, true);
  assert.equal(recovered.read({ uid: 7, lid: "ccc" }).favored, true);

  // 没有可用存储时降级为纯内存，不抛错。
  const ephemeral = createArticleInteractionStore({ storage: null });
  assert.equal(ephemeral.save({ uid: 7, lid: "ccc", favored: true }), null);
  assert.equal(ephemeral.read({ uid: 7, lid: "ccc" }), null);
});
