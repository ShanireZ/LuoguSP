// 「一键测试」按钮上的一次性提示（「本题无样例」「页面已切换」…）。
//
// ★★ 从 `feature.js` 搬出来是为了**能测**。原先它内联在那边，而那边整块要靠
//   真机 IDE 的 DOM 才跑得起来，于是下面这个缺陷一直没有守卫：
//
//   旧写法每次都拿 `btn.textContent` 当「原文案」快照。1500ms 内来第二条提示时，
//   快照存下来的就是**第一条提示本身**，定时器到点后按钮永远停在「本题无样例」
//   这类字样上，再也变不回「一键测试」。提示期间被禁用的只有「一键测试」那一枚，
//   而「重新测试」从不禁用 —— 连点两下就能复现。
//
//   修法：恢复目标是**固定文案**，不是「上一次的 textContent」。
export const IDE_BATCH_LABEL = "一键测试";

export function createBatchButtonHint(config) {
  const {
    findButton,
    label = IDE_BATCH_LABEL,
    holdMs = 1500,
    clock = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    },
  } = config || {};
  if (typeof findButton !== "function")
    throw new TypeError("Batch button hint requires a button locator");

  let timer = null;

  const cancel = () => {
    if (timer === null) return;
    clock.clearTimeout(timer);
    timer = null;
  };

  const show = (message, running = false) => {
    const button = findButton();
    if (!button) return false;
    button.textContent = String(message);
    button.disabled = true;
    cancel();
    timer = clock.setTimeout(() => {
      timer = null;
      // ★ 重新找一次：提示这 1500ms 里 Vue 可能已经把按钮重种过了，
      //   写回旧节点等于写进一个已经离开文档的元素。
      const current = findButton();
      if (!current) return;
      current.textContent = label;
      current.disabled = running;
    }, holdMs);
    return true;
  };

  return Object.freeze({ show, cancel, isPending: () => timer !== null });
}
