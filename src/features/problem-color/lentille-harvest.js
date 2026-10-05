import { recordDifficultyForHarvest } from "./identity.js";

// 洛谷把每页的服务端数据放在 <script id="lentille-context" type="application/json"> 里，
// 练习页和评测记录列表因此带着整批 pid→难度一起下发，收下来可省掉成百上千次单题请求。
//
// ★ 数据源换过一次：原先读 window._feInstance.currentData，该全局已全站消失。
// ★ 判据按 payload 形状取，不按 URL 匹配。个人页子页从 `#practice` 改成 `/practice` 那次，
//   挂在 URL 上的旧判据整条失效且零征兆——URL 变了，数据形状没变。
//
// 首屏 script 不随 SPA 导航更新；后续页的数据由 native-difficulty-source.js 收取。

const parsedContexts = new WeakMap();

export function readLentilleData(doc = globalThis.document) {
  const element =
    doc && typeof doc.getElementById === "function"
      ? doc.getElementById("lentille-context")
      : null;
  if (!element) return null;
  // ★ 必须按元素和内容缓存：Pipeline 每次扫描都会 harvest()，每次重新解析一份
  //   100KB+ 的 payload 会毁掉性能；而且每次返回新数组会让 Pipeline 的 WeakSet 去重永远落空。
  //   按元素缓存也让受限内容 document.write 出的新文档自然重新解析。
  const text = element.textContent || "null";
  const previous = parsedContexts.get(element);
  if (previous?.text === text) return previous.data;
  let data = null;
  try {
    const context = JSON.parse(text);
    if (context && typeof context.data === "object" && context.data)
      data = context.data;
  } catch (error) {
    // 非 JSON 或被截断的 payload 一律当作没有批量数据。
  }
  parsedContexts.set(element, { text, data });
  return data;
}

// 题目直接摊在 data 下的几种键：
//   /user/{uid}/practice → submitted（裸数组）；passed 已按难度分组展示，刻意忽略
//   /problem/list        → problems（分页容器 { perPage, count, result }）
const DIRECT_PROBLEM_LISTS = ["submitted", "problems"];

// 裸数组与分页容器都收；其它形状一律当作没有批量数据。
function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.result)) return value.result;
  return null;
}

// 返回 { source, problems } 批次：source 用于 Pipeline 侧的 WeakSet 去重，
// problems 产出纯数据，不污染洛谷的原始数组。
export function collectDifficultyBatches(data) {
  if (!data || typeof data !== "object") return [];
  const batches = [];

  // 题目条目本身就是 { pid, difficulty, name, type, … }。
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

  // 评测记录列表：每条记录把题目包在 problem 下。
  // 记录里的高档难度值在新旧编号之间有歧义，映射为 null 后交给 Pipeline 查题目页当前值。
  // 列表页本身不染色（洛谷已原生上色）；这批数据只留给离开该页之后的题号。
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
