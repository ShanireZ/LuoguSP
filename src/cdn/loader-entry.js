const runtime = globalThis.__LUOGUSP_CDN_RUNTIME__;

if (!runtime || runtime.apiVersion !== 1)
  console.error(
    "LuoguSP CDN runtime was not initialized. Please update or reinstall LuoguSP.",
  );
