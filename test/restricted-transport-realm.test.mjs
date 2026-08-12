import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRestrictedTransportRealm,
} from "../src/features/restricted-content/transport-realm.js";

// 官方前端跑在页面主世界，而用户脚本管理器可能把脚本放进沙箱作用域：
// 2026-08-12 实测 Tampermonkey 即使报告 sandboxMode="raw"，只要用了 @grant，
// window 仍然不是页面的 window，unsafeWindow 才是。包装打错地方不会报错，
// 只会静默失去评论回退与写观察 —— 所以这里必须显式选中页面 realm。
const realmFixture = (tag) => ({
  tag,
  XMLHttpRequest: class {},
  fetch: () => tag,
  Response: class {},
  URL: class {},
  Request: class {},
  Headers: class {},
});

test("the restricted transport binds to the page realm when the script is sandboxed", () => {
  const scriptWindow = realmFixture("script");
  const pageWindow = realmFixture("page");

  const sandboxed = resolveRestrictedTransportRealm({
    scriptWindow,
    pageWindow,
  });
  assert.equal(sandboxed.host, pageWindow);
  assert.equal(sandboxed.sandboxed, true);
  // ★构造器必须同样来自页面 realm：跨 realm 的 Request/Response 会让写适配器失败。
  assert.deepEqual(
    [
      sandboxed.Response,
      sandboxed.URL,
      sandboxed.Request,
      sandboxed.Headers,
    ],
    [pageWindow.Response, pageWindow.URL, pageWindow.Request, pageWindow.Headers],
  );
});

test("the restricted transport stays on the script window when it already is the page", () => {
  const scriptWindow = realmFixture("script");

  const direct = resolveRestrictedTransportRealm({
    scriptWindow,
    pageWindow: null,
  });
  assert.equal(direct.host, scriptWindow);
  assert.equal(direct.sandboxed, false);
  assert.equal(direct.Request, scriptWindow.Request);

  const same = resolveRestrictedTransportRealm({
    scriptWindow,
    pageWindow: scriptWindow,
  });
  assert.equal(same.host, scriptWindow);
  assert.equal(same.sandboxed, false);
});

test("an unusable page realm falls back instead of installing a half-broken transport", () => {
  const scriptWindow = realmFixture("script");

  // 管理器给了 unsafeWindow，但缺构造器（或被隔离得读不到）→ 退回脚本世界。
  for (const pageWindow of [
    { XMLHttpRequest: class {} },
    { ...realmFixture("page"), Request: undefined },
    { ...realmFixture("page"), fetch: "not a function" },
  ])
    assert.equal(
      resolveRestrictedTransportRealm({ scriptWindow, pageWindow }).host,
      scriptWindow,
    );

  assert.equal(
    resolveRestrictedTransportRealm({ scriptWindow: null, pageWindow: null }),
    null,
  );
});
