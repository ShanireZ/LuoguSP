import { spawn } from "node:child_process";
import { commandInvocation } from "./cdn/command-invocation.mjs";

// 本仓库同时维护 `package-lock.json` 与 `pnpm-lock.yaml`，日常命令用的是 pnpm，
// 而 `.github/workflows/ci.yml` 和 `.cnb.yml` 装依赖跑的都是 `npm ci` ——
// `npm ci` 拒绝与 `package.json` 对不上的 lock。只刷新 pnpm 那一份时，
// git 报干净、本地 pnpm 一切正常，两边 CI 却在**装依赖那一步**就挂，
// 一条 check 都跑不到，日志里也看不出跟改动有什么关系。
// 2026-08-14 的 `feat(qa)` 加 playwright 就这样连挂 5 次 push 没被发现。
// AGENTS.md 早写了「依赖变更必须刷新两个 lockfile」，但没有任何东西强制它。
// 这道门把那次 CI 失败原样搬到本地 `--check` 阶段。

// `--dry-run`：只算不写，`node_modules` 一个字节都不动。
// `--ignore-scripts --no-audit --no-fund`：把与同步无关的噪音和额外请求关掉。
// ★ 别加 `--offline`。实测（2026-08-15）：真正的漂移形态是「package.json 声明了
//   lock 里没有的包」，npm 必须取一次 registry 元数据才能算出 ideal tree 再做
//   同步比对；加了 `--offline` 它先撞 ENOTCACHED 就**走不到** EUSAGE，门虽然
//   还是红的，报错却指向「缓存里没有」这个假方向 —— 正是这次要消灭的误导。
//   反过来，「lock 里多出 package.json 没声明的包」`npm ci` 根本不认为是错，
//   所以这道门量的就是「声明了却没锁上」这一个方向。
// ★ 由此还有一条不显然但很有用的性质，别把它改没了：**绿的那条路不碰网**。
//   lock 对得上时 npm 完全从 lock 建树，registry 打不通也照样返回 0
//   （2026-08-15 用 npm_config_registry=http://127.0.0.1:9/ 实测，565ms 判绿）。
//   断网 + 漂移则落进下面的 unusable 分支：仍然是红的，只是措辞变成「无法验证」。
//   也就是说这道门不会因为没网而误红，`--check` 的离线可用性没被破坏。
export const LOCK_SYNC_ARGS = [
  "ci",
  "--dry-run",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
];

const FIX = "npm install --package-lock-only";

// npm 在 EUSAGE 之后会糊一整页 usage，跟诊断毫无关系，摘要里一行都不要。
function actionableLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/^npm (?:error|warn)\s?/, "").trimEnd())
    .filter(Boolean);
}

export function classifyLockSync({ code, output }) {
  if (code === 0) return null;

  const lines = actionableLines(output);
  const drifted = lines.filter((line) =>
    /^(?:Missing|Invalid|Removed):/.test(line),
  );
  const declaresDrift =
    drifted.length > 0 || lines.some((line) => /\bare in sync\b/.test(line));

  if (declaresDrift)
    return {
      kind: "drift",
      summary: `package-lock.json is out of sync with package.json${
        drifted.length ? ` — ${drifted.join("; ")}` : ""
      }; refresh it with \`${FIX}\` (AGENTS.md: dependency changes must refresh both lockfiles)`,
    };

  // npm 起不来、lock 是坏 JSON、npm 换了行为 —— 照样红（「永远红不了的门等于
  // 没有门」），但措辞必须跟漂移分开，别把人往错方向带。
  return {
    kind: "unusable",
    summary: `unable to verify package-lock.json sync (\`npm ${LOCK_SYNC_ARGS.join(
      " ",
    )}\` exited ${code}): ${lines.slice(0, 3).join(" / ") || "no output"}`,
  };
}

function runNpm(args, { cwd }) {
  const [executable, invocationArgs] = commandInvocation("npm", args);
  return new Promise((resolvePromise) => {
    let output = "";
    let child;
    try {
      child = spawn(executable, invocationArgs, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolvePromise({ code: -1, output: String(error?.message || error) });
      return;
    }
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) =>
      resolvePromise({ code: -1, output: String(error?.message || error) }),
    );
    child.on("close", (code) => resolvePromise({ code: code ?? -1, output }));
  });
}

export async function inspectLockSync({ cwd, run = runNpm } = {}) {
  return classifyLockSync(await run(LOCK_SYNC_ARGS, { cwd }));
}

// 这道门跑的是 `npm ci`，所以它只有在本地与 CI 的 npm 同一个大版本时才是同构的
// —— 否则「本地先红」的承诺就落空了。要求写在 package.json 的 `engines.npm`。
export async function readNpmVersion({ cwd, run = runNpm } = {}) {
  const { output } = await run(["--version"], { cwd });
  return output;
}
