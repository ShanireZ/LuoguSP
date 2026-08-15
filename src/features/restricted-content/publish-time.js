// 洛谷真实发表时间的取值，两个来源按可信与代价排序：
//
//   1. 保存站存档载荷的 `publishTime` —— 上游 laikit-dev/luogu-saver#84 之后自带，
//      跟着我们本来就要发的那次存档查询一起回来，不额外发请求。
//   2. 作者专栏列表现扫出来的 `live.time`（article-live-counts.js）—— 要发若干请求，
//      有 2.5s 预算，扫不到就是没有。
//
// ★ 文章那条路上，两者都有时最终显示的是 live —— article-interaction-state.js 会在
//   合并阶段用 live.time 再覆盖一次。两个都是洛谷给的同一个量，谁赢不影响正确性；
//   这里排 publishTime 在前，是为了 live 扫不到（超时/分页没命中）时仍然有真值。
//
// ★ 两者都没有时返回 null，**绝不**拿入档时间（createdAt）顶替：实测 2l4x53kj
//   入档 2026-01-02、真实发表 2025-10-01，差三个月。调用方拿到 null 就该如实标注
//   「存档时间」（archive-time-label.js），这是铁律「不伪造未知」的一部分。
//
// 上游把列定成 INT UNSIGNED，所以合法值是 [1, 4294967295] 的整数；0 是「洛谷没给值」。
const PUBLISH_TIME_MAX = 4294967295;

// ★ Number(null) === 0 且 Number.isFinite(0) 为真 —— 本项目已经咬过四次，
//   必须先把 null / undefined / 空串挡在外面再转数字。
function publishSeconds(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) &&
    seconds >= 1 &&
    seconds <= PUBLISH_TIME_MAX
    ? seconds
    : null;
}

export function pickPublishTime(archived, live) {
  return (
    publishSeconds(archived ? archived.publishTime : null) ??
    publishSeconds(live ? live.time : null)
  );
}
