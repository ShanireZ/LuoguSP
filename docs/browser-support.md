---
type: contract
title: Browser support and validation
description: Defines browser policy, fixed build targets and evidence boundaries.
tags: [baseline, browsers, verification]
status: stable
---

# Browser support and validation

baseline.config.json owns runtime classification, feature policy, approved
minimums, downstream browsers, fallbacks and tool snapshots. baseline-targets.mjs
supplies explicit frozen targets to every esbuild browser build.
This document changes none of those values.

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
| pnpm qa:browser | Promoted release dependencies and browser fixture behavior. |
| Manual Luogu checks | Behavior under the observed browser, account and network. |
| Custom-origin checks | Integrity and connectivity of the selected origin only. |

Workspace copy-consistency inputs are optional local tooling, separate from this
public project contract. Report each evidence class, skips and unavailable
observations separately. A local check does not prove real-user traffic,
authenticated behavior or all-browser support.
