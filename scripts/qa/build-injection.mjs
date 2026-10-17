import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// 把「油猴實際會載入的那一串東西」拼成一段可注入的指令碼：
// 兩個 `@require` 的位元組 + 使用者指令碼本體，前後夾一對時間戳用來量啟動耗時。
//
// ★ 順序與油猴一致：`@require` 先執行（它們建起 `__LUOGUSP_CDN_RUNTIME__`），
//   本體最後跑（它只是檢核執行環境在不在）。順序反了測出來的東西沒有意義。
// ★ `@require` 的位元組**從 URL 現取**，而不是從工作區拼 —— 那兩條 URL 裡釘著 sha256，
//   現取才能順帶證明「使用者真正會下載到的那份」能跑。
export async function buildInjection({ fetchImpl = fetch } = {}) {
  const artifactPath = join(projectRoot, "LuoguSP.user.js");
  const artifact = await readFile(artifactPath, "utf8");
  const requireUrls = [...artifact.matchAll(/^\/\/ @require\s+(\S+)/gm)].map(
    (match) => match[1],
  );

  const dependencies = [];
  for (const url of requireUrls) {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    dependencies.push(
      `${await response.text()}\n//# sourceURL=luogusp-qa/${basename(new URL(url).pathname)}`,
    );
  }

  return {
    artifact,
    requireUrls,
    payload: [
      "globalThis.__LUOGUSP_QA_START = performance.now();",
      ...dependencies,
      artifact,
      "globalThis.__LUOGUSP_QA_END = performance.now();",
      "//# sourceURL=luogusp-qa/inject.js",
    ].join("\n;\n"),
  };
}
