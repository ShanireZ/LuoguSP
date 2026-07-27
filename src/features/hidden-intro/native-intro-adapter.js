const NATIVE_INTRO_SELECTOR = ".l-card .introduction .lfe-marked";
const SUPPORTED_VUE_VERSION = /^3\.5\.\d+$/;

function linkedValues(first, nextKey) {
  const values = [];
  const seen = new Set();
  let current = first;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    values.push(current);
    current = current[nextKey];
  }
  return values;
}

function dependencyLinks(computed) {
  return linkedValues(computed?.deps, "nextDep");
}

function subscriberLinks(computed) {
  return linkedValues(computed?.dep?.subs, "prevSub");
}

function componentName(component) {
  return component?.type?.name || component?.type?.__name || "";
}

function collectComponents(vnode) {
  const components = [];
  const seenVNodes = new WeakSet();
  const seenComponents = new WeakSet();
  const visit = (current, depth = 0) => {
    if (
      !current ||
      typeof current !== "object" ||
      depth > 40 ||
      seenVNodes.has(current)
    )
      return;
    seenVNodes.add(current);
    const component = current.component;
    if (
      component &&
      typeof component === "object" &&
      !seenComponents.has(component)
    ) {
      seenComponents.add(component);
      components.push(component);
      visit(component.subTree, depth + 1);
    }
    if (Array.isArray(current.children))
      current.children.forEach((child) => visit(child, depth + 1));
    else if (current.children && typeof current.children === "object")
      Object.values(current.children).forEach((child) =>
        visit(child, depth + 1),
      );
  };
  visit(vnode);
  return components;
}

function readComputed(computed) {
  try {
    return { ok: true, value: computed?.value };
  } catch (error) {
    return { ok: false, value: undefined };
  }
}

function isTargetUser(value, uid, introduction) {
  return (
    value &&
    typeof value === "object" &&
    String(value.uid) === String(uid) &&
    value.introduction === introduction
  );
}

function isComputedRef(value) {
  return (
    value &&
    typeof value === "object" &&
    value.__v_isRef === true &&
    value.__v_isReadonly === true &&
    typeof value.fn === "function" &&
    value.dep &&
    typeof value.dep === "object"
  );
}

function isWritableOwnProperty(value, key) {
  return Object.getOwnPropertyDescriptor(value, key)?.writable === true;
}

function hasIdentityDependency(computed) {
  return dependencyLinks(computed).some((link) => {
    const related = link.dep?.computed;
    const result = readComputed(related);
    return (
      result.ok &&
      typeof result.value === "boolean" &&
      dependencyLinks(related).some(
        (dependency) => dependency.dep?.key === "uid",
      )
    );
  });
}

function hasRenderEffectSubscriber(computed) {
  return subscriberLinks(computed).some((link) => {
    const subscriber = link.sub;
    return (
      subscriber &&
      subscriber.__v_isRef !== true &&
      typeof subscriber.fn === "function" &&
      typeof subscriber.scheduler === "function"
    );
  });
}

function snapshotUserValues(computed, targetUser) {
  const records = new Map();
  const visited = new WeakSet();
  const visit = (current, depth = 0) => {
    if (
      !current ||
      typeof current !== "object" ||
      depth > 3 ||
      visited.has(current)
    )
      return;
    visited.add(current);
    const result = readComputed(current);
    const value = result.value;
    if (value && typeof value === "object" && "uid" in value)
      records.set(
        value,
        JSON.stringify({
          uid: value.uid,
          isAdmin: value.isAdmin,
          introduction: value.introduction,
        }),
      );
    dependencyLinks(current).forEach((link) =>
      visit(link.dep?.computed, depth + 1),
    );
  };
  visit(computed);
  if (targetUser && typeof targetUser === "object")
    records.set(
      targetUser,
      JSON.stringify({
        uid: targetUser.uid,
        isAdmin: targetUser.isAdmin,
        introduction: targetUser.introduction,
      }),
    );
  return records;
}

function snapshotsMatch(records) {
  return [...records].every(
    ([value, snapshot]) =>
      JSON.stringify({
        uid: value.uid,
        isAdmin: value.isAdmin,
        introduction: value.introduction,
      }) === snapshot,
  );
}

