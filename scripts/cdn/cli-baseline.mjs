// 發佈 CLI 從「npx 釘死某個精確版本」改成「用全域裝好的那個」（工作區約定，
// 見根 AGENTS.md）。少了精確 pin，就少了一條保證：這個儲存庫發佈的是**不可變**
// CDN 產物，位元組被使用者已安裝指令碼的 `@require #sha256=` 釘死，用一個行為未知的
// wrangler 去傳是不能接受的。
// 所以 `config/cdn.json` 的 `cli.wrangler.minimum` 從「精確版本」改判為
// 「**已驗證可用的下限**」，發佈前實測一次全域版本並做下限斷言，低於下限直接失敗。
// 這與 DpMaster 的全域模型是同一套思路（基線宣告 + 漂移巡檢），只是這裡因為
// 產物不可變，把巡檢換成了發佈路徑上的硬門。

export function parseCliVersion(output) {
  // wrangler 會先打一堆 banner，版本號在 ` ⛅️ wrangler 4.123.0` 這樣的行裡；
  // 取**最後**一個 x.y.z，避免 banner 裡的其它數字（如 compatibility date）搶先。
  const matches = [...String(output).matchAll(/\b(\d+)\.(\d+)\.(\d+)\b/g)];
  if (!matches.length) return null;
  const [, major, minor, patch] = matches[matches.length - 1];
  return `${major}.${minor}.${patch}`;
}

function ordinal(version) {
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ""));
  if (!parsed) return null;
  return parsed.slice(1, 4).map(Number);
}

// 純數值比較，不引依賴：這裡只可能是三段發佈版本號。
export function satisfiesMinimum(actual, minimum) {
  const left = ordinal(actual);
  const right = ordinal(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function assertCliBaseline({ name, output, minimum }) {
  const actual = parseCliVersion(output);
  if (!actual)
    throw new Error(
      `Unable to read the global ${name} version — got: ${String(output)
        .trim()
        .slice(0, 200)}`,
    );
  if (!satisfiesMinimum(actual, minimum))
    throw new Error(
      `The global ${name} is ${actual}, below the verified baseline ${minimum}. ` +
        `Upgrade it (\`pnpm add -g ${name}\`) or lower cli.${name}.minimum in config/cdn.json only after re-verifying a release.`,
    );
  return actual;
}
