// 拿不到洛谷真实发表时间时，那一行显示的其实是**保存站入档时间** ——
// 实测能差三个月（2l4x53kj：入档 2026-01-02，真实发表 2025-10-01）。
// 官方模板把它渲染成「创建时间」（文章）/「发表时间」（剪贴板），等于用存档时间
// 冒充真值，所以要把文案改成它的真实语义。
//
// 适用范围：由 publish-time.js 的 pickPublishTime 决定 —— 取不到真值才改文案。
// 剪贴板此前是「永远」（.cn 上没有任何他人剪贴板发表时间的只读来源 ——
// /paste/{id} 被拦、/user/{uid}/paste 是 404、/paste 只列自己的），
// 保存站上游 laikit-dev/luogu-saver#84 之后存档载荷自带 publishTime，
// 于是剪贴板也可能有真值；存量档案要等保存站那边回填到才会出现。
//
// ★ 幂等：改完文案后原标签就不再出现，重复调用不会二次替换。调用方的定位正则
//   必须同时容忍改后的「存档时间」，否则观察器下一轮会找不到那一行。
const ARCHIVE_LABEL = "存档时间";

export function relabelArchiveTime(elements, label) {
  if (typeof label !== "string" || !label || label === ARCHIVE_LABEL) return 0;
  let changed = 0;
  for (const element of elements || []) {
    if (!element || typeof element.querySelectorAll !== "function") continue;
    const targets = [element, ...element.querySelectorAll("*")];
    for (const node of targets)
      for (const child of node.childNodes || []) {
        // 只改文本节点：整段 textContent 赋值会抹掉兄弟元素。
        if (child.nodeType !== 3) continue;
        const text = child.nodeValue || "";
        if (!text.includes(label)) continue;
        child.nodeValue = text.split(label).join(ARCHIVE_LABEL);
        changed += 1;
      }
  }
  return changed;
}
