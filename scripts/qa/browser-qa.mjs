import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { behaviourHashOf } from "../artifact-behaviour-hash.mjs";
import { buildInjection } from "./build-injection.mjs";
import { FIXTURE_HTML } from "./fixture.mjs";

// 真机 QA。★★★ 这个脚本存在的理由：`reports/browser-qa.json` 一直是**手写**的 ——
// 仓库里没有任何东西能生成它，于是「改了产物就得重跑 QA」在实际操作上等于「补不回来」，
// 一改文案就把一份如假包换的 QA 弄作废。现在它可复现了：`pnpm qa:browser`。
//
// 覆盖范围**故意画得很清楚**，写进报告的 limitations，不假装验过：
//   验：两个 `@require` 的真实字节能不能在浏览器里跑起来、启动耗时、控制台有没有报错、
//       page-lifecycle 有没有把功能挂上（设置入口出现）、离线也能着色（整批收取命中）。
//   不验：按需块（要网络）、保存站（要 GM_xmlhttpRequest）、写请求、真站 DOM 漂移。
//
// ★ 优先用**系统已装的 Chrome**（`channel: "chrome"`），拿不到再退回 Playwright 自带的
//   Chromium。这样既贴近 owner 的真实浏览器，也不必下载 150MB。

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ITERATIONS = 5;
const FIXTURE_URL = "https://www.luogu.com.cn/qa-fixture";

const gitOutput = (args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const launch = async () => {
  for (const channel of ["chrome", "msedge"]) {
    try {
      const browser = await chromium.launch({ channel, headless: true });
      return { browser, label: `Playwright + 系统 ${channel} ${browser.version()}` };
    } catch {
      /* 没装就试下一个 */
    }
  }
  const browser = await chromium.launch({ headless: true });
  return { browser, label: `Playwright 自带 Chromium ${browser.version()}` };
};

const artifact = await readFile(resolve(root, "LuoguSP.user.js"), "utf8");
const { payload, requireUrls } = await buildInjection();

const { browser, label } = await launch();
const failures = [];
const consoleMessages = [];
const startupMeasurements = [];
const checks = {};

try {
  const context = await browser.newContext();
  // 夹具是离线的：把那一个 URL 接管掉，其余外部请求（头像等）一律掐断，
  // 免得网络抖动混进结论里。
  await context.route("**/*", async (route) => {
    if (route.request().url() === FIXTURE_URL)
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: FIXTURE_HTML });
    return route.abort();
  });

  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return;
      consoleMessages.push({ iteration, type: message.type(), text: message.text() });
    });
    page.on("pageerror", (error) =>
      consoleMessages.push({ iteration, type: "pageerror", text: String(error && error.message) }),
    );
    // ★ 用户脚本是 `@run-at document-start` + `@sandbox raw` —— 主世界、文档一开始就跑。
    //   `addInitScript` 正好是这个时机与这个 realm，和油猴对得上。
    await page.addInitScript({ content: payload });
    await page.goto(FIXTURE_URL, { waitUntil: "load" });
    // 功能挂载走 page-lifecycle（还带 rAF 节流），**必须等到落地再量**，
    // 不能拍个固定毫秒数就断言 —— 那种门时快时慢，等于没有门。
    await page
      .waitForFunction(
        () =>
          !!document.querySelector(".luogusp-setting-entry") &&
          !!document.querySelector('a[href="/problem/P1000"] b[style*="color"]'),
        null,
        { timeout: 5000 },
      )
      .catch(() => {
        /* 没等到就让下面的检查如实报红 */
      });

    const measured = await page.evaluate(() => ({
      ms: globalThis.__LUOGUSP_QA_END - globalThis.__LUOGUSP_QA_START,
      runtime: !!globalThis.__LUOGUSP_CDN_RUNTIME__,
      // 设置入口的标记是 `.luogusp-setting-entry`（settings/feature.js 里加的那个类）。
      settingsEntry: !!document.querySelector(".luogusp-setting-entry"),
      // 着色是把题号包进一个带 inline color 的 <b> 里。
      colouredPid: (() => {
        const link = document.querySelector('a[href="/problem/P1000"]');
        const painted = link && link.querySelector("b");
        return painted ? getComputedStyle(painted).color : null;
      })(),
    }));
    startupMeasurements.push({ iteration, ms: measured.ms });
    if (iteration === 1) {
      checks.cdnRuntimeInstalled = measured.runtime;
      checks.settingsEntryMounted = measured.settingsEntry;
      checks.problemColourApplied = measured.colouredPid;
    }
    await page.close();
  }

  if (!checks.cdnRuntimeInstalled)
    failures.push("两个 @require 跑完之后没有建起 __LUOGUSP_CDN_RUNTIME__");
  if (!checks.settingsEntryMounted)
    failures.push("page-lifecycle 没有把设置入口挂进导航栏");
  // 入门是 #fe4c61。★ 这条能离线成立，是因为夹具的 lentille-context 里带了难度，
  //   整批收取直接命中，一个请求都不用发。
  if (checks.problemColourApplied !== "rgb(254, 76, 97)")
    failures.push(`题号没有被染成入门色，实际 ${checks.problemColourApplied}`);
} finally {
  await browser.close();
}

const luoguSpErrorCount = consoleMessages.filter(
  (message) => message.type !== "warning" && /LuoguSP/i.test(message.text),
).length;
if (luoguSpErrorCount) failures.push(`控制台出现 ${luoguSpErrorCount} 条 LuoguSP 报错`);

const report = {
  checkedAt: new Date().toISOString(),
  status: failures.length ? "failed" : "passed",
  browser: label,
  generatedBy: "pnpm qa:browser (scripts/qa/browser-qa.mjs)",
  sourceCommit: gitOutput(["rev-parse", "HEAD"]),
  worktreeIncluded: gitOutput(["status", "--porcelain"]) !== "",
  release: (artifact.match(/^\/\/ @version\s+(\S+)/m) || [])[1] || null,
  requireUrls,
  artifactSha256: createHash("sha256").update(artifact, "utf8").digest("hex"),
  behaviorSha256: behaviourHashOf(artifact),
  behaviorSha256Note:
    "只把 @description 那一行抹成占位符，其余（含 @require/@match/@grant/@connect/@run-at/@sandbox 与脚本体）全部参与。",
  startupMeasurements,
  console: { luoguSpErrorCount, messages: consoleMessages },
  checks,
  limitations: [
    "跑在离线夹具页上，不是 www.luogu.com.cn：本门只回答「这份产物能不能跑起来、启动多久、有没有报错」，可复现是首要目标。",
    "按需块（markdownRenderer / restrictedContent / hoverCard）要联网才拉得到，不在覆盖范围内。",
    "保存站相关路径要 GM_xmlhttpRequest，夹具里没有，不在覆盖范围内。",
    "一切写请求（关注 / 屏蔽 / 申请更新）一律不触发。",
    "真站 DOM 漂移只能靠 owner 的真机验收发现，这道门看不出来。",
  ],
  failures,
};

await writeFile(
  resolve(root, "reports/browser-qa.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

const ms = startupMeasurements.map((sample) => sample.ms);
console.log(
  `browser QA ${report.status}: ${label} · 启动 ${Math.min(...ms).toFixed(2)}~${Math.max(...ms).toFixed(2)}ms · LuoguSP 报错 ${luoguSpErrorCount} 条`,
);
if (failures.length) {
  for (const failure of failures) console.error(`  ✖ ${failure}`);
  process.exitCode = 1;
}
