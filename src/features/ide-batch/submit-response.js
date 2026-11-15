export function readIdeSubmitResponse(xhr) {
  const { status } = xhr;
  // These responses explicitly reject the submit. A timeout or server error
  // can arrive after the server has already queued the run.
  if ([400, 401, 403, 404, 405, 422, 429].includes(status))
    return { status, rejected: true };
  if (status < 200 || status >= 300) return { status };
  try {
    const payload = xhr.responseType === "json" ? xhr.response : JSON.parse(xhr.responseText);
    const data = payload?.data;
    const rid = data?.rid;
    const queued = payload?.status === 200 &&
      ((Number.isSafeInteger(rid) && rid > 0) || (typeof rid === "string" && /^[1-9]\d*$/.test(rid)));
    const inline = Number.isInteger(payload?.status) && payload.status !== 200;
    // The native panel can render the compile log before the loadend listener.
    // The matching response already supplies the verdict and diagnostics.
    if (inline && data?.type === "compile" && data.success === false) {
      return {
        status, accepted: true,
        outputResult: {
          kind: "result", verdict: "CE", output: typeof data.desc === "string" ? data.desc : "",
        },
      };
    }
    if (inline && data?.type === "execute" && typeof data.output === "string" &&
        data.execute && typeof data.execute === "object" && !Array.isArray(data.execute)) {
      return { status, accepted: true, inlineOutput: data.output };
    }
    return { status, accepted: queued };
  } catch {
    return { status };
  }
}