export function createNativeIntroAdapter(options = {}) {
  const {
    document = globalThis.document,
    MutationObserver: MutationObserverImpl = globalThis.MutationObserver,
    setTimeout: setTimeoutImpl = globalThis.setTimeout,
    clearTimeout: clearTimeoutImpl = globalThis.clearTimeout,
    timeoutMs = 800,
    logDiagnostic = (details) =>
      console.debug("LuoguSP hidden-intro native:", details),
  } = options;
  const records = new WeakMap();

  if (!document?.querySelectorAll || !document?.querySelector)
    throw new TypeError("Native intro adapter requires a document");

  const nativeCards = () =>
    [...document.querySelectorAll(NATIVE_INTRO_SELECTOR)].filter(
      (node) => !node.closest(".luogusp-intro-card"),
    );
  const report = (status, reason) => {
    if (status !== "native-attached" && status !== "already-native")
      logDiagnostic({ status, reason });
    return Object.freeze({ status, reason });
  };
  const waitForCardCount = (expectedCount, signal) => {
    const currentCount = nativeCards().length;
    if (currentCount === expectedCount)
      return Promise.resolve(Object.freeze({ kind: "matched" }));
    if (!MutationObserverImpl || typeof setTimeoutImpl !== "function")
      return Promise.resolve(Object.freeze({ kind: "unsupported" }));
    return new Promise((resolve) => {
      let observer = null;
      let timer = null;
      const onAbort = () => finish("cancelled");
      const finish = (kind) => {
        if (observer) observer.disconnect();
        if (timer !== null) clearTimeoutImpl(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(Object.freeze({ kind }));
      };
      const check = () => {
        const count = nativeCards().length;
        if (count === expectedCount) finish("matched");
        else if (count > expectedCount) finish("invalid-count");
      };
      observer = new MutationObserverImpl(check);
      observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
      });
      if (signal?.aborted) return finish("cancelled");
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeoutImpl(() => finish("timeout"), timeoutMs);
      check();
    });
  };
  const restoreRecord = (record) => {
    if (!record.active) return true;
    record.active = false;
    if (record.candidate.fn !== record.forcedFn) {
      logDiagnostic({
        status: "native-unsupported",
        reason: "candidate-ownership-lost",
      });
      return false;
    }
    try {
      record.candidate.fn = record.originalFn;
      const value = record.originalFn(record.candidate._value);
      if (typeof value !== "boolean")
        throw new TypeError("restore result is not boolean");
      record.candidate._value = value;
      record.candidate.dep.trigger();
      return true;
    } catch (error) {
      logDiagnostic({
        status: "native-unsupported",
        reason: "restore-failed",
      });
      return false;
    }
  };
  const findCandidate = (component, uid, introduction) => {
    const targetComputeds = new Set();
    for (const effect of component.scope?.effects || []) {
      for (const link of linkedValues(effect.deps, "nextDep")) {
        const computed = link.dep?.computed;
        const result = readComputed(computed);
        if (
          isComputedRef(computed) &&
          result.ok &&
          isTargetUser(result.value, uid, introduction)
        )
          targetComputeds.add(computed);
      }
    }
    if (targetComputeds.size !== 1)
      return { reason: "target-user-computed-count" };
    const [targetComputed] = targetComputeds;
    const targetUser = readComputed(targetComputed).value;
    const candidates = new Set();
    for (const link of subscriberLinks(targetComputed)) {
      const candidate = link.sub;
      const result = readComputed(candidate);
      const dependencies = dependencyLinks(candidate);
      const isCandidate =
        isComputedRef(candidate) &&
        result.ok &&
        result.value === false &&
        isWritableOwnProperty(candidate, "fn") &&
        isWritableOwnProperty(candidate, "_value") &&
        typeof candidate.dep?.trigger === "function" &&
        dependencies.some(
          (dependency) => dependency.dep?.computed === targetComputed,
        ) &&
        dependencies.some((dependency) => dependency.dep?.key === "isAdmin") &&
        hasIdentityDependency(candidate) &&
        hasRenderEffectSubscriber(candidate);
      if (isCandidate) candidates.add(candidate);
    }
    if (candidates.size !== 1) return { reason: "candidate-count" };
    return { candidate: [...candidates][0], targetUser };
  };

  return Object.freeze({
    async attach({ uid, introduction, signal } = {}) {
      if (nativeCards().length)
        return Object.freeze({ status: "already-native" });
      if (typeof introduction !== "string" || !introduction.trim())
        return report("native-unsupported", "missing-introduction");
      const app = document.querySelector("#app")?.__vue_app__;
      if (!SUPPORTED_VUE_VERSION.test(app?.version || ""))
        return report("native-unsupported", "vue-version");
      const appRoot = document.querySelector("#app");
      const componentSet = new Set();
      for (const vnode of [
        appRoot?._vnode,
        app?._container?._vnode,
        app?._instance?.subTree,
      ])
        for (const component of collectComponents(vnode))
          componentSet.add(component);
      const allComponents = [...componentSet];
      const components = allComponents.filter(
        (component) => componentName(component) === "UserShowMain",
      );
      if (components.length !== 1)
        return report(
          "native-unsupported",
          `user-show-main-count:${components.length}/${allComponents.length}`,
        );
      const component = components[0];
      if (component.isUnmounted)
        return report("native-unsupported", "component-unmounted");
      const found = findCandidate(component, uid, introduction);
      if (!found.candidate) return report("native-unsupported", found.reason);
      const existing = records.get(found.candidate);
      if (existing?.active)
        return Object.freeze({
          status: "native-attached",
          restore: existing.restore,
        });

      const forcedFn = () => true;
      const record = {
        active: true,
        candidate: found.candidate,
        originalFn: found.candidate.fn,
        forcedFn,
        restore: null,
      };
      record.restore = () => restoreRecord(record);
      const snapshots = snapshotUserValues(found.candidate, found.targetUser);
      try {
        found.candidate.fn = forcedFn;
        const value = forcedFn(found.candidate._value);
        if (value !== true) throw new TypeError("forced result is not true");
        found.candidate._value = value;
        found.candidate.dep.trigger();
        const waitResult = await waitForCardCount(1, signal);
        if (waitResult.kind !== "matched") {
          record.restore();
          await waitForCardCount(0);
          return report(
            waitResult.kind === "timeout"
              ? "native-timeout"
              : "native-unsupported",
            waitResult.kind,
          );
        }
        if (!snapshotsMatch(snapshots)) {
          record.restore();
          await waitForCardCount(0);
          return report("native-unsupported", "identity-mutated");
        }
        records.set(found.candidate, record);
        return Object.freeze({
          status: "native-attached",
          restore: record.restore,
        });
      } catch (error) {
        record.restore();
        await waitForCardCount(0);
        return report("native-unsupported", "attach-failed");
      }
    },
  });
}
