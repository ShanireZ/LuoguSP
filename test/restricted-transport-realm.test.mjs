import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRestrictedTransportRealm,
} from "../src/features/restricted-content/transport-realm.js";

// 官方前端跑在頁面主世界，而使用者指令碼管理器可能把指令碼放進沙箱作用域：
// 2026-08-12 實測 Tampermonkey 即使報告 sandboxMode="raw"，只要用了 @grant，
// window 仍然不是頁面的 window，unsafeWindow 才是。包裝打錯地方不會回報錯誤，
// 只會靜默失去評論退回與寫觀察 —— 所以這裡必須顯式選中頁面 realm。
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
  // ★建構器必須同樣來自頁面 realm：跨 realm 的 Request/Response 會讓寫適配器失敗。
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

  // 管理器給了 unsafeWindow，但缺建構器（或被隔離得讀不到）→ 退回指令碼世界。
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
