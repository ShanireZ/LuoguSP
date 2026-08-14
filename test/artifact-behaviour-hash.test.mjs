import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { behaviourHashOf } from "../scripts/artifact-behaviour-hash.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = fs.readFileSync(path.join(root, "LuoguSP.user.js"), "utf8");
const qaReport = JSON.parse(
  fs.readFileSync(path.join(root, "reports", "browser-qa.json"), "utf8"),
);

// ★★★ 这道门证明「这份产物真的在浏览器里跑过」。放松它等于把门拆了 ——
//    所以这一组测试的重点是**反证**：除了 `@description`，改任何一处都必须让哈希变。
//    只断言「改说明不变」是不够的，那种测试永远绿。

test("@description 是纯展示文本，改它不影响行为哈希", () => {
  const before = behaviourHashOf(artifact);
  const after = behaviourHashOf(
    artifact.replace(/^\/\/ @description\s.*$/m, "// @description  完全不一样的说明文字"),
  );
  assert.equal(after, before);
  // 但整份文件的哈希**是**会变的 —— 这正是当初卡住的原因，别把这条也抹掉。
  assert.notEqual(
    artifact,
    artifact.replace(/^\/\/ @description\s.*$/m, "// @description  完全不一样的说明文字"),
  );
});

// 每一条生效的元数据都会改变行为，一条都不许豁免。
test("生效元数据与脚本体，改哪一处行为哈希都要变", () => {
  const before = behaviourHashOf(artifact);
  const mutations = {
    "@require": [/#sha256=[0-9a-f]{8}/, "#sha256=deadbeef"],
    "@match": ["// @match        https://www.luogu.com.cn/*", "// @match        https://evil.example/*"],
    "@grant": ["// @grant        GM_xmlhttpRequest", "// @grant        none"],
    "@connect": ["// @connect      luogusp.round1.cc", "// @connect      evil.example"],
    "@run-at": ["// @run-at       document-start", "// @run-at       document-end"],
    "@sandbox": ["// @sandbox      raw", "// @sandbox      JavaScript"],
    "@version": ["// @version      ", "// @version      99."],
    脚本体: ["__LUOGUSP_CDN_RUNTIME__", "__SOMETHING_ELSE__"],
  };
  for (const [name, [from, to]] of Object.entries(mutations)) {
    const mutated = artifact.replace(from, to);
    assert.notEqual(mutated, artifact, `${name}: 反证补丁本身没落地`);
    assert.notEqual(behaviourHashOf(mutated), before, `${name} 改了却没让行为哈希变`);
  }
});

// 报告里必须钉着一个像样的行为哈希 —— 但**不在这里断言它等于当前产物**。
//
// ★★★ 这条边界是踩出来的：我一开始在这里断言「报告的哈希 == 当前产物的哈希」，
//    结果把**转正式版的流程整个堵死**了 —— `pnpm release` 在
//    「activation verification」阶段会跑 `node --test`，而那时产物刚被提升到新版本、
//    QA 还没来得及重跑（重跑 QA 本来就必须在发布**之后**，因为它注入的是
//    `@require` 指向的已发布字节）。于是：不重跑 QA 过不了测试，不发布又没法重跑 QA。
//    发布脚本对这件事早有安排 —— 它给 `quality.mjs` 传了 `--skip-browser-qa`，
//    把「QA 是否覆盖当前产物」这道门**留到发布之后**再验。
//    所以那条相等断言的归属是 `scripts/quality.mjs`，不是这里。
test("真机 QA 报告钉的是一个像样的行为哈希", () => {
  assert.equal(typeof qaReport.behaviorSha256, "string");
  assert.equal(qaReport.behaviorSha256.length, 64);
  assert.match(qaReport.behaviorSha256, /^[0-9a-f]{64}$/);
  // 整份文件的哈希也要留着：一份 QA 究竟跑的是哪串字节，事后要说得清。
  assert.match(String(qaReport.artifactSha256), /^[0-9a-f]{64}$/);
});
