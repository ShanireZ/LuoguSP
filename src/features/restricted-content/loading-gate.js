export function createRestrictedLoadingGate(config) {
  const { pageAdapter, overlayAdapter } = config || {};
  if (
    !pageAdapter ||
    typeof pageAdapter.currentPath !== "function" ||
    typeof pageAdapter.isEnabled !== "function" ||
    typeof pageAdapter.isCandidateRoute !== "function" ||
    !overlayAdapter ||
    typeof overlayAdapter.mount !== "function"
  )
    throw new TypeError("Restricted Loading Gate configuration is invalid");

  let active = false;
  let releaseOverlay = null;
  const start = () => {
    if (active) return true;
    if (
      !pageAdapter.isEnabled() ||
      !pageAdapter.isCandidateRoute(pageAdapter.currentPath())
    )
      return false;
    const release = overlayAdapter.mount();
    releaseOverlay = typeof release === "function" ? release : null;
    active = true;
    return true;
  };
  const release = () => {
    if (!active) return;
    active = false;
    const dispose = releaseOverlay;
    releaseOverlay = null;
    if (dispose) dispose();
  };
  const getState = () => Object.freeze({ active });
  return Object.freeze({ start, release, getState });
}
