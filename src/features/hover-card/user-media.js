const PAGE_ORIGIN = "https://www.luogu.com.cn";
const CDN_ORIGIN = "https://cdn.luogu.com.cn";
const DEFAULT_COVER = `${CDN_ORIGIN}/images/bg/fe/DSCF0530-shrink.jpg`;
const AVATAR_PATH = /^\/upload\/usericon\//;
const COVER_PATH = /^\/(?:upload\/image_hosting|images\/bg)\//;
const IMAGE_TYPE = /^image\/(avif|bmp|gif|jpeg|png|webp)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_DEADLINE_MS = 2500;

function officialMediaUrl(raw, path) {
  if (!raw) return null;
  try {
    const url = new URL(raw, PAGE_ORIGIN);
    if ((url.origin !== CDN_ORIGIN && url.origin !== PAGE_ORIGIN) || url.username || url.password ||
        !path.test(url.pathname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function fetchImage(fetchPage, url, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, IMAGE_DEADLINE_MS);
  try {
    const response = await fetchPage(url, controller.signal, {
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
    });
    if (!response?.ok || response.redirected || response.url !== url || controller.signal.aborted) return null;
    const type = response.headers.get("content-type")?.split(";", 1)[0].trim();
    if (!IMAGE_TYPE.test(type ?? "") || !response.body ||
        Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) return null;
    const reader = response.body.getReader();
    const cancelRead = () => void reader.cancel().catch(() => {});
    controller.signal.addEventListener("abort", cancelRead, { once: true });
    try {
      const chunks = [];
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) return null;
        if (done) return new Blob(chunks, { type });
        length += value.byteLength;
        if (length > MAX_IMAGE_BYTES) {
          cancelRead();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      controller.signal.removeEventListener("abort", cancelRead);
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    abort();
  }
}

// Luogu's image policy permits data: but blocks blob: on some pages.
const imageDataUrl = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.readAsDataURL(blob);
});

// Display only verified image responses. A direct img or CSS URL could follow redirects.
export function createUserMedia(fetchPage, signal) {
  const slots = new Map();
  const clear = (slot) => {
    slot.controller.abort();
    slot.img.onerror = null;
    slot.img.removeAttribute("src");
  };
  signal.addEventListener("abort", () => {
    for (const slot of slots.values()) clear(slot);
    slots.clear();
  }, { once: true });

  const updateSlot = (img, url, fallback) => {
    const previous = slots.get(img);
    if (previous?.url === url || signal.aborted) return;
    if (previous) {
      clear(previous);
      slots.delete(img);
    }
    if (!url) return;
    const slot = { img, url, controller: new AbortController() };
    slots.set(img, slot);
    const { signal: slotSignal } = slot.controller;
    const show = async (source, next) => {
      const useFallback = () => {
        if (slotSignal.aborted) return;
        img.onerror = null;
        img.removeAttribute("src");
        if (next) void show(next);
      };
      try {
        const blob = await fetchImage(fetchPage, source, slotSignal);
        if (!blob) return useFallback();
        const dataUrl = await imageDataUrl(blob);
        if (slotSignal.aborted) return;
        if (!dataUrl) return useFallback();
        img.onerror = useFallback;
        img.src = dataUrl;
      } catch {
        useFallback();
      }
    };
    void show(url, fallback);
  };

  return (header, model) => {
    const cover = officialMediaUrl(model.background, COVER_PATH) || DEFAULT_COVER;
    updateSlot(header.firstElementChild, cover, cover !== DEFAULT_COVER ? DEFAULT_COVER : null);
    updateSlot(header.lastElementChild, officialMediaUrl(model.avatar, AVATAR_PATH));
  };
}
