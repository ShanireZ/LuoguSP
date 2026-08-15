import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCK_SYNC_ARGS,
  classifyLockSync,
  inspectLockSync,
} from "../scripts/lock-sync.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// 2026-08-14 `npm ci` 在两边 CI 上的真实输出，逐字照抄（含 npm 在 EUSAGE 后
// 追加的整页 usage —— 门的摘要必须把那页噪音扔掉，只留可行动的几行）。
const REAL_EUSAGE = `npm error code EUSAGE
npm error
npm error \`npm ci\` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with \`npm install\` before continuing.
npm error
npm error Missing: playwright@1.62.1 from lock file
npm error Missing: fsevents@2.3.2 from lock file
npm error Missing: playwright-core@1.62.1 from lock file
npm error
npm error Clean install a project
npm error
npm error Usage:
npm error npm ci
npm error
npm error Options:
npm error [--install-strategy <hoisted|nested|shallow|linked>] [--legacy-bundling]
npm error [--global-style] [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
npm error aliases: clean-install, ic, install-clean, isntall-clean
npm error
npm error Run "npm help ci" for more info
`;

test("lock 对得上时这道门不出声", () => {
  assert.equal(classifyLockSync({ code: 0, output: "added 2 packages" }), null);
});

// ★★★ 反证：这道门存在的唯一理由，就是让 2026-08-14 那次失败在本地就红。
//    只断言「干净时是绿的」永远绿 —— 真正要钉死的是「漂移时必须红，
//    而且要说人话」：点名缺了哪几个包，并给出修法。
test("lock 漂移必须红，且点名缺的包、给出修法", () => {
  const failure = classifyLockSync({ code: 1, output: REAL_EUSAGE });

  assert.ok(failure, "真实的 EUSAGE 输出必须被判为失败");
  assert.equal(failure.kind, "drift");
  for (const missing of [
    "playwright@1.62.1",
    "fsevents@2.3.2",
    "playwright-core@1.62.1",
  ])
    assert.match(failure.summary, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // 修法要直接写在门里，别让读的人再去查一遍。
  assert.match(failure.summary, /npm install --package-lock-only/);
  // npm 在 EUSAGE 之后会糊一整页 usage，那页跟诊断毫无关系，不许进摘要。
  assert.doesNotMatch(failure.summary, /Usage|aliases|--install-strategy|npm help/);
});

// npm 起不来、lock 是坏 JSON、npm 换了行为 —— 这些同样要红（「永远红不了的门
// 等于没有门」），但**不许谎称是 lock 漂移**：这次的教训正是被一条指错方向的
// 报错带偏。所以两类失败必须分开措辞。
test("非漂移的失败照样红，但不许谎称是 lock 漂移", () => {
  const failure = classifyLockSync({
    code: 1,
    output: `npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/left-pad failed: cache mode is 'only-if-cached' but no cached response is available.
`,
  });

  assert.ok(failure, "npm 跑不起来也必须是红的");
  assert.equal(failure.kind, "unusable");
  assert.doesNotMatch(failure.summary, /out of sync|package-lock\.json is out of sync/);
  assert.match(failure.summary, /ENOTCACHED/);
});

// ★ 别给这条命令加 `--offline`。实测（2026-08-15）：真正的漂移形态是
//   「package.json 声明了 lock 里没有的包」，npm 必须取一次 registry 元数据
//   才能算出 ideal tree 并做同步比对；加了 `--offline` 它会先撞
//   ENOTCACHED 而**根本走不到** EUSAGE，于是门虽然还是红的，报错却指向
//   「缓存里没有」这个假方向 —— 正是这次要消灭的那种误导。
test("同步检查不许被降级成离线跑", () => {
  assert.ok(!LOCK_SYNC_ARGS.includes("--offline"));
  assert.deepEqual(LOCK_SYNC_ARGS[0], "ci");
  assert.ok(LOCK_SYNC_ARGS.includes("--dry-run"), "不许真的改 node_modules");
});

test("inspectLockSync 在仓库根上跑 npm，并把退出码和输出交给分类器", async () => {
  const calls = [];
  const failure = await inspectLockSync({
    cwd: "/repo",
    run: async (args, options) => {
      calls.push({ args, options });
      return { code: 1, output: REAL_EUSAGE };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, LOCK_SYNC_ARGS);
  assert.equal(calls[0].options.cwd, "/repo");
  assert.equal(failure.kind, "drift");
});

// 门必须真的挂在 `--check` 上，否则它只是一个没人调用的模块。
test("quality.mjs 的 --check 真的挂了这道门", () => {
  const quality = read("scripts/quality.mjs");
  assert.match(quality, /inspectLockSync/);
  assert.match(quality, /lock-sync\.mjs/);
});
