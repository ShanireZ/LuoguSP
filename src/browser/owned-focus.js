export function watchOwnedFocus(document, owns) {
  let lastFocused = owns(document.activeElement) ? document.activeElement : null;
  const onFocus = ({ target }) => { lastFocused = owns(target) ? target : null; };
  const onBlur = ({ target, relatedTarget }) => {
    if (target !== lastFocused || relatedTarget) return;
    // Removal can blur a control before it is detached. An ordinary blur leaves it connected.
    queueMicrotask(() => {
      if (lastFocused === target && target.isConnected && document.activeElement !== target)
        lastFocused = null;
    });
  };
  document.addEventListener("focusin", onFocus, true);
  document.addEventListener("blur", onBlur, true);
  return {
    current() {
      const active = document.activeElement;
      if (active === lastFocused || (active === document.body && lastFocused && !lastFocused.isConnected))
        return lastFocused;
      return null;
    },
    dispose() {
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("blur", onBlur, true);
      lastFocused = null;
    },
  };
}
