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
  duplicateCandidate = false,
  mutateIdentity = false,
  render = true,
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
    document.body.append(card);
  };
  const displayGate = computed(false, () => false, [
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
  const sourceEffect = {
    deps: { dep: { computed: userComputed } },
  };
  const targetComponent = {
    type: { name: "UserShowMain" },
    scope: { effects: [sourceEffect] },
    isUnmounted: false,
  };
  const rootComponent = {
    type: { name: "RootMain" },
    subTree: { children: [{ component: targetComponent }] },
  };
  const app = document.querySelector("#app");
  app.__vue_app__ = { version: "3.5.35" };
  app._vnode = { component: rootComponent };
  return {
    document,
    MutationObserver,
    user,
    displayGate,
    adapter: createNativeIntroAdapter({
      document,
      MutationObserver,
      timeoutMs: 5,
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
