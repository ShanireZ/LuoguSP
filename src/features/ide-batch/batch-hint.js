// 「一鍵測試」按鈕上的一次性提示（「本題無樣例」「頁面已切換」…）。
//
// ★★ 從 `feature.js` 搬出來是為了**能測**。原先它內聯在那邊，而那邊整塊要靠
//   真機 IDE 的 DOM 才跑得起來，於是下面這個缺陷一直沒有守衛：
//
//   舊寫法每次都拿 `btn.textContent` 當「原文案」快照。1500ms 內來第二條提示時，
//   快照存下來的就是**第一條提示本身**，定時器到點後按鈕永遠停在「本題無樣例」
//   這類字樣上，再也變不回「一鍵測試」。提示期間被禁用的只有「一鍵測試」那一枚，
//   而「重新測試」從不禁用 —— 連點兩下就能重現。
//
//   修法：恢復目標是**固定文案**，不是「上一次的 textContent」。
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
      // ★ 重新找一次：提示這 1500ms 裡 Vue 可能已經把按鈕重種過了，
      //   寫回舊節點等於寫進一個已經離開文件的元素。
      const current = findButton();
      if (!current) return;
      current.textContent = label;
      current.disabled = running;
    }, holdMs);
    return true;
  };

  return Object.freeze({ show, cancel, isPending: () => timer !== null });
}
