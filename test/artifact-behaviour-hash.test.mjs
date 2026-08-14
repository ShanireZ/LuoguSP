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

// 报告里钉的那个值必须真的对得上当前产物，否则这道门就是摆设。
test("真机 QA 报告钉的行为哈希对得上当前产物", () => {
  assert.equal(typeof qaReport.behaviorSha256, "string");
  assert.equal(qaReport.behaviorSha256.length, 64);
  assert.equal(qaReport.behaviorSha256, behaviourHashOf(artifact));
  // 整份文件的哈希**允许**对不上（说明只改过 @description）；
  // 但报告必须仍然带着它，好让人看出这份 QA 当初跑的是哪份字节。
  assert.equal(typeof qaReport.artifactSha256, "string");
});
