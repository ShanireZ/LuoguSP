export function defineConfigurableFeature({
  id,
  key,
  label,
  storage,
  mount,
  onRoute,
  keepMountedOnRoute,
}) {
  if (!id || !key || !label || !storage || typeof mount !== "function")
    throw new TypeError("Configurable feature descriptor is invalid");
  const storageKey = `LuoguSP.${key}`;
  const feature = {
    id,
    key,
    label,
    storageKey,
    defaultEnabled: true,
    enabled: () => storage.get(storageKey),
    mount,
  };
  if (typeof onRoute === "function") feature.onRoute = onRoute;
  if (keepMountedOnRoute === true) feature.keepMountedOnRoute = true;
  return Object.freeze(feature);
}
