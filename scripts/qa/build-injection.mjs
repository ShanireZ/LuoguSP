import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const defaultArtifactPath = new URL("../../LuoguSP.user.js", import.meta.url);

function readPin(line) {
  const value = line.match(/^\/\/[ \t]*@require[ \t]+(\S+)[ \t]*$/)?.[1];
  const url = URL.parse(value);
  const pin = url?.hash.match(/^#sha256=([a-f0-9]{64})$/)?.[1];
  if (url?.protocol !== "https:" || url.username || url.password || !pin)
    throw new Error("Expected an HTTPS @require with SHA-256");
  url.hash = "";
  return { value, url, pin };
}

// Match the installer's startup order and verify the downloaded bytes before
// letting either browser QA entry point assemble executable content.
export async function buildInjection({ artifactPath = defaultArtifactPath, fetchImpl = fetch } = {}) {
  const artifact = await readFile(artifactPath, "utf8");
  const metadata = artifact.match(/^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==\r?$/m)?.[1];
  const entries = metadata?.split(/\r?\n/).filter((line) => /^\/\/[ \t]*@require\b/.test(line));
  if (entries?.length !== 2) throw new Error("Expected two pinned startup @require entries");
  const requires = entries.map(readPin);

  const dependencies = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const { url, pin } of requires) {
    const response = await fetchImpl(url.href, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200 || response.redirected !== false || response.url !== url.href)
      throw new Error("Unexpected @require response for " + url.pathname);
    const body = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(body).digest("hex") !== pin)
      throw new Error("@require SHA-256 mismatch for " + url.pathname);
    dependencies.push(decoder.decode(body) + "\n//# sourceURL=luogusp-qa/" + basename(url.pathname));
  }

  return {
    artifact,
    requireUrls: requires.map(({ value }) => value),
    payload: [
      "globalThis.__LUOGUSP_QA_START = performance.now();",
      ...dependencies,
      artifact,
      "globalThis.__LUOGUSP_QA_END = performance.now();",
      "//# sourceURL=luogusp-qa/inject.js",
    ].join("\n;\n"),
  };
}
