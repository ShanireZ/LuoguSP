const COPY_ICON_PATH =
  "M192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-200.6c0-17.4-7.1-34.1-19.7-46.2L370.6 17.8C358.7 6.4 342.8 0 326.3 0L192 0zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-64 0 0 16-192 0 0-256 16 0 0-64-16 0z";

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const focused = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText =
    "position:fixed;left:-9999px;top:-9999px;";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand("copy");
  } finally {
    const restoreFocus = document.activeElement === textarea;
    textarea.remove();
    if (restoreFocus && focused?.isConnected) focused.focus({ preventScroll: true });
  }
}

export function makeCopyControls(code) {
  const button = document.createElement("button");
  const status = document.createElement("span");
  const controls = document.createDocumentFragment();
  controls.append(button, status);
  status.className = "luogusp-copy-status";
  status.setAttribute("role", "status");
  button.type = "button";
  button.className = "copy-button";
  button.setAttribute("aria-label", "复制代码");
  button.title = "复制代码";
  button.innerHTML = `<svg class="svg-inline--fa fa-copy copy-icon" data-prefix="fas" data-icon="copy" role="img" viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="${COPY_ICON_PATH}"></path></svg>`;
  let request = 0;
  let reset;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const current = ++request;
    clearTimeout(reset);
    button.classList.remove("copied");
    button.title = "复制代码";
    status.textContent = "";
    let copied = false;
    try {
      copied = await copyText(code.textContent || "");
    } catch { /* The status below reports an unavailable or rejected clipboard. */ }
    if (current !== request || !button.isConnected) return;
    button.classList.toggle("copied", copied);
    status.textContent = button.title = copied ? "已复制" : "复制失败";
    reset = setTimeout(() => {
      status.textContent = "";
      button.classList.remove("copied");
      button.title = "复制代码";
    }, 1800);
  });
  return controls;
}
