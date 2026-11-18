// Author text can acquire marker-like characters after Markdown/HTML decoding.
// A per-render nonce isolates placeholders without scanning or growing a prefix.
export function createMarkerPrefix(stem) {
  if (typeof globalThis.crypto?.getRandomValues !== "function")
    throw new Error("Secure rendering markers are unavailable");
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${stem}${nonce}:`;
}
