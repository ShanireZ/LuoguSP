import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { behaviourHashOf } from "../artifact-behaviour-hash.mjs";
import { buildInjection } from "./build-injection.mjs";
import { FIXTURE_HTML } from "./fixture.mjs";

// 真機 QA。★★★ 這個指令碼存在的理由：`reports/browser-qa.json` 一直是**手寫**的 ——
// 儲存庫裡沒有任何東西能生成它，於是「改了產物就得重跑 QA」在實際操作上等於「補不回來」，
// 一改文案就把一份如假包換的 QA 弄作廢。現在它可重現了：`pnpm qa:browser`。
//
// 覆蓋範圍**故意畫得很清楚**，寫進報告的 limitations，不假裝驗過：
//   驗：兩個 `@require` 的真實位元組能不能在瀏覽器裡跑起來、啟動耗時、控制檯有沒有回報錯誤、
//       page-lifecycle 有沒有把功能掛上（設定入口出現）、離線也能著色（整批收取命中）。
//   不驗：按需塊（要網路）、保存站（要 GM_xmlhttpRequest）、寫請求、真站 DOM 漂移。
//
// ★ 優先用**系統已裝的 Chrome**（`channel: "chrome"`），拿不到再退回 Playwright 自帶的
//   Chromium。這樣既貼近 owner 的真實瀏覽器，也不必下載 150MB。

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
      /* 沒裝就試下一個 */
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
  // 夾具是離線的：把那一個 URL 接管掉，其餘外部請求（頭像等）一律掐斷，
  // 免得網路抖動混進結論裡。
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
    // ★ 使用者指令碼是 `@run-at document-start` + `@sandbox raw` —— 主世界、文件一開始就跑。
    //   `addInitScript` 正好是這個時機與這個 realm，和油猴對得上。
    await page.addInitScript({ content: payload });
    await page.goto(FIXTURE_URL, { waitUntil: "load" });
    // 功能掛載走 page-lifecycle（還帶 rAF 節流），**必須等到完成實作再量**，
    // 不能拍個固定毫秒數就斷言 —— 那種門時快時慢，等於沒有門。
    await page
      .waitForFunction(
        () =>
          !!document.querySelector(".luogusp-setting-entry") &&
          !!document.querySelector('a[href="/problem/P1000"] b[style*="color"]'),
        null,
        { timeout: 5000 },
      )
      .catch(() => {
        /* 沒等到就讓下面的檢查如實報紅 */
      });

    const measured = await page.evaluate(() => ({
      ms: globalThis.__LUOGUSP_QA_END - globalThis.__LUOGUSP_QA_START,
      runtime: !!globalThis.__LUOGUSP_CDN_RUNTIME__,
      // 設定入口的標記是 `.luogusp-setting-entry`（settings/feature.js 里加的那個類）。
      settingsEntry: !!document.querySelector(".luogusp-setting-entry"),
      // 入口是克隆範本條目來的，所以浮泡與讀屏名字都可能是範本那條的（真站上範本
      // 是「文章廣場」）。這裡收的是入口自己那一層能被瀏覽器當浮泡用的名字。
      settingsEntryNames: (() => {
        const entry = document.querySelector(".luogusp-setting-entry");
        if (!entry) return null;
        const unit = entry.closest("li") || entry;
        return [unit, ...unit.querySelectorAll("*")]
          .flatMap((el) =>
            ["title", "aria-label", "aria-labelledby"]
              .map((name) => el.getAttribute(name))
              .filter((value) => value !== null),
          )
          .filter((value, index, all) => all.indexOf(value) === index);
      })(),
      // 著色是把題號包進一個帶 inline color 的 <b> 裡。
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
      checks.settingsEntryNames = measured.settingsEntryNames;
      checks.problemColourApplied = measured.colouredPid;
    }
    await page.close();
  }

  if (!checks.cdnRuntimeInstalled)
    failures.push("两个 @require 跑完之后没有建起 __LUOGUSP_CDN_RUNTIME__");
  if (!checks.settingsEntryMounted)
    failures.push("page-lifecycle 没有把设置入口挂进导航栏");
  // ★ 名字必須全是入口自己的。夾具的範本是「文章廣場」，所以只要克隆時沒剝淨，
  //   這裡會當場讀到它 —— owner 2026-08-20 報的就是這個。
  const entryNames = checks.settingsEntryNames;
  if (entryNames !== null) {
    const wrong = entryNames.filter((name) => name !== "插件设置");
    if (wrong.length)
      failures.push(
        `设置入口带着模板条目的名字：${wrong.join(" / ")}`,
      );
    else if (!entryNames.length)
      failures.push("设置入口一个浮泡名字都没有，克隆时连自己的名字也没设上");
  }
  // 入門是 #fe4c61。★ 這條能離線成立，是因為夾具的 lentille-context 裡帶了難度，
  //   整批收取直接命中，一個請求都不用發。
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
