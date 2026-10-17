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
    onWrite,
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
  // 官方前端用 axios（adapter 順序 xhr→http→fetch），點贊/收藏/評論寫入實際都走 XHR。
  // 這裡只旁觀已完成的寫請求，不改方法、URL、請求頭、請求體或回應。
  const writePaths = new Set([
    `/article/${lid}/favor`,
    `/article/${lid}/vote`,
  ]);

  class RestrictedReplyXhr {
    constructor() {
      this.native = new NativeXhr();
      this.listeners = new Map();
      this.targetUrl = null;
      this.writeUrl = null;
      this.fallback = null;
      this.completed = false;
      this.aborted = false;
      for (const type of EVENT_TYPES) {
        this[`on${type}`] = null;
        this.native[`on${type}`] = (event) => this.handleNative(type, event);
      }
    }

    reportWrite() {
      const url = this.writeUrl;
      this.writeUrl = null;
      if (!url || typeof onWrite !== "function") return;
      let responseText = "";
      try {
        // responseType 為 json/blob 時讀 responseText 會拋 InvalidStateError。
        const body =
          this.native.responseType && this.native.responseType !== "text"
            ? this.native.response
            : this.native.responseText;
        responseText =
          typeof body === "string"
            ? body
            : body && typeof body === "object"
              ? JSON.stringify(body)
              : "";
      } catch (error) {
        /* 回應體不可讀時按空體處理，個人狀態仍可由請求意圖確認 */
      }
      try {
        onWrite({
          method: "POST",
          url,
          status: this.native.status,
          responseText,
        });
      } catch (error) {
        /* 觀察失敗絕不影響官方寫入本身 */
      }
    }

    handleNative(type, event) {
      if (!this.targetUrl) {
        if (type === "loadend") this.reportWrite();
        return this.emit(type, event);
      }
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
        /* 無法解析的請求按普通 XHR 透傳 */
      }
      // ★ XHR 執行個體是可以重複使用的（同一個物件再 open 一次）。不在這裡復位，
      //   上一次留下的 `completed` 會讓 handleNative 對新請求的所有事件早退，
      //   `fallback` 還會讓 readyState 恆為 4、responseText 恆是上一次的退回體 ——
      //   等於第二次請求徹底啞掉。官方前端走 axios、每次新建執行個體，所以踩不到；
      //   但我們換掉的是**全域** XMLHttpRequest，頁面上任何別的程式碼都可能重複使用。
      this.completed = false;
      this.fallback = null;
      this.aborted = false;
      const verb = String(method).toUpperCase();
      this.targetUrl =
        verb === "GET" &&
        requestUrl?.origin === origin &&
        requestUrl.pathname === repliesPath
          ? requestUrl
          : null;
      this.writeUrl =
        verb === "POST" &&
        requestUrl?.origin === origin &&
        writePaths.has(requestUrl.pathname)
          ? String(rawUrl)
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

  // ★ WebIDL 的介面常數掛在**建構器和原型兩處**（`XMLHttpRequest.DONE` 與
  //   `xhr.DONE` 都必須是 4）。只掛建構器時 `xhr.DONE` 是 undefined，任何寫
  //   `xhr.readyState === xhr.DONE` 的庫都會永遠判假 —— 而我們換掉的是全域物件，
  //   頁面上的第三方程式碼不歸我們挑。兩處都掛，代價三行。
  for (const [name, value] of Object.entries({
    UNSENT: 0,
    OPENED: 1,
    HEADERS_RECEIVED: 2,
    LOADING: 3,
    DONE: 4,
  })) {
    Object.defineProperty(RestrictedReplyXhr, name, { value });
    Object.defineProperty(RestrictedReplyXhr.prototype, name, { value });
  }

  return Object.freeze({ XMLHttpRequest: RestrictedReplyXhr });
}
