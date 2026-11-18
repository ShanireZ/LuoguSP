// Preserve the native style and give each cloned control its own name and state.
export function createIdeButton(template, label, className, activate) {
  const button = template?.cloneNode(true) ?? document.createElement("button");
  button.textContent = label;
  for (const name of ["title", "aria-label", "aria-labelledby", "aria-disabled"])
    button.removeAttribute(name);
  button.classList.remove("luogusp-ide-batch-btn");
  button.classList.add(className);
  button.disabled = false;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.getAttribute("aria-disabled") !== "true") activate();
  });
  return button;
}

export function createIdeTabControls(ioLayout, selectTab) {
  const tabBar = document.createElement("div");
  tabBar.className = "luogusp-ide-tabbar";
  tabBar.setAttribute("role", "tablist");
  tabBar.setAttribute("aria-label", "测试方式");
  tabBar.innerHTML = `
    <button type="button" role="tab" class="luogusp-ide-tab" id="luogusp-ide-custom-tab" data-tab="custom">自定义测试</button>
    <button type="button" role="tab" class="luogusp-ide-tab" id="luogusp-ide-samples-tab" data-tab="samples">样例测试</button>`;
  const [customTab, samplesTab] = tabBar.children;
  const nativeAttributes = {
    id: ioLayout.id || "luogusp-ide-custom-panel",
    role: "tabpanel",
    "aria-labelledby": customTab.id,
    tabindex: "0",
  };
  const original = Object.entries(nativeAttributes).map(([name, value]) => {
    const previous = ioLayout.getAttribute(name);
    ioLayout.setAttribute(name, value);
    return [name, value, previous];
  });
  const restoreInputAttributes = () => {
    for (const [name, value, previous] of original) {
      if (ioLayout.getAttribute(name) !== value) continue;
      if (previous === null) ioLayout.removeAttribute(name);
      else ioLayout.setAttribute(name, previous);
    }
  };
  customTab.setAttribute("aria-controls", ioLayout.id);
  tabBar.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) selectTab(tab.dataset.tab);
  });
  tabBar.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    let next;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight")
      next = e.target === customTab ? samplesTab : customTab;
    else if (e.key === "Home") next = customTab;
    else if (e.key === "End") next = samplesTab;
    else return;
    e.preventDefault();
    selectTab(next.dataset.tab);
    next.focus();
  });

  const panel = document.createElement("div");
  panel.className = "luogusp-ide-panel";
  panel.id = "luogusp-ide-samples-panel";
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", samplesTab.id);
  panel.tabIndex = 0;
  samplesTab.setAttribute("aria-controls", panel.id);
  return { tabBar, panel, restoreInputAttributes };
}
