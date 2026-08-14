import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// 把「油猴实际会加载的那一串东西」拼成一段可注入的脚本：
// 两个 `@require` 的字节 + 用户脚本本体，前后夹一对时间戳用来量启动耗时。
//
// ★ 顺序与油猴一致：`@require` 先执行（它们建起 `__LUOGUSP_CDN_RUNTIME__`），
//   本体最后跑（它只是校验运行时在不在）。顺序反了测出来的东西没有意义。
// ★ `@require` 的字节**从 URL 现取**，而不是从工作区拼 —— 那两条 URL 里钉着 sha256，
//   现取才能顺带证明「用户真正会下载到的那份」能跑。
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
