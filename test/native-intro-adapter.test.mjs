import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createNativeIntroAdapter } from "../src/features/hidden-intro/native-intro-adapter.js";

function chain(links, key) {
  for (let index = 0; index < links.length - 1; index++)
    links[index][key] = links[index + 1];
  return links[0] || null;
}

function computed(value, fn, dependencies = []) {
  const result = {
    __v_isRef: true,
    __v_isReadonly: true,
    _value: value,
    fn,
    dep: { subs: null, trigger: () => {} },
  };
  Object.defineProperty(result, "value", {
    get: () => result._value,
  });
  result.deps = chain(dependencies, "nextDep");
  return result;
}

function createFixture({
  componentRoot = "element",
  componentSource = "vnode",
  deepVnodeDepth = 0,
  delayedAppMs = 0,
  delayedComponentMs = 0,
  duplicateCandidate = false,
  initiallyVisible = false,
  mutateIdentity = false,
  namedComponent = true,
  nestedUserDependency = false,
  render = true,
  suspenseRoot = false,
  timeoutMs = 5,
} = {}) {
  const dom = new JSDOM('<div id="app"></div>');
  const { document, MutationObserver } = dom.window;
  const user = {
    uid: 2,
    isAdmin: false,
    introduction: "![profile](https://example.test/profile.png)",
  };
  const userComputed = computed(user, () => user);
  const currentUser = computed(null, () => null);
  let targetComponent = null;
  const ownPage = computed(false, () => false, [
    { dep: { computed: userComputed }, version: 1 },
    { dep: { key: "uid" }, version: 1 },
    { dep: { computed: currentUser }, version: 1 },
  ]);
  const renderEffect = { fn: () => {}, scheduler: () => {} };
  const renderCard = (visible) => {
    document
      .querySelectorAll(".native-intro-card")
      .forEach((node) => node.remove());
    if (!visible || !render) return;
    const card = document.createElement("div");
    card.className = "l-card native-intro-card";
    card.innerHTML =
      '<div class="introduction"><div class="lfe-marked">native</div></div>';
    if (targetComponent) card.__vueParentComponent = targetComponent;
    document.body.append(card);
  };
  const displayGate = computed(initiallyVisible, () => initiallyVisible, [
    { dep: { computed: ownPage }, version: 1 },
    { dep: { computed: userComputed }, version: 1 },
    { dep: { key: "isAdmin" }, version: 0 },
  ]);
  displayGate.dep.subs = { sub: renderEffect };
  displayGate.dep.trigger = () => {
    if (mutateIdentity) user.isAdmin = true;
    renderCard(displayGate._value);
  };
  const subscriptions = [{ sub: displayGate }];
  if (duplicateCandidate) {
    const secondGate = computed(false, () => false, [
      { dep: { computed: ownPage }, version: 1 },
      { dep: { computed: userComputed }, version: 1 },
      { dep: { key: "isAdmin" }, version: 0 },
    ]);
    secondGate.dep.subs = { sub: renderEffect };
    secondGate.dep.trigger = () => renderCard(secondGate._value);
    subscriptions.push({ sub: secondGate });
  }
  userComputed.dep.subs = chain(subscriptions, "prevSub");
  const introText = computed(
    user.introduction,
    () => user.introduction,
    [{ dep: { computed: userComputed }, version: 1 }],
  );
  const sourceEffect = {
    deps: {
      dep: {
        computed: nestedUserDependency ? introText : userComputed,
      },
    },
  };
  targetComponent = {
    type: namedComponent ? { name: "UserShowMain" } : {},
    scope: { effects: [sourceEffect] },
    isUnmounted: false,
  };
  renderCard(initiallyVisible);
  let targetVNode = { component: targetComponent };
  for (let depth = 0; depth < deepVnodeDepth; depth++)
    targetVNode = { children: [targetVNode] };
  if (suspenseRoot)
    targetVNode = {
      ssContent: targetVNode,
      ssFallback: { children: [] },
      suspense: { activeBranch: targetVNode },
    };
  const rootComponent = {
    type: { name: "RootMain" },
    subTree: {
      children: delayedComponentMs > 0 ? [] : [targetVNode],
    },
  };
  if (delayedComponentMs > 0)
    setTimeout(() => {
      rootComponent.subTree = { children: [targetVNode] };
    }, delayedComponentMs);
  const app = document.querySelector("#app");
  const vueApp = {
    version: "3.5.35",
    ...(componentRoot === "container"
      ? { _container: { _vnode: { component: rootComponent } } }
      : {}),
  };
  if (delayedAppMs > 0)
    setTimeout(() => {
      app.__vue_app__ = vueApp;
    }, delayedAppMs);
  else app.__vue_app__ = vueApp;
  if (componentRoot === "element")
    app._vnode = { component: rootComponent };
  if (componentSource === "dom") {
    delete app._vnode;
    const anchor = document.createElement("section");
    anchor.__vueParentComponent = targetComponent;
    app.append(anchor);
  }
  return {
    document,
    MutationObserver,
    user,
    displayGate,
    adapter: createNativeIntroAdapter({
      document,
      MutationObserver,
      timeoutMs,
      logDiagnostic: () => {},
    }),
  };
}

