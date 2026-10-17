// 受限文章頁由官方前端在**頁面主世界**執行，而使用者指令碼管理器未必把指令碼放在同一個世界。
// 2026-08-12 在 Tampermonkey 實測：即使指令碼宣告 @sandbox raw、管理器也報告
// sandboxMode="raw"，只要用了 @grant（本指令碼需要 GM_xmlhttpRequest），
// 指令碼拿到的 window 仍然不是頁面的 window —— unsafeWindow 才是。
// 把 fetch / XMLHttpRequest 包裝打在錯誤的 window 上不會報任何錯，只會靜默失去
// 評論退回與官方寫入觀察，外觀和「功能沒做」完全一樣。所以這裡顯式選中頁面 realm，
// 並且連 Request / Response / URL / Headers 一起取自同一個 realm：
// 跨 realm 的 new Request(pageRequest, init) 會失敗，instanceof 也會假陰性。
const REQUIRED_CONSTRUCTORS = ["Response", "URL", "Request", "Headers"];

function usableRealm(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  if (typeof candidate.fetch !== "function") return false;
  if (typeof candidate.XMLHttpRequest !== "function") return false;
  return REQUIRED_CONSTRUCTORS.every(
    (name) => typeof candidate[name] === "function",
  );
}

function describeRealm(host, sandboxed) {
  return Object.freeze({
    host,
    sandboxed,
    Response: host.Response,
    URL: host.URL,
    Request: host.Request,
    Headers: host.Headers,
  });
}

export function resolveRestrictedTransportRealm(config) {
  const { scriptWindow, pageWindow } = config || {};
  if (pageWindow && pageWindow !== scriptWindow && usableRealm(pageWindow))
    return describeRealm(pageWindow, true);
  if (usableRealm(scriptWindow)) return describeRealm(scriptWindow, false);
  return null;
}
