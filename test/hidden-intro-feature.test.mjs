import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createHiddenIntroFeature } from "../src/features/hidden-intro/feature.js";
import {
  createFallbackIntroController,
} from "../src/features/hidden-intro/fallback-intro-controller.js";

function installDom(url = "https://www.luogu.com.cn/user/2") {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div class="sidebar-container"><div class="main"></div></div></body></html>',
    { pretendToBeVisual: true, url },
  );
  const names = [
    "window",
    "document",
    "location",
    "history",
    "MutationObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "AbortController",
  ];
  const previous = new Map(
    names.map((name) => [name, globalThis[name]]),
  );
  for (const name of names) globalThis[name] = dom.window[name];
  return () => {
    dom.window.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

function createFallbackStub() {
  return Object.freeze({
    getIntroduction: async (uid) => `intro-${uid}`,
    mount({ column }) {
      const card = document.createElement("div");
      card.className = "luogusp-intro-card";
      column.append(card);
      return Object.freeze({
        card,
        ready: Promise.resolve({ status: "fallback-rendered" }),
      });
    },
    removeCards: () =>
      document
        .querySelectorAll(".luogusp-intro-card")
        .forEach((card) => card.remove()),
    hasCard: () => !!document.querySelector(".luogusp-intro-card"),
  });
}

function createNativeAdapter(log) {
  return Object.freeze({
    async attach({ uid }) {
      log.attached.push(String(uid));
      const card = document.createElement("div");
      card.className = "l-card native-intro-card";
      card.dataset.uid = String(uid);
      card.innerHTML =
        '<div class="introduction"><div class="lfe-marked">native</div></div>';
      document.body.append(card);
      let active = true;
      return Object.freeze({
        status: "native-attached",
        restore() {
          if (!active) return true;
          active = false;
          log.restored.push(String(uid));
          card.remove();
          return true;
        },
      });
    },
  });
}

function mountFeature(nativeAdapter) {
  const storage = Object.freeze({
    get: () => true,
    set: () => {},
    has: () => true,
  });
  const feature = createHiddenIntroFeature({
    storage,
    nativeIntroAdapter: nativeAdapter,
    fallbackIntroController: createFallbackStub(),
  });
  return {
    feature,
    dispose: feature.mount({ isCurrent: () => true }),
  };
}

test("hidden intro restores the native gate when leaving the user page", async () => {
  const restoreDom = installDom();
  try {
    const log = { attached: [], restored: [] };
    const mounted = mountFeature(createNativeAdapter(log));
    await waitFor(
      () => log.attached.length === 1,
      "native adapter did not attach",
    );

    history.pushState({}, "", "/activity");
    document.body.append(document.createElement("span"));
    await waitFor(
      () => log.restored.length === 1,
      "native adapter did not restore on route leave",
    );

    assert.deepEqual(log, { attached: ["2"], restored: ["2"] });
    assert.equal(document.querySelector(".native-intro-card"), null);
    assert.equal(document.querySelector(".luogusp-intro-card"), null);
    mounted.dispose();
  } finally {
    restoreDom();
  }
});

test("hidden intro restores before attaching after an SPA user switch", async () => {
  const restoreDom = installDom();
  try {
    const log = { attached: [], restored: [] };
    const mounted = mountFeature(createNativeAdapter(log));
    await waitFor(() => log.attached.length === 1, "user 2 not attached");

    history.pushState({}, "", "/user/3");
    document.body.append(document.createElement("span"));
    await waitFor(() => log.attached.length === 2, "user 3 not attached");

    assert.deepEqual(log.attached, ["2", "3"]);
    assert.deepEqual(log.restored, ["2"]);
    assert.equal(
      document.querySelector(".native-intro-card")?.dataset.uid,
      "3",
    );
    assert.equal(document.querySelector(".luogusp-intro-card"), null);
    mounted.dispose();
  } finally {
    restoreDom();
  }
});

test("hidden intro feature dispose restores native state and removes owned cards", async () => {
  const restoreDom = installDom();
  try {
    const log = { attached: [], restored: [] };
    const mounted = mountFeature(createNativeAdapter(log));
    await waitFor(() => log.attached.length === 1, "native not attached");
    const manual = document.createElement("div");
    manual.className = "luogusp-intro-card";
    document.body.append(manual);

    mounted.dispose();

    assert.deepEqual(log.restored, ["2"]);
    assert.equal(document.querySelector(".native-intro-card"), null);
    assert.equal(document.querySelector(".luogusp-intro-card"), null);
  } finally {
    restoreDom();
  }
});

test("an unsupported native anchor enters one on-demand fallback render", async () => {
  const restoreDom = installDom();
  try {
    const state = document.createElement("script");
    state.textContent = JSON.stringify({
      user: { uid: 2, introduction: "**fallback**" },
    });
    document.body.append(state);
    let renders = 0;
    const fallback = createFallbackIntroController({
      document,
      fetchImpl: async () => {
        throw new Error("SSR state should satisfy the request");
      },
      rendererClient: {
        async renderInto(root) {
          renders++;
          root.innerHTML = "<p><strong>fallback</strong></p>";
          return { mode: "full", warnings: [] };
        },
      },
      makeCopyButtonImpl: () => document.createElement("button"),
    });
    const storage = Object.freeze({
      get: () => true,
      set: () => {},
      has: () => true,
    });
    const feature = createHiddenIntroFeature({
      storage,
      nativeIntroAdapter: {
        attach: async () => ({
          status: "native-unsupported",
          reason: "candidate-count",
        }),
      },
      fallbackIntroController: fallback,
    });
    const dispose = feature.mount({ isCurrent: () => true });
    await waitFor(
      () => !!document.querySelector(".luogusp-intro-card"),
      "fallback did not render",
    );
    for (let index = 0; index < 3; index++)
      document.body.append(document.createElement("span"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(renders, 1);
    assert.equal(
      document.querySelectorAll(".luogusp-intro-card").length,
      1,
    );
    dispose();
  } finally {
    restoreDom();
  }
});

test("an already visible native introduction is not duplicated or fetched", async () => {
  const restoreDom = installDom("https://www.luogu.com.cn/user/3");
  try {
    const native = document.createElement("div");
    native.className = "introduction";
    native.innerHTML = '<div class="lfe-marked">existing</div>';
    document.body.append(native);
    let fetched = 0;
    let attached = 0;
    const storage = Object.freeze({
      get: () => true,
      set: () => {},
      has: () => true,
    });
    const feature = createHiddenIntroFeature({
      storage,
      nativeIntroAdapter: {
        isVisibleForUser: () => false,
        attach: async () => {
          attached++;
          return { status: "native-attached" };
        },
      },
      fallbackIntroController: {
        getIntroduction: async () => {
          fetched++;
          return "unexpected";
        },
        mount: () => {
          throw new Error("fallback must not mount");
        },
        removeCards: () => {},
        hasCard: () => false,
      },
    });
    const dispose = feature.mount({ isCurrent: () => true });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(feature.getDiagnostics(), {
      status: "already-native",
      reason: null,
    });
    assert.equal(fetched, 0);
    assert.equal(attached, 0);
    assert.equal(document.querySelectorAll(".introduction").length, 1);
    dispose();
  } finally {
    restoreDom();
  }
});

test("a native introduction appearing during first paint wins over an in-flight adapter", async () => {
  const restoreDom = installDom("https://www.luogu.com.cn/user/3");
  try {
    let attached = 0;
    let fallbackMounted = 0;
    const storage = Object.freeze({
      get: () => true,
      set: () => {},
      has: () => true,
    });
    const feature = createHiddenIntroFeature({
      storage,
      nativeIntroAdapter: {
        isVisibleForUser: () => false,
        attach: async () => {
          attached++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            status: "native-unsupported",
            reason: "candidate-count",
          };
        },
      },
      fallbackIntroController: {
        ...createFallbackStub(),
        mount: () => {
          fallbackMounted++;
          throw new Error("fallback must not mount");
        },
      },
    });
    const dispose = feature.mount({ isCurrent: () => true });

    setTimeout(() => {
      const native = document.createElement("div");
      native.className = "introduction";
      native.innerHTML =
        '<div class="lfe-marked">first paint</div>';
      document.body.append(native);
    }, 5);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(feature.getDiagnostics(), {
      status: "already-native",
      reason: null,
    });
    assert.equal(attached, 1);
    assert.equal(fallbackMounted, 0);
    assert.equal(document.querySelectorAll(".introduction").length, 1);
    dispose();
  } finally {
    restoreDom();
  }
});

test("a stale native introduction disappearing during route settlement retries the current user", async () => {
  const restoreDom = installDom("https://www.luogu.com.cn/user/3");
  try {
    const stale = document.createElement("div");
    stale.className = "introduction";
    stale.innerHTML = '<div class="lfe-marked">previous user</div>';
    document.body.append(stale);
    let fetched = 0;
    const storage = Object.freeze({
      get: () => true,
      set: () => {},
      has: () => true,
    });
    const fallback = createFallbackStub();
    const feature = createHiddenIntroFeature({
      storage,
      nativeIntroAdapter: {
        isVisibleForUser: () => false,
        attach: async () => ({
          status: "native-unsupported",
          reason: "qa-forced-fallback",
        }),
      },
      fallbackIntroController: {
        ...fallback,
        getIntroduction: async (uid) => {
          fetched++;
          return `intro-${uid}`;
        },
      },
    });
    const dispose = feature.mount({ isCurrent: () => true });

    history.pushState({}, "", "/user/2");
    document.body.append(document.createElement("span"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    stale.remove();
    document.body.append(document.createElement("span"));
    await waitFor(
      () => !!document.querySelector(".luogusp-intro-card"),
      "current user was not retried after stale native intro disappeared",
    );

    assert.equal(fetched, 1);
    dispose();
  } finally {
    restoreDom();
  }
});

test("a remounted feature keeps same-document route history", async () => {
  const restoreDom = installDom("https://www.luogu.com.cn/user/3");
  try {
    const stale = document.createElement("div");
    stale.className = "introduction";
    stale.innerHTML = '<div class="lfe-marked">previous user</div>';
    document.body.append(stale);
    let fetched = 0;
    const storage = Object.freeze({
      get: () => true,
      set: () => {},
      has: () => true,
    });
    const fallback = createFallbackStub();
    const feature = createHiddenIntroFeature({
      storage,
      nativeIntroAdapter: {
        isVisibleForUser: () => false,
        attach: async () => ({
          status: "native-unsupported",
          reason: "qa-forced-fallback",
        }),
      },
      fallbackIntroController: {
        ...fallback,
        getIntroduction: async (uid) => {
          fetched++;
          return `intro-${uid}`;
        },
      },
    });
    const firstDispose = feature.mount({ isCurrent: () => true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    firstDispose();

    history.pushState({}, "", "/user/2");
    const secondDispose = feature.mount({ isCurrent: () => true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    stale.remove();
    document.body.append(document.createElement("span"));
    await waitFor(
      () => !!document.querySelector(".luogusp-intro-card"),
      "remounted feature trusted a stale card from the prior route",
    );

    assert.equal(fetched, 1);
    secondDispose();
  } finally {
    restoreDom();
  }
});

test("a confirmed native introduction can enter edit mode without fallback", async () => {
  const restoreDom = installDom("https://www.luogu.com.cn/user/3");
  try {
    const native = document.createElement("div");
    native.className = "introduction";
    native.innerHTML = '<div class="lfe-marked">current user</div>';
    document.body.append(native);
    let fetched = 0;
    const storage = Object.freeze({
      get: () => true,
      set: () => {},
      has: () => true,
    });
    const feature = createHiddenIntroFeature({
      storage,
      nativeIntroAdapter: {
        isVisibleForUser: () => true,
        attach: async () => ({ status: "native-attached" }),
      },
      fallbackIntroController: {
        ...createFallbackStub(),
        getIntroduction: async () => {
          fetched++;
          return "unexpected";
        },
      },
    });
    const dispose = feature.mount({ isCurrent: () => true });
    await new Promise((resolve) => setTimeout(resolve, 20));

    native.remove();
    document.body.append(document.createElement("span"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(fetched, 0);
    assert.equal(document.querySelector(".luogusp-intro-card"), null);
    dispose();
  } finally {
    restoreDom();
  }
});
