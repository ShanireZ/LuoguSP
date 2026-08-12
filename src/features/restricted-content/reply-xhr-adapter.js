const EVENT_TYPES = [
  "readystatechange",
  "loadstart",
  "progress",
  "abort",
  "error",
  "load",
  "timeout",
  "loadend",
];

function fallbackPayload(replies, requestUrl) {
  let list = replies;
  if (requestUrl.searchParams.get("sort") === "time-d")
    list = [...replies].sort((left, right) => right.time - left.time);
  const after = Number(requestUrl.searchParams.get("after"));
  let start = 0;
  if (after) {
    const index = list.findIndex((reply) => reply.id === after);
    start = index >= 0 ? index + 1 : list.length;
  }
  return { replySlice: list.slice(start, start + 20) };
}

export function createRestrictedReplyXhrAdapter(config) {
  const {
    XMLHttpRequest: NativeXhr,
    URL: URLCtor,
    origin,
    lid,
    replies,
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

  class RestrictedReplyXhr {
    constructor() {
      this.native = new NativeXhr();
      this.listeners = new Map();
      this.targetUrl = null;
      this.fallback = null;
      this.completed = false;
      this.aborted = false;
      for (const type of EVENT_TYPES) {
        this[`on${type}`] = null;
        this.native[`on${type}`] = (event) => this.handleNative(type, event);
      }
    }

    handleNative(type, event) {
      if (!this.targetUrl) return this.emit(type, event);
      if (this.completed) return;
      if (type === "abort") {
        this.completed = true;
        this.emit("abort", event);
        this.emit("loadend", event);
        return;
      }
      if (type !== "loadend") return;
      let valid = false;
      if (this.native.status >= 200 && this.native.status < 300) {
        try {
          const payload =
            this.native.responseType === "json" &&
            this.native.response &&
            typeof this.native.response === "object"
              ? this.native.response
              : JSON.parse(this.native.responseText);
          valid = !!payload && Array.isArray(payload.replySlice);
        } catch (error) {
          valid = false;
        }
      }
      if (!valid) {
        const payload = fallbackPayload(replies, this.targetUrl);
        const responseText = JSON.stringify(payload);
        this.fallback = {
          status: 200,
          statusText: "OK",
          responseText,
          response:
            this.native.responseType === "json" ? payload : responseText,
          responseURL: this.targetUrl.href,
        };
      }
      this.completed = true;
      this.emit("readystatechange", event);
      this.emit("load", event);
      this.emit("loadend", event);
    }

    emit(type, sourceEvent) {
      const event = {
        type,
        target: this,
        currentTarget: this,
        lengthComputable: sourceEvent?.lengthComputable || false,
        loaded: sourceEvent?.loaded || 0,
        total: sourceEvent?.total || 0,
      };
      const handler = this[`on${type}`];
      if (typeof handler === "function") handler.call(this, event);
      for (const listener of this.listeners.get(type) || [])
        listener.call(this, event);
    }

    open(method, rawUrl, ...rest) {
      let requestUrl = null;
      try {
        requestUrl = new URLCtor(String(rawUrl), origin);
      } catch (error) {
        /* 无法解析的请求按普通 XHR 透传 */
      }
      this.targetUrl =
        String(method).toUpperCase() === "GET" &&
        requestUrl?.origin === origin &&
        requestUrl.pathname === repliesPath
          ? requestUrl
          : null;
      return this.native.open(method, rawUrl, ...rest);
    }

    send(body) {
      return this.native.send(body);
    }

    abort() {
      this.aborted = true;
      return this.native.abort();
    }

    setRequestHeader(name, value) {
      return this.native.setRequestHeader(name, value);
    }

    overrideMimeType(value) {
      return this.native.overrideMimeType(value);
    }

    getAllResponseHeaders() {
      return this.fallback
        ? "content-type: application/json\r\nx-luogusp-source: saver\r\n"
        : this.native.getAllResponseHeaders();
    }

    getResponseHeader(name) {
      if (!this.fallback) return this.native.getResponseHeader(name);
      if (/^content-type$/i.test(name)) return "application/json";
      if (/^x-luogusp-source$/i.test(name)) return "saver";
      return null;
    }

    addEventListener(type, listener) {
      if (typeof listener !== "function") return;
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event) {
      this.emit(event.type, event);
      return true;
    }

    get readyState() {
      return this.fallback ? 4 : this.native.readyState;
    }
    get status() {
      return this.fallback ? this.fallback.status : this.native.status;
    }
    get statusText() {
      return this.fallback ? this.fallback.statusText : this.native.statusText;
    }
    get responseText() {
      return this.fallback
        ? this.fallback.responseText
        : this.native.responseText;
    }
    get response() {
      return this.fallback ? this.fallback.response : this.native.response;
    }
    get responseURL() {
      return this.fallback
        ? this.fallback.responseURL
        : this.native.responseURL;
    }
    get responseXML() {
      return this.fallback ? null : this.native.responseXML;
    }
    get upload() {
      return this.native.upload;
    }
    get responseType() {
      return this.native.responseType;
    }
    set responseType(value) {
      this.native.responseType = value;
    }
    get timeout() {
      return this.native.timeout;
    }
    set timeout(value) {
      this.native.timeout = value;
    }
    get withCredentials() {
      return this.native.withCredentials;
    }
    set withCredentials(value) {
      this.native.withCredentials = value;
    }
  }

  for (const [name, value] of Object.entries({
    UNSENT: 0,
    OPENED: 1,
    HEADERS_RECEIVED: 2,
    LOADING: 3,
    DONE: 4,
  }))
    Object.defineProperty(RestrictedReplyXhr, name, { value });

  return Object.freeze({ XMLHttpRequest: RestrictedReplyXhr });
}
