import { readIdeSubmitResponse } from "./submit-response.js";

const IDE_SUBMIT_PATH = "/api/ide_submit";

function isIdeSubmitUrl(url) {
  try {
    const target = new URL(url, document.baseURI);
    return target.origin === location.origin && target.pathname === IDE_SUBMIT_PATH;
  } catch {
    return false;
  }
}

export function installIdeSubmitObserver({ currentWaiter, finish }) {
  const rawOpen = XMLHttpRequest.prototype.open;
  const rawSend = XMLHttpRequest.prototype.send;
  const submitRequests = new WeakMap();
  let active = true;
  const forgetRequest = (xhr, request = submitRequests.get(xhr)) => {
    if (!request || submitRequests.get(xhr) !== request) return;
    submitRequests.delete(xhr);
    xhr.removeEventListener("readystatechange", request.onDone);
    if (request.onEnd) xhr.removeEventListener("loadend", request.onEnd);
  };
  const open = function (method, url) {
    forgetRequest(this);
    const waiter = currentWaiter();
    if (!active || !waiter || waiter.attempt.claimed ||
        String(method).toUpperCase() !== "POST" || !isIdeSubmitUrl(url))
      return rawOpen.apply(this, arguments);

    const request = {
      waiter,
      readResult: () => isIdeSubmitUrl(this.responseURL) ? readIdeSubmitResponse(this) : { status: 0 },
      onDone: () => {
        if (this.readyState !== XMLHttpRequest.DONE) return;
        this.removeEventListener("readystatechange", request.onDone);
        if (!request.onEnd || !active || currentWaiter() !== waiter) return;
        const { inlineOutput } = request.readResult();
        if (inlineOutput !== undefined) waiter.confirmOutput(inlineOutput);
      },
    };
    // Native code can paint in readystatechange. Register before open hands
    // control back to it, but wait for send to match the sample body.
    submitRequests.set(this, request);
    this.addEventListener("readystatechange", request.onDone);
    try {
      return rawOpen.apply(this, arguments);
    } catch (error) {
      forgetRequest(this, request);
      throw error;
    }
  };
  const send = function (body) {
    const request = active && submitRequests.get(this);
    const waiter = currentWaiter();
    if (request && request.waiter === waiter && !waiter.attempt.claimed) {
      const { attempt } = waiter;
      const match = attempt.match(body);
      if (match !== "matched") {
        attempt.configurationMismatch ||= match === "configuration-mismatch";
        forgetRequest(this, request);
        return rawSend.apply(this, arguments);
      }
      attempt.claimed = true;
      request.onEnd = () => {
        const result = request.readResult();
        forgetRequest(this, request);
        finish(waiter, result, active);
      };
      this.addEventListener("loadend", request.onEnd, { once: true });
      try {
        return rawSend.apply(this, arguments);
      } catch (error) {
        forgetRequest(this, request);
        throw error;
      }
    }
    if (request && !request.onEnd) forgetRequest(this, request);
    return rawSend.apply(this, arguments);
  };
  XMLHttpRequest.prototype.open = open;
  XMLHttpRequest.prototype.send = send;
  return () => {
    active = false;
    if (XMLHttpRequest.prototype.open === open)
      XMLHttpRequest.prototype.open = rawOpen;
    if (XMLHttpRequest.prototype.send === send)
      XMLHttpRequest.prototype.send = rawSend;
  };
}
