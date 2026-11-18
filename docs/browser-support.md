---
type: contract
title: Browser support and validation
description: Defines browser policy, fixed build targets and evidence boundaries.
tags: [baseline, browsers, verification]
status: stable
---

# Browser support and validation

baseline.config.json owns runtime classification, feature policy, approved
minimums, downstream browsers, fallbacks and tool snapshots. The `buildBrowser`
function in baseline-targets.mjs applies the frozen targets to every browser
build, including calls made through a callback.
The guard requires a frozen target for Chrome, Edge, Firefox, Safari and iOS
Safari. Build scripts import the shared function. Direct esbuild module imports
in those scripts fail the guard.

The Baseline guard resolves the moving policy query and a dated query for the
last day of the snapshot's calendar quarter. Both must fit the approved
minimums. The dated check uses the same locked browser data as the moving
query. The approval date and 92-day freshness gate still control when a new
snapshot is required.

The runtime is browser-tool. New features are reviewed against Baseline Newly
Available; reproducible output uses explicit targets rather than a moving
calendar query. Policy review includes downstream mobile browsers. Actual support
also depends on Tampermonkey and the available Luogu page APIs.
Baseline does not supply Web API polyfills or establish live-page behavior.

Use shape checks and feature detection for DOM, embedded data and Web APIs.
Fail closed and preserve the original page when optional lazy modules, renderers,
previews or restricted-content features fail.

| Check | What it establishes |
| --- | --- |
| pnpm baseline:check | Queries, approved minimums, frozen targets and consumers. |
| pnpm check | Worktree Baseline, reproducible output, quality and Node tests. |
| pnpm qa:browser | SHA-256 verification of promoted startup dependencies and browser fixture behavior. |
| pnpm qa:browser:local | Offline Chrome/Edge/Chromium fixtures for worktree settings, hover cards, IDE samples, record modes and route cancellation. Set `LUOGUSP_QA_USERSCRIPT` to exercise a local candidate. |
| [Staged stable release](#staged-stable-release) | Offline Chrome/Edge/Chromium fixture for the staged installer, both pinned startup scripts, the pinned profile renderer and its fallback behavior. |
| Manual Luogu checks | Behavior under the observed browser, account and network. |
| Custom-origin checks | Integrity and connectivity of the selected origin only. |

Workspace copy-consistency inputs are optional local tooling, separate from this
public project contract. Report each evidence class, skips and unavailable
observations separately. A local check does not prove real-user traffic,
authenticated behavior or all-browser support.

Released-byte browser QA and the manual `pnpm qa:prepare` helper share the
same startup loader. It verifies both installer pins, refuses redirects and
checks each final HTTPS response and byte digest before decoding or injection.

## Staged stable release

Set `LUOGUSP_STAGED_INSTALLER` to the absolute path of the staged `.user.js`,
`LUOGUSP_STAGED_CDN_ROOT` to the absolute path of the staged CDN deployment
directory containing `releases/`, and `LUOGUSP_EXPECTED_VERSION` to the stable
version being verified. Run the fixture from the repository root.

```sh
node --test scripts/qa/staged-release-regressions.mjs
```

The fixture runs the two `@require` files and the loader at document start in
metadata order. It intercepts the runtime's renderer GET and exercises both the
exact staged response and a response with a mismatched digest. The synthetic
profile tests native click handling, author CSS, automatic image requests, math,
and link behavior. Tampermonkey execution and CDN publication require separate
verification.
