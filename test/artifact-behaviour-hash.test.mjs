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

// ★★★ 這道門證明「這份產物真的在瀏覽器裡跑過」。放鬆它等於把門拆了 ——
//    所以這一組測試的重點是**反證**：除了 `@description`，改任何一處都必須讓雜湊變。
//    只斷言「改說明不變」是不夠的，那種測試永遠綠。

test("@description 是纯展示文本，改它不影响行为哈希", () => {
  const before = behaviourHashOf(artifact);
  const after = behaviourHashOf(
    artifact.replace(/^\/\/ @description\s.*$/m, "// @description  完全不一样的说明文字"),
  );
  assert.equal(after, before);
  // 但整份檔案的雜湊**是**會變的 —— 這正是當初卡住的原因，別把這條也抹掉。
  assert.notEqual(
    artifact,
    artifact.replace(/^\/\/ @description\s.*$/m, "// @description  完全不一样的说明文字"),
  );
});

// 每一條生效的中繼資料都會改變行為，一條都不許豁免。
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

// 報告裡必須釘著一個像樣的行為雜湊 —— 但**不在這裡斷言它等於當前產物**。
//
// ★★★ 這條邊界是踩出來的：我一開始在這裡斷言「報告的雜湊 == 當前產物的雜湊」，
//    結果把**轉正式版的流程整個堵死**了 —— `pnpm release` 在
//    「activation verification」階段會跑 `node --test`，而那時產物剛被提升到新版本、
//    QA 還沒來得及重跑（重跑 QA 本來就必須在發佈**之後**，因為它注入的是
//    `@require` 指向的已發佈位元組）。於是：不重跑 QA 過不了測試，不發佈又沒法重跑 QA。
//    發佈指令碼對這件事早有安排 —— 它給 `quality.mjs` 傳了 `--skip-browser-qa`，
//    把「QA 是否覆蓋當前產物」這道門**留到發佈之後**再驗。
//    所以那條相等斷言的歸屬是 `scripts/quality.mjs`，不是這裡。
test("真机 QA 报告钉的是一个像样的行为哈希", () => {
  assert.equal(typeof qaReport.behaviorSha256, "string");
  assert.equal(qaReport.behaviorSha256.length, 64);
  assert.match(qaReport.behaviorSha256, /^[0-9a-f]{64}$/);
  // 整份檔案的雜湊也要留著：一份 QA 究竟跑的是哪串位元組，事後要說得清。
  assert.match(String(qaReport.artifactSha256), /^[0-9a-f]{64}$/);
});
