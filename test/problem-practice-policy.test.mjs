import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  isProblemAnchorColorable,
} from "../src/features/problem-color/practice-policy.js";

test("practice policy colors attempted problems but skips passed problems", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="l-card">
      <h3>尝试过的题目</h3>
      <div class="problems"><a id="attempted" href="/problem/P1009">P1009</a></div>
    </div>
    <div class="l-card">
      <h3>已通过的题目</h3>
      <div><div class="difficulty">入门</div><div class="problems">
        <a id="passed" href="/problem/P1001">P1001</a>
      </div></div>
    </div>
    <a id="ordinary" href="/problem/P1000">P1000</a>
  </body>`);

  const { document } = dom.window;
  const path = "/user/52918/practice";
  assert.equal(
    isProblemAnchorColorable(document.querySelector("#attempted"), path),
    true,
  );
  assert.equal(
    isProblemAnchorColorable(document.querySelector("#passed"), path),
    false,
  );
  assert.equal(
    isProblemAnchorColorable(document.querySelector("#ordinary"), path),
    false,
  );
  assert.equal(
    isProblemAnchorColorable(
      document.querySelector("#ordinary"),
      "/problem/list",
    ),
    true,
  );
});
