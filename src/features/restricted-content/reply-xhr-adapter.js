import { matchesNativeReplyResponse, saverReplyPayload } from "./reply-response.js";

export function createRestrictedReplyXhrAdapter(config) {
  const {
    XMLHttpRequest: NativeXhr,
    URL: URLCtor,
    Event: EventCtor = Event,
    ProgressEvent: ProgressEventCtor = globalThis.ProgressEvent,
    origin,
    lid,
    replies,
    onWrite,
    isActive = () => true,
    getBaseUrl = () => origin,
  } = config || {};
  if (
    typeof NativeXhr !== "function" ||
    typeof URLCtor !== "function" ||
    typeof origin !== "string" ||
    typeof lid !== "string" ||
    !/^[A-Za-z0-9]+$/.test(lid) ||
    !Array.isArray(replies)
  )
    throw new TypeError("Reply XHR adapter configuration is invalid");
  const repliesPath = `/article/${lid}/replies`;
  const writePaths = new Set([`/article/${lid}/favor`, `/article/${lid}/vote`]);

  // Keep the real XHR as the EventTarget. Only a failed reply read needs
  // replacement response data or events.
  class RestrictedReplyXhr extends NativeXhr {
    #request = null;

    constructor(...args) {
      super(...args);
      this.addEventListener("readystatechange", (event) => this.#onReady(event), true);
      for (const type of ["error", "timeout"])
        this.addEventListener(type, (event) => this.#onFailure(event), true);
    }

    open(method, rawUrl, ...options) {
      const previous = this.#request;
      const url = this.#targetUrl(method, rawUrl, options);
      this.#request = url && {
        replyUrl: method.toUpperCase() === "GET" ? url : null,
        writeUrl: method.toUpperCase() === "POST" ? url.href : null,
        checked: false,
        aborting: false,
        fallback: null,
      };
      try {
        return super.open(method, rawUrl, ...options);
      } catch (error) {
        this.#request = previous;
        throw error;
      }
    }

    #targetUrl(method, rawUrl, options) {
      if (!isActive() || typeof method !== "string" ||
        (typeof rawUrl !== "string" && !(rawUrl instanceof URLCtor)) ||
        options[1] != null || options[2] != null) return null;
      try {
        const url = new URLCtor(rawUrl, getBaseUrl());
        if (url.origin !== origin || url.username || url.password) return null;
        const verb = method.toUpperCase();
        if ((verb === "GET" && url.pathname === repliesPath) ||
          (verb === "POST" && typeof onWrite === "function" && writePaths.has(url.pathname))) {
          url.hash = "";
          return url;
        }
      } catch {
        // Leave URL validation to the native open method.
      }
      return null;
    }

    #onReady(event) {
      const request = this.#request;
      if (!request || this.readyState !== this.DONE) return;
      if (request.writeUrl) {
        const url = request.writeUrl;
        request.writeUrl = null;
        this.#reportWrite(url);
      }
      if (!request.replyUrl || request.checked || request.aborting) return;
      if (!super.status) {
        // A network failure fires DONE before error/timeout. Expose the fallback
        // during its replacement DONE event. Explicit abort uses the native one.
        event.stopImmediatePropagation();
        return;
      }
      request.checked = true;
      if (!this.#hasNativeReplies(request.replyUrl))
        this.#setFallback(request);
    }

    #hasNativeReplies(url) {
      if (!matchesNativeReplyResponse(
        url.href, super.responseURL, super.status, super.getResponseHeader("content-type"),
      )) return false;
      try {
        const payload = this.responseType === "json"
          ? super.response
          : JSON.parse(super.responseText);
        return !!payload && Array.isArray(payload.replySlice);
      } catch {
        return false;
      }
    }

    #setFallback(request) {
      const payload = saverReplyPayload(replies, request.replyUrl);
      request.fallback = { payload, text: JSON.stringify(payload) };
    }

    #onFailure(event) {
      const request = this.#request;
      if (!request?.replyUrl || request.checked || request.aborting || this.readyState !== this.DONE) return;
      request.checked = true;
      this.#setFallback(request);
      event.stopImmediatePropagation();
      this.dispatchEvent(new EventCtor("readystatechange"));
      if (this.#request === request && !request.aborting) {
        const progress = { lengthComputable: true, loaded: request.fallback.text.length, total: request.fallback.text.length };
        this.dispatchEvent(ProgressEventCtor
          ? new ProgressEventCtor("load", progress)
          : new EventCtor("load"));
      }
    }

    #reportWrite(url) {
      try {
        const { status, responseType, responseURL } = this;
        let responseText;
        if (!responseType || responseType === "text") responseText = this.responseText;
        else if (responseType === "json" && this.response !== null)
          responseText = JSON.stringify(this.response);
        else if (status === 204 || status === 205) responseText = "";
        onWrite({
          method: "POST",
          url,
          status,
          responseUrl: responseURL,
          contentType: this.getResponseHeader("content-type"),
          responseText,
        });
      } catch {
        // A write observation must leave the original response available.
      }
    }

    abort() {
      const request = this.#request;
      if (request) {
        request.aborting = true;
        request.fallback = null;
      }
      const result = super.abort();
      // Aborting an unsent XHR leaves it OPENED. A later send still needs validation.
      if (request && this.#request === request && this.readyState === this.OPENED)
        request.aborting = false;
      return result;
    }

    get status() {
      return this.#request?.fallback ? 200 : super.status;
    }

    get statusText() {
      return this.#request?.fallback ? "OK" : super.statusText;
    }

    get #isWaitingForReply() {
      const request = this.#request;
      return request?.replyUrl && !request.checked && !request.aborting;
    }

    get #isTextResponse() {
      return this.responseType === "" || this.responseType === "text";
    }

    get responseText() {
      if (!this.#isTextResponse) return super.responseText;
      return this.#request?.fallback?.text ?? (this.#isWaitingForReply ? "" : super.responseText);
    }

    get response() {
      const fallback = this.#request?.fallback;
      if (fallback && this.responseType === "json") return fallback.payload;
      if (fallback || this.#isWaitingForReply) return this.#isTextResponse ? fallback?.text ?? "" : null;
      return super.response;
    }

    get responseXML() {
      return this.#request?.fallback || this.#isWaitingForReply ? null : super.responseXML;
    }

    get responseURL() {
      return this.#request?.fallback ? this.#request.replyUrl.href : super.responseURL;
    }

    getAllResponseHeaders() {
      return this.#request?.fallback
        ? "content-type: application/json\r\nx-luogusp-source: saver\r\n"
        : super.getAllResponseHeaders();
    }

    getResponseHeader(name) {
      if (!this.#request?.fallback) return super.getResponseHeader(name);
      if (/^content-type$/i.test(name)) return "application/json";
      if (/^x-luogusp-source$/i.test(name)) return "saver";
      return null;
    }
  }

  return Object.freeze({ XMLHttpRequest: RestrictedReplyXhr });
}
