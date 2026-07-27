const statuses = new Set([
  "idle",
  "already-native",
  "native-attached",
  "native-unsupported",
  "native-timeout",
  "fallback-rendered",
  "fallback-lite",
  "fallback-unavailable",
]);

export function createHiddenIntroDiagnostics() {
  let current = Object.freeze({ status: "idle", reason: null });
  return Object.freeze({
    set(status, reason = null) {
      if (!statuses.has(status))
        throw new TypeError(
          `Unknown hidden-intro diagnostic status: ${status}`,
        );
      current = Object.freeze({ status, reason });
    },
    get() {
      return current;
    },
  });
}
