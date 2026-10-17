import { recordDifficultyForHarvest } from "./identity.js";

// 洛谷把每頁的伺服器端資料放在 <script id="lentille-context" type="application/json"> 裡，
// 練習頁和評測記錄列表因此帶著整批 pid→難度一起下發，收下來可省掉成百上千次單題請求。
//
// ★ 資料源換過一次：原先讀 window._feInstance.currentData，該全域已全站消失。
// ★ 判據按 payload 形狀取，不按 URL 匹配。個人頁子頁從 `#practice` 改成 `/practice` 那次，
//   掛在 URL 上的舊判據整條失效且零徵兆——URL 變了，資料形狀沒變。
//
// 首屏 script 不隨 SPA 導覽更新；後續頁的資料由 native-difficulty-source.js 收取。

const parsedContexts = new WeakMap();

export function readLentilleData(doc = globalThis.document) {
  const element =
    doc && typeof doc.getElementById === "function"
      ? doc.getElementById("lentille-context")
      : null;
  if (!element) return null;
  // ★ 必須按元素和內容快取：Pipeline 每次掃描都會 harvest()，每次重新解析一份
  //   100KB+ 的 payload 會毀掉效能；而且每次回傳新陣列會讓 Pipeline 的 WeakSet 去重永遠落空。
  //   按元素快取也讓受限內容 document.write 出的新文件自然重新解析。
  const text = element.textContent || "null";
  const previous = parsedContexts.get(element);
  if (previous?.text === text) return previous.data;
  let data = null;
  try {
    const context = JSON.parse(text);
    if (context && typeof context.data === "object" && context.data)
      data = context.data;
  } catch (error) {
    // 非 JSON 或被截斷的 payload 一律當作沒有批量資料。
  }
  parsedContexts.set(element, { text, data });
  return data;
}

// 題目直接攤在 data 下的幾種鍵：
//   /user/{uid}/practice → submitted（裸陣列）；passed 已按難度分組展示，刻意忽略
//   /problem/list        → problems（分頁容器 { perPage, count, result }）
const DIRECT_PROBLEM_LISTS = ["submitted", "problems"];

// 裸陣列與分頁容器都收；其它形狀一律當作沒有批量資料。
function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.result)) return value.result;
  return null;
}

// 回傳 { source, problems } 批次：source 用於 Pipeline 側的 WeakSet 去重，
// problems 產出純資料，不汙染洛谷的原始陣列。
export function collectDifficultyBatches(data) {
  if (!data || typeof data !== "object") return [];
  const batches = [];

  // 題目條目本身就是 { pid, difficulty, name, type, … }。
  for (const key of DIRECT_PROBLEM_LISTS) {
    const list = asList(data[key]);
    if (list && list.length)
      batches.push({ source: list, problems: () => [...list] });
  }

  if (data.problem && typeof data.problem === "object")
    batches.push({ source: data.problem, problems: () => [data.problem] });
  const training = asList(data.training?.problems);
  if (training?.length)
    batches.push({ source: training, problems: () => [...training] });

  // 評測記錄列表：每條記錄把題目包在 problem 下。
  // 記錄裡的高檔難度值在新舊編號之間有歧義，映射為 null 後交給 Pipeline 查題目頁當前值。
  // 列表頁本身不染色（洛谷已原生上色）；這批資料只留給離開該頁之後的題號。
  const records = asList(data.records);
  if (records && records.length)
    batches.push({
      source: records,
      problems: () =>
        records.map((item) => ({
          pid: item && item.problem && item.problem.pid,
          difficulty: recordDifficultyForHarvest(
            item && item.problem && item.problem.difficulty,
          ),
        })),
    });

  return batches;
}
