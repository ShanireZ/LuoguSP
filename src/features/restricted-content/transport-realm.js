// 受限文章页由官方前端在**页面主世界**运行，而用户脚本管理器未必把脚本放在同一个世界。
// 2026-08-12 在 Tampermonkey 实测：即使脚本声明 @sandbox raw、管理器也报告
// sandboxMode="raw"，只要用了 @grant（本脚本需要 GM_xmlhttpRequest），
// 脚本拿到的 window 仍然不是页面的 window —— unsafeWindow 才是。
// 把 fetch / XMLHttpRequest 包装打在错误的 window 上不会报任何错，只会静默失去
// 评论回退与官方写入观察，外观和「功能没做」完全一样。所以这里显式选中页面 realm，
// 并且连 Request / Response / URL / Headers 一起取自同一个 realm：
// 跨 realm 的 new Request(pageRequest, init) 会失败，instanceof 也会假阴性。
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
