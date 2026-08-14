// 悬停意图：鼠标只是路过还是真的停下来看。
//
// 卡片要发网络请求（题目详情 11–35 KB、记录列表 4 KB、用户页 1–12 KB），所以不能
// mouseenter 就打。停留够久才算「想看」，离开后留一小段宽限期，让鼠标能从锚点移到卡片上
// 而不把卡片收走 —— 否则卡片上的「关注」按钮永远点不到。
//
// 纯状态机：定时器由外部注入，可用假时钟测。

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
  // 当前已打开的目标；null = 关闭状态。
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
    // 指针进入锚点（或进入已打开的卡片本体，此时 target 传 current 即可）。
    enter(target) {
      if (target == null) return;
      cancelClose();
      // 同一个目标已经开着 → 别重复请求。
      // ★★ 但**必须先把待打开的别的目标掐掉**。canary.15 真机复现过：练习页的题号是
      //    零间距铺开的，下一行题号就贴在上一行下沿（实测 A.bottom=193，B.top=193），
      //    而卡片落在 bottom+4 —— 指针从题号挪到卡片，**必然横穿一个别的题号**。
      //    那一穿会排一个 300ms 的待打开；紧接着指针进了卡片，走 `onOut` 里
      //    「移到卡片上不算离开」的快路径**跳过了 leave()**（leave 本来会 cancelOpen），
      //    然后这里又早退，于是那个待打开活着走完 300ms，把当前卡关掉、换成隔壁那道题。
      //    症状就是 owner 说的「鼠标移到卡片过程中卡片就消失」。
      //    修法是一行 cancelOpen()：回到已开着的目标，等于放弃一切别的候选。
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
        // 切到新目标：先关旧的，保证同时只有一张卡。
        if (current !== null && current !== opening) closeNow();
        current = opening;
        if (typeof onOpen === "function") onOpen(opening);
      }, openDelayMs);
    },
    // 指针离开。留宽限期，让鼠标能移到卡片上。
    leave() {
      cancelOpen();
      if (current === null) return;
      cancelClose();
      closeTimer = clock.setTimeout(() => {
        closeTimer = null;
        closeNow();
      }, closeGraceMs);
    },
    // 立即关闭（滚动、路由切换、Esc、功能被卸载）。
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
