export function readIdeCompilerSettings(actions) {
  const selected = actions?.querySelector(".lang-select > .text");
  const compiler = selected?.textContent.trim();
  if (!compiler || selected.querySelector(".placeholder")) return null;
  const o2 = Array.from(actions.querySelectorAll('input[type="checkbox"]')).find(
    (input) => Array.from(input.labels).some((label) => label.textContent.trim() === "O2"),
  );
  return { compiler, o2: o2?.checked ?? null };
}

export function sameIdeCompilerSettings(expected, actual) {
  return Boolean(actual && expected.compiler === actual.compiler && expected.o2 === actual.o2);
}

export function watchIdeCompilerSettings(readActions, expected, markStale) {
  const actions = readActions();
  if (!actions) return null;
  const check = () => {
    if (!sameIdeCompilerSettings(expected, readIdeCompilerSettings(readActions()))) markStale();
  };
  const observer = new MutationObserver(check);
  observer.observe(actions, { childList: true, subtree: true, characterData: true });
  actions.addEventListener("input", check);
  actions.addEventListener("change", check);
  return () => {
    observer.disconnect();
    actions.removeEventListener("input", check);
    actions.removeEventListener("change", check);
  };
}

export function createIdeSubmissionMatcher(configuration) {
  // The dropdown exposes a label. The first matching native submission supplies
  // the numeric ID. CodeMirror normalizes newlines even when the page's saved
  // source retains CRLF. Bind both exact wire values after the first match.
  let submitted = null;
  const normalizeNewlines = (code) => code.replace(/\r\n?/g, "\n");
  const expectedCode = normalizeNewlines(configuration.source);
  const expectedO2 = configuration.o2 ? "true" : "";
  return (body, sampleInput) => {
    if (typeof body !== "string") return "unmatched";
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return "unmatched";
    }
    if (typeof payload?.input !== "string" || payload.input !== sampleInput) return "unmatched";
    const { code, lang, o2 } = payload;
    if (typeof code !== "string" || o2 !== expectedO2 || !Number.isSafeInteger(lang) || lang <= 0)
      return "configuration-mismatch";
    const sameSource = submitted ? code === submitted.code : normalizeNewlines(code) === expectedCode;
    if (!sameSource || (submitted && lang !== submitted.lang)) return "configuration-mismatch";
    submitted ??= { code, lang };
    return "matched";
  };
}
