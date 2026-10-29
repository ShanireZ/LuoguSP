---
type: architecture
title: Source and release architecture
description: Describes module ownership and immutable release boundaries.
tags: [architecture, source, release]
status: stable
---

# Source and release architecture

| Location | Responsibility |
| --- | --- |
| src/core/ | GET scheduling, routes and lifecycle; no direct browser globals. |
| src/browser/ | Shared browser and DOM helpers. |
| src/features/ | Descriptors, selectors, observers, styling and browser adapters. |
| src/app/ | Descriptor contracts and application assembly. |
| src/entry.js | Browser startup and restricted-page loading gate. |
| src/userscript.meta.js | Userscript metadata source. |
| LuoguSP.user.js | Reproducibly generated loader. |
| cdn/releases/ | Immutable versioned payloads and hashes. |

Settings consume shared feature descriptors rather than a second registry.
Keys, storage keys, defaults and cleanup are executable contracts in
test/release-contract.test.mjs. Reproduce before changing them.

package.json and pnpm-lock.yaml own tooling and dependency resolution.
pnpm build:check rebuilds and compares the loader without replacing the candidate.
pnpm quality:check applies config/quality-budget.json; pnpm test exercises source
behavior and release contracts. Use pnpm check for source changes. Historical
measurements do not establish a new candidate's quality or browser behavior.

The release script synchronizes metadata, loader, package version, all four README
version badges, manifest and generated reports. Its preflight rejects missing or
stale README editions; rollback restores all four. Preserve match/grant/run-at metadata,
update endpoints and pinned @require integrity. Source pushes are separate from
CDN deployment and released-byte browser QA.

Generated publishing, origin and deployment receipts remain local and ignored.
Only the de-identified browser-QA and quality summaries required by the current
release checks remain versioned. Immutable CDN manifests and payloads remain
public; ignoring operator receipts does not replace released-byte validation.

See [browser support](browser-support.md), [restricted content](restricted-content.md)
and [the project guide](../AGENTS.md) for their corresponding contracts.
