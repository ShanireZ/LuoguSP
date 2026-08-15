import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCliBaseline,
  assertCliMajor,
  parseCliVersion,
  satisfiesMinimum,
} from "../scripts/cdn/cli-baseline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "config", "cdn.json"), "utf8"),
);

// wrangler --version 的真实输出（2026-08-15 本机实测）：版本号前面还有 banner。
const REAL_WRANGLER_VERSION_OUTPUT = `
 ⛅️ wrangler 4.123.0
───────────────────
`;

test("版本号从 wrangler 的 banner 输出里读得出来", () => {
  assert.equal(parseCliVersion(REAL_WRANGLER_VERSION_OUTPUT), "4.123.0");
  assert.equal(parseCliVersion("1.6.26"), "1.6.26");
  assert.equal(parseCliVersion("no version here"), null);
});

test("下限比较逐段按数值走，不是字符串序", () => {
  assert.equal(satisfiesMinimum("4.107.0", "4.107.0"), true, "相等即满足");
  assert.equal(satisfiesMinimum("4.123.0", "4.107.0"), true);
  // ★ 字符串比较会把 "4.99.0" 判成大于 "4.107.0"（"9" > "1"），逐段数值不会。
  assert.equal(satisfiesMinimum("4.99.0", "4.107.0"), false);
  assert.equal(satisfiesMinimum("3.200.0", "4.107.0"), false);
  assert.equal(satisfiesMinimum("4.107.1", "4.107.0"), true);
  assert.equal(satisfiesMinimum("garbage", "4.107.0"), false);
});

// ★★★ 反证：这道门顶替的是原来那个精确 pin。只断言「够新时放行」永远绿 ——
//    要钉死的是「太旧必须拦下，而且要说清楚怎么办」。
test("全局 CLI 低于已验证下限必须拦下并给出修法", () => {
  assert.throws(
    () =>
      assertCliBaseline({
        name: "wrangler",
        output: " ⛅️ wrangler 4.99.0",
        minimum: "4.107.0",
      }),
    (error) => {
      assert.match(error.message, /4\.99\.0/);
      assert.match(error.message, /4\.107\.0/);
      assert.match(error.message, /pnpm add -g wrangler/);
      return true;
    },
  );

  // 读不出版本号也必须失败，不许当作「大概没事」放过去。
  assert.throws(
    () =>
      assertCliBaseline({
        name: "wrangler",
        output: "command not found",
        minimum: "4.107.0",
      }),
    /Unable to read the global wrangler version/,
  );

  assert.equal(
    assertCliBaseline({
      name: "wrangler",
      output: REAL_WRANGLER_VERSION_OUTPUT,
      minimum: "4.107.0",
    }),
    "4.123.0",
  );
});

test("cdn.json 把 wrangler 基线声明成下限，而不是精确版本", () => {
  assert.deepEqual(Object.keys(config.cli), ["wrangler"]);
  assert.deepEqual(Object.keys(config.cli.wrangler), ["minimum"]);
  assert.match(config.cli.wrangler.minimum, /^\d+\.\d+\.\d+$/);
});

// ★ npm 的要求是「与 CI 同一个大版本」，用 assertCliMajor 而不是下限。
//   为什么不交给 npm 自己的 devEngines：`actions/setup-node` 装完 Node 会立刻
//   在仓库目录调一次 npm（用镜像自带的版本），devEngines 会在「Set up Node」
//   那一步就 EBADDEVENGINES，升级步骤根本轮不到跑 —— 2026-08-15 连挂两次实测。
test("npm 大版本对不上必须拦下，并说清两边怎么改", () => {
  assert.equal(
    assertCliMajor({ name: "npm", output: "12.0.2", range: "^12" }),
    "12.0.2",
  );
  assert.throws(
    () => assertCliMajor({ name: "npm", output: "11.19.0", range: "^12" }),
    (error) => {
      assert.match(error.message, /11\.19\.0/);
      assert.match(error.message, /\^12/);
      assert.match(error.message, /pnpm add -g npm@12/);
      assert.match(error.message, /ci\.yml/);
      return true;
    },
  );
  // 下限语义会把 11.19.0 判成「够老但可接受」，这里刻意不是那个语义。
  assert.throws(
    () => assertCliMajor({ name: "npm", output: "13.0.0", range: "^12" }),
    /requires \^12/,
  );
  // 要求本身写错也要立刻炸，不许静默放行。
  assert.throws(
    () => assertCliMajor({ name: "npm", output: "12.0.2", range: ">=12" }),
    /must be written as \^<major>/,
  );
});

// 门必须真的挂在 --check 上。
test("quality.mjs 的 --check 真的断言了 npm 大版本", () => {
  const quality = fs.readFileSync(path.join(root, "scripts", "quality.mjs"), "utf8");
  assert.match(quality, /assertCliMajor/);
  assert.match(quality, /engines\?\.npm|engines\.npm/);
});
