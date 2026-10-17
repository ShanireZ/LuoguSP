// 懸停意圖：滑鼠只是路過還是真的停下來看。
//
// 卡片要發網路請求（題目詳情 11–35 KB、記錄列表 4 KB、使用者頁 1–12 KB），所以不能
// mouseenter 就打。停留夠久才算「想看」，離開後留一小段寬限期，讓滑鼠能從錨點移到卡片上
// 而不把卡片收走 —— 否則卡片上的「關注」按鈕永遠點不到。
//
// 純狀態機：定時器由外部注入，可用假時鐘測。

const DEFAULT_OPEN_DELAY_MS = 300;
const DEFAULT_CLOSE_GRACE_MS = 160;

export function createHoverIntent(config) {
  const {
    clock,
    openDelayMs = DEFAULT_OPEN_DELAY_MS,
    closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
    onOpen,
    onClose,
  } = config || {};
  if (
    !clock ||
    typeof clock.setTimeout !== "function" ||
    typeof clock.clearTimeout !== "function"
  )
    throw new TypeError("Hover intent requires a clock adapter");

  let openTimer = null;
  let closeTimer = null;
  // 當前已打開的目標；null = 關閉狀態。
  let current = null;
  let pendingTarget = null;

  const cancelOpen = () => {
    if (openTimer === null) return;
    clock.clearTimeout(openTimer);
    openTimer = null;
    pendingTarget = null;
  };
  const cancelClose = () => {
    if (closeTimer === null) return;
    clock.clearTimeout(closeTimer);
    closeTimer = null;
  };

  const closeNow = () => {
    cancelOpen();
    cancelClose();
    if (current === null) return;
    const target = current;
    current = null;
    if (typeof onClose === "function") onClose(target);
  };

  return Object.freeze({
    // 指針進入錨點（或進入已打開的卡片本體，此時 target 傳 current 即可）。
    enter(target) {
      if (target == null) return;
      cancelClose();
      // 同一個目標已經開著 → 別重複請求。
      // ★★ 但**必須先把待打開的別的目標掐掉**。canary.15 真機重現過：練習頁的題號是
      //    零間距鋪開的，下一行題號就貼在上一行下沿（實測 A.bottom=193，B.top=193），
      //    而卡片落在 bottom+4 —— 指針從題號挪到卡片，**必然橫穿一個別的題號**。
      //    那一穿會排一個 300ms 的待打開；緊接著指針進了卡片，走 `onOut` 裡
      //    「移到卡片上不算離開」的快路徑**跳過了 leave()**（leave 本來會 cancelOpen），
      //    然後這裡又早退，於是那個待打開活著走完 300ms，把當前卡關掉、換成隔壁那道題。
      //    症狀就是 owner 說的「滑鼠移到卡片過程中卡片就消失」。
      //    修法是一行 cancelOpen()：回到已開著的目標，等於放棄一切別的候選。
      if (current !== null && current === target) {
        cancelOpen();
        return;
      }
      if (pendingTarget === target) return;
      cancelOpen();
      pendingTarget = target;
      openTimer = clock.setTimeout(() => {
        openTimer = null;
        const opening = pendingTarget;
        pendingTarget = null;
        if (opening == null) return;
        // 切到新目標：先關舊的，保證同時只有一張卡。
        if (current !== null && current !== opening) closeNow();
        current = opening;
        if (typeof onOpen === "function") onOpen(opening);
      }, openDelayMs);
    },
    // 指針離開。留寬限期，讓滑鼠能移到卡片上。
    leave() {
      cancelOpen();
      if (current === null) return;
      cancelClose();
      closeTimer = clock.setTimeout(() => {
        closeTimer = null;
        closeNow();
      }, closeGraceMs);
    },
    // 立即打開，不走 300ms 停留。★ 只給一種情況用：塊是被使用者這一次懸停**拉下來的**，
    // 等它載入完，使用者其實已經停了幾百毫秒了 —— 再要求他重新停 300ms，
    // 體感就是「第一次懸停不彈」（owner 報過兩輪）。
    open(target) {
      if (target == null) return;
      cancelOpen();
      cancelClose();
      if (current === target) return;
      if (current !== null) closeNow();
      current = target;
      if (typeof onOpen === "function") onOpen(target);
    },
    // 立即關閉（捲動、路由切換、Esc、功能被卸載）。
    dismiss: closeNow,
    getState: () =>
      Object.freeze({
        open: current !== null,
        target: current,
        pending: pendingTarget,
        waitingToOpen: openTimer !== null,
        waitingToClose: closeTimer !== null,
      }),
  });
}
