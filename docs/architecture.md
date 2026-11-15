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
| src/rendering/ | Full and lightweight Markdown renderers. |
| src/app/ | Descriptor contracts and application assembly. |
| src/bootstrap/ | Browser startup and restricted-page loading gate. |
| src/userscript.meta.js | Userscript metadata source. |
| LuoguSP.user.js | Reproducibly generated loader. |
| cdn/releases/ | Immutable versioned payloads and hashes. |

Settings consume shared feature descriptors rather than a second registry.
Keys, storage keys, defaults and cleanup are executable contracts in
test/release-contract.test.mjs. Reproduce before changing them.

Problem ID coloring keeps the page's existing font weight and yields to native
colors. In Academic Mode, record lists and details use each visible record's
own difficulty from the current Lentille page and Luogu's active theme colors.
Other modes leave record coloring and its visibility controls to Luogu.
Lentille's problem recommendations supply their own difficulties. The coloring
observer stays active across in-document navigation, while each route cancels
its abandoned queued lookups. Returning to a visible tab rescans with locally
available difficulty data.

Problem coloring, problem hover cards, and IDE samples share a single
same-origin lookup scheduler and reuse fields from Lentille page responses.
The shared cache holds only fields those features consume and scopes
details by viewer, contest and language. A problem card displays available
fields first and fills in details and the viewer's latest record as they
arrive, retaining focused controls and scroll position. Temporary lookup
failures can retry on reopening, with a two-second cooldown after repeated
failures. A successful empty record list uses the normal cache lifetime.
New or updated data fields can fade in over 125 ms. The initial preview and
navigation controls appear immediately. Reduced motion stops the preview's
loading indicator and skips the field fade. The main settings dialog uses
a 160 ms opacity entrance only when reduced motion is off.
A focused eligible link opens its preview with Alt+Down Arrow. Escape closes
the preview and returns focus to the link. Pointer and keyboard activation resolve links against
the document base and verify the destination against the current origin and
supported routes before loading the preview. Problem card navigation retains
the source link's contest and language. Native void problem anchors continue
to use their visible problem ID. Standalone avatars use the current origin or
Luogu's avatar CDN. User cards reuse observed same-origin user-info XHRs and
display basic information before profile-only fields arrive. Follow and block
requests, pending state, and results use the initiating viewer and target
account. A card from a previously observed viewer cannot start a new action.
IDE batch runs observe mutations in the native output panel after the
matching same-origin submit is acknowledged, until the result, deadline
or cancellation. An output already present at acknowledgement is treated
as the baseline. Luogu's panel does not expose its native run ID.
If a submit may still produce a result after cancellation or timeout,
LuoguSP requires a page reload before starting another batch in that document.
An explicit server rejection releases that restriction.
Each batch captures the source at start. Edits stop later submissions and mark
results from that batch stale. Leaving the IDE removes its batch controls and
restores the native input layout.
The IDE test tabs switch with Left and Right Arrow, Home, and End. Sample
buttons report their expanded state and toggle details with Enter or Space.
The batch summary announces updates, and copy controls appear on keyboard focus.
Output highlighting aligns insertions and deletions within a bounded comparison.

The profile introduction renderer sanitizes author markup before inserting
KaTeX fragments into text nodes. Author CSS and page-scoped identifiers are
discarded, while generated KaTeX styles are retained. Math parsing preserves
code fences, inline code, and link attributes. Each introduction has bounded
formula rendering, and wide output scrolls within the fallback card.
Both fallback modes convert author images with HTTP(S) sources into ordinary
links that open in a new tab without sending a referrer. Relative sources are
resolved against the page base. Even same-origin URLs and Luogu's CDN can
redirect, so the fallback makes no automatic image requests. Unsupported or
credential-bearing sources are represented as alt text or an unavailable label.
The fallback discards alternate sources such as `srcset`.

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