test("native intro adapter attaches one official card and restores its computed gate", async () => {
  const fixture = createFixture();
  const originalFn = fixture.displayGate.fn;

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.equal(result.status, "native-attached");
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    1,
  );
  assert.deepEqual(fixture.user, {
    uid: 2,
    isAdmin: false,
    introduction: "![profile](https://example.test/profile.png)",
  });
  assert.equal(result.restore(), true);
  assert.equal(fixture.displayGate.fn, originalFn);
  assert.equal(fixture.displayGate._value, false);
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    0,
  );
});

test("native intro adapter recognizes a visible card owned by the current user", async () => {
  const fixture = createFixture({ initiallyVisible: true });

  assert.equal(fixture.adapter.isVisibleForUser({ uid: "2" }), true);
  assert.equal(fixture.adapter.isVisibleForUser({ uid: "3" }), false);

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.deepEqual(result, { status: "already-native" });
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    1,
  );
  assert.equal(fixture.displayGate._value, true);
});

test("native intro adapter waits for a stale card before attaching the target user", async () => {
  const fixture = createFixture({ timeoutMs: 50 });
  const stale = fixture.document.createElement("div");
  stale.className = "l-card native-intro-card";
  stale.innerHTML =
    '<div class="introduction"><div class="lfe-marked">stale</div></div>';
  fixture.document.body.append(stale);
  setTimeout(() => stale.remove(), 5);

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.equal(result.status, "native-attached");
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    1,
  );
  assert.equal(
    fixture.document.querySelector(".native-intro-card .lfe-marked")
      ?.textContent,
    "native",
  );
  assert.equal(result.restore(), true);
});

test("native intro adapter discovers the official component from the Vue app container", async () => {
  const fixture = createFixture({ componentRoot: "container" });

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.equal(result.status, "native-attached");
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    1,
  );
  assert.equal(result.restore(), true);
});

test("native intro adapter rejects an anonymous structural candidate", async () => {
  const fixture = createFixture({ namedComponent: false });

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.deepEqual(result, {
    status: "native-unsupported",
    reason: "user-show-main-count:0/2/scans:1",
  });
});

test("native intro adapter discovers the official component from DOM parent instances", async () => {
  const fixture = createFixture({ componentSource: "dom" });

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.equal(result.status, "native-attached");
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    1,
  );
  assert.equal(result.restore(), true);
});

test("native intro adapter traverses deep and Suspense-backed Vue branches", async () => {
  const fixture = createFixture({
    deepVnodeDepth: 60,
    suspenseRoot: true,
  });

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.equal(result.status, "native-attached");
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    1,
  );
  assert.equal(result.restore(), true);
});

test("native intro adapter waits for Vue and follows production nested computed dependencies", async () => {
  const fixture = createFixture({
    delayedAppMs: 5,
    nestedUserDependency: true,
    timeoutMs: 50,
  });

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.equal(result.status, "native-attached");
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    1,
  );
  assert.equal(result.restore(), true);
});

test("native intro adapter waits for the asynchronously mounted production route component", async () => {
  const fixture = createFixture({
    delayedComponentMs: 5,
    timeoutMs: 50,
  });

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.equal(result.status, "native-attached");
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    1,
  );
  assert.equal(result.restore(), true);
});

test("native intro adapter fails closed when the Vue app never becomes ready", async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const adapter = createNativeIntroAdapter({
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    timeoutMs: 5,
    logDiagnostic: () => {},
  });

  const result = await adapter.attach({
    uid: "2",
    introduction: "hidden",
  });

  assert.deepEqual(result, {
    status: "native-unsupported",
    reason: "vue-app-timeout",
  });
});

test("native intro adapter fails closed for ambiguous candidates", async () => {
  const fixture = createFixture({ duplicateCandidate: true });

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.deepEqual(result, {
    status: "native-unsupported",
    reason: "candidate-count",
  });
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    0,
  );
  assert.equal(fixture.displayGate._value, false);
});

test("native intro adapter restores before rejecting an identity mutation", async () => {
  const fixture = createFixture({ mutateIdentity: true });

  const result = await fixture.adapter.attach({
    uid: "2",
    introduction: fixture.user.introduction,
  });

  assert.deepEqual(result, {
    status: "native-unsupported",
    reason: "identity-mutated",
  });
  assert.equal(fixture.displayGate._value, false);
  assert.equal(
    fixture.document.querySelectorAll(".native-intro-card").length,
    0,
  );
});
