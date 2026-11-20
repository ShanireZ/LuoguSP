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
An interrupted save attempts to restore the earlier preferences. The dialog
shows the values still stored and announces that the save failed.
Backdrop dismissal during a same-route navigation remount returns focus to the
replacement settings entry when focus still belongs to the dismissed overlay.

Problem ID coloring keeps the page's existing font weight and yields to native
colors. In Academic Mode, record lists and details use each visible record's
own difficulty from the current Lentille page and Luogu's active theme colors.
Other modes leave record coloring and its visibility controls to Luogu.
Record-list updates reconsider the neighboring problem cell when its status
link appears, changes, or is removed. Owned colors track the link destination
and the record ID where applicable. Reusing a link for a contest or language
scope clears its previous paint before any lookup for the new destination.
Lentille's problem recommendations supply their own difficulties. The coloring
observer stays active across in-document navigation, while each route cancels
its abandoned queued lookups. Returning to a visible tab rescans with locally
available difficulty data.

Problem coloring, problem hover cards, and IDE samples share a single
same-origin lookup scheduler and reuse fields from Lentille page responses.
Direct reads reject redirects and require an exact HTTP 200 response at the
requested URL. The shared detail lookup accepts JSON and native HTML. Hover
fallbacks and supplemental reads require JSON. Responses with invalid provenance
leave the already available preview fields in place.
Passive native XHR observations require HTTP 200, JSON media and the original
same-origin request URL, including its query. They compare against the URL
resolved from the document base with the fragment removed and leave native
events intact. If viewer metadata or observation setup is unusable, the native
request proceeds. A rejected reopening leaves the current request observed.
When a load handler reuses an XHR, completion of the previous request leaves
the new observation active until the new request finishes. A terminal reset
to UNSENT settles prepared reads without using the cleared response.
The shared cache holds only fields those features consume and scopes
details by viewer, contest and language. Each observed field expires on its own
and a partial response refreshes only the fields it contains. Shared detail
responses use the start time of the successful transport attempt. Coloring
compares observations per problem and scope. Native observations with the same
timestamp use send order and take precedence over supplemental lookups started
in that tick. Native Lentille GETs, including record lists, take their timestamp
and sequence at `send()`. A late native batch can still refresh a problem absent
from a newer batch. A native response, preview or IDE detail can refresh
eligible IDs. Observed Lentille viewer changes discard harvested colors.
Both Lentille and legacy viewer changes discard shared problem data and
invalidate pending details and record lookups from the previous context.
Passive native detail and record requests use the legacy viewer context
observed at send time. Native Lentille claims retain their send-order checks.
Confirming the existing viewer keeps that context. Returning after a change
starts a fresh context.
IDs without current data lose the old LuoguSP paint and use the existing fallback.
Newer summary fields stay visible when a subsequent detail omits them. A caller
can retry for fields it still needs. An explicit empty sample list is cached as a
result.
A problem card displays
available fields first and fills in details and the viewer's latest record as they
arrive, retaining focused controls and scroll position. Native observations
and fallback reads are compared by send time in the open preview. Native
observations take precedence at equal times, including confirmed empty lists.
An open preview retains its latest record observation if other lookups evict
that entry from the bounded shared cache. Outstanding native record requests
retain the latest same-scope ordering stamp until they settle. Successful
record reads use the shared cache and supersede earlier terminal results and
retry cooldowns for their scope, so reopening after eviction can issue a fresh lookup. An
observed viewer change dismisses open previews, restores owned keyboard
focus, and releases their pending reads. A relationship action already sent
settles for its initiating account.
If a detail removes a
focused tag disclosure, focus moves to the problem link. When a data update or
viewport change clips a focused action or the tags control, the card scrolls
just enough to reveal it, while document scroll stays in place. Temporary lookup
failures can retry on reopening, with a two-second cooldown after repeated
failures. A successful empty record list uses the normal cache lifetime.
New or updated data fields can fade in over 125 ms. The initial preview and
navigation controls appear immediately. Reduced motion stops the preview's
loading indicator and skips the field fade. The main settings dialog fades in its
shadow over 160 ms only when reduced motion is off. Text and controls stay
opaque throughout. Its content scrolls within the available viewport, and the
dialog takes precedence over previews.
Both settings and refresh confirmation track the visual viewport's size and
offset during zoom and pan. Resizing keeps the focused control visible through
immediate scrolling. Closing either overlay removes its viewport listeners.
Without VisualViewport, the existing fixed layout remains available.
The enabled primary action labels and the settings save/reload hint use at
least 4.5:1 text contrast.
If native navigation replaces its settings entry on the same route, focus may
return to the replacement when the entry or dialog owned focus.
A focused eligible link opens its preview with Alt+Down Arrow. Escape closes
the preview and returns focus to the link when the preview holds focus. Tab at
either end closes the preview and continues from the link's place in the page.
Pointer or scroll dismissal also restores focus if it was still in the preview.
Pointer and keyboard activation resolve links against
the document base and verify the destination against the current origin and
supported routes before loading the preview. Problem card navigation retains
the source link's contest and language. Problem discussion links with a single
forum ID and a matching visible problem ID open the corresponding problem preview.
The original discussion link retains its destination. Native void problem anchors continue
to use their visible problem ID. Standalone avatars use the current origin or
Luogu's avatar CDN. User cards reuse observed same-origin user-info XHRs and
display basic information before profile-only fields arrive. They retry transient
profile failures on reopening, with bounded requests and per-account cache keys.
Direct user-info and profile reads enforce same-origin requests and reject
redirects. Before decoding, each response must match its requested URL and JSON
media type. Successful reads require HTTP 200. Invalid provenance retries on
reopening while available fields from the other branch remain visible.
Late signature updates retain the existing disclosure button and expansion
state. Unbroken text wraps within the preview. Expanded text can scroll within
the card. Placement records the scroll position before width and signature
measurement, then restores it within the resulting scroll range. It keeps the
focused disclosure within the scrollport during expansion, collapse and
viewport changes. The preview remeasures its
two-line fit after a width change. The button reports its expanded state.
When the signature fits within two lines, the
disclosure collapses and hides. Focus held on that button returns to the
user-name link. Focus on another control stays with that control.
The preview replaces the native user card after the optional feature has mounted.
User previews load avatar and cover media from allowed HTTPS origins without
credentials or a referrer, and use a local visual fallback if loading fails.
Follow and block
requests, pending state, and results use the initiating viewer and target
account. A card from a previously observed viewer cannot start a new action.
The relation write requires a same-origin JSON 200 response from its exact
endpoint with Luogu's `_empty: true` acknowledgement. An unconfirmed write
restores the card state and reports the failure in that preview. Follower
counts stay hidden until available and change optimistically only when known.
Block confirmation focuses Cancel first. Cancelling restores the block button.
While a focused relation action is pending, the card holds its focus. Success
and failure restore the corresponding button if focus is still held there.
An inline compile failure supplies the CE verdict and diagnostics directly from
the matching same-origin submit response. For inline execution, the submit
observer registers at XHR open and arms only after checking the POST body. At
DONE it reads the response before the native handlers registered after open
can paint the verdict, and checks the displayed output against the response.
Queued runs observe native output mutations after acknowledgement. Each observer waits
until a result, deadline or cancellation. Luogu's panel does not expose its
native run ID.
If a submit may still produce a result after cancellation or timeout,
LuoguSP requires a page reload before starting another batch in that document.
An explicit server rejection releases that restriction.
Each batch captures the source, compiler selection and O2 setting at start.
Changes to any of them stop later submissions and mark the batch results stale.
The submit observer matches the native POST body to the captured source, sample
input and O2 setting. The submitted source and language ID stay the same across
all samples, including when CodeMirror displays saved source with normalized line
endings. Leaving the IDE removes its batch controls and restores the native input
layout.
The IDE test tabs switch with Left and Right Arrow, Home, and End. Sample
buttons report their expanded state and toggle details with Enter or Space.
Preparation hints announce the outcome and keep the toolbar control focusable
while activation is temporarily unavailable. A replacement toolbar keeps the
current hint through its original deadline.
Starting a batch moves focus from its disabled controls to Stop. If Stop still
owns focus when it becomes disabled, focus moves to the Samples tab. Completion
restores the initiating control or another available batch control only while
the batch still owns focus.
Replacing the native input/output layout on the same route discards the old
results. It invalidates an active batch and announces the interruption. The
replacement controls recover focus when LuoguSP lost its focused control
during the replacement.
The batch summary announces updates, and copy controls appear on keyboard focus.
Output highlighting aligns insertions and deletions within a bounded comparison.

The profile introduction renderer sanitizes author markup before inserting
KaTeX fragments into text nodes. Author CSS and page-scoped identifiers are
discarded, while generated KaTeX styles are retained. Math parsing preserves
code fences, inline code, and link attributes. Each introduction has bounded
formula rendering, and wide output scrolls within the fallback card.
Each render uses a fixed-length cryptographic nonce to isolate placeholders
from author text, including characters decoded by Markdown or HTML. Marker
selection does not rescan author input or enlarge the rendering expressions.
Without secure random values, custom rendering fails closed through its retry UI.
Fallback introduction fetches require exact same-origin JSON HTTP 200 responses
and reject redirects before following or decoding them. Embedded introductions
and native attachment retain their existing identity checks.
The retry control stays focusable while rendering and ignores duplicate activation.
A live status announces loading, failure and completion. Successful retry moves
focus to the introduction heading only when the retry still holds focus; focus
on another control and route cancellation take precedence.
Both fallback modes convert author images with HTTP(S) sources into ordinary
links that open in a new tab without sending a referrer. Relative sources are
resolved against the page base. Linked Markdown images preserve the outer link
and provide a separate image link. The lightweight renderer uses the shared
inline link grammar for destinations and titles, including balanced parentheses,
path-relative destinations, fragments and document reference definitions.
Definitions in quotes and lists can supply destinations without appearing in
the output. Both modes omit definition-only list rows and retain genuine empty
items and later ordered-list positions. Lite preserves continued and loose items
and nested list and quote structure. The sanitizer permits explicit item
values on list items. Full and Lite recognize complete display math blocks after
prose, including within quotes, and use the same math-rendering callback and
sanitization. Complete inline code and link titles stay literal within tight
list items and across consecutive tentative formula blocks. The tokenizer
bounds its lookahead and keeps ordinary prose together up to a real block
boundary. Apparent ordered markers, including 1., stay inline when verified
inside a literal, including with an indented closing line. A child list's
indented formula remains in that list when a stray parent backtick would
pair with the opener of a later complete code span. Disambiguation includes
ordinary continuation lines within the local paragraph and keeps separate
blocks outside the probe. Recovered literals compose with
split closing anchor tags. A literal delimiter stays inside its inline token
even when the next delimiter starts a real formula. Lite parses inline content within
each block and keeps the literal text of code spans and fenced code. It reads
escaped attributes once and applies its HTTP(S) URL policy to Markdown links
and supported raw HTML anchors. In both modes, line
breaks in a supported closing anchor tag leave following text outside the
link. Code, titles and image alternative text keep literal tag-shaped characters.
Even same-origin URLs and Luogu's CDN can
redirect, so the fallback makes no automatic image requests. Unsupported or
credential-bearing sources are represented as alt text or an unavailable label.
The fallback discards alternate sources such as `srcset`.
Code-copy controls clear prior feedback as soon as another write begins.
Only the latest write can set its outcome, which is announced without moving
focus. Pending writes retain the normal button title and appearance.

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
Before replacing a staging directory, the CDN preparer resolves its existing
parent and destination, including Windows junctions. It rejects paths that
overlap the release source tree. Staging accepts only the verified release and
channel files. On fresh and resumed releases, the high-level publisher checks
the staged startup pin count and the raw and gzip sizes of the verified startup
files and every declared optional bundle against config/quality-budget.json.
The low-level publisher applies the same budgets to its selected snapshot before
any origin request or Wrangler command. The budget applies to the selected
candidate. Retained releases still follow the historical integrity checks.
The startup runtime embeds each optional bundle's release-relative asset stem,
SHA-256 and API version. It reconstructs the immutable filename from the release
and digest. The manifest carries the full paths and metadata for release checks.
If a candidate exceeds a budget, review the measured size and the approved
limit before retrying. A fresh high-level attempt follows pre-deployment rollback.
A resumed attempt keeps its checkpoint and any earlier confirmed outcome.
The low-level publisher checks the configured origin, candidate version and
staged files before deploying. It gives Wrangler a private asset
snapshot and retains that snapshot through provider execution and verification.
Post-deployment verification uses the snapshot's channel and manifest bytes.
The publisher checks each eligible release's public manifest before invoking
Wrangler. The requested version may return HTTP 404 or its exact manifest bytes.
Other versions enter the deployment snapshot only when their public manifest
matches. A missing committed release manifest or a conflicting response blocks
deployment. Unpublished local builds keep their own bytes and channel selection.
Both CDN verification gates reject redirects and require HTTP 200 from the
requested URL before reading and verifying its bytes. Readiness requires the
same SHA-256 for the hashed manifest and the exact `releases/<version>/manifest.json`
URL used by the next publication's preflight. The provider receipt saves
retained manifest pins from the verified deployment snapshot. Both gates
also verify the fixed manifest URL for every retained release in that
inventory. The production gate requires the current provider attempt's
receipt before local promotion. Standalone checks with no matching inventory
receipt cover the requested release and record the absence of history
coverage. A failed readback blocks readiness while keeping provider
confirmation.
The CDN builder finishes compilation before claiming a version directory.
Handled write failures clean up that build's directory. A successful build
returns its directory identity, manifest digest and channel transition to the
publisher. Before deployment, rollback removes a release only while its
identity and verified contents still match that receipt. Channel updates and
rollback share a short exclusive file lock and atomic replacement. Rollback
restores the channel captured at the build's own update only if its current
bytes still match and the previous target remains valid. Changed output or an
unavailable previous target causes the complete release to be retained.
Both publisher entry points share an exclusive local lock through provider
execution and final verification. The high-level publisher also holds it during
production snapshots and local promotion. Its deployment child verifies that
its parent owns the lock and that the captured channel matches the checkpoint.
The high-level publisher rejects production file drift before deployment and
again before promotion. Each promotion uses atomic replacement after an
unchanged-byte check. Rollback restores only files whose current bytes still
match this transaction's promoted bytes. Concurrent
changes are retained and listed in the local report as a partial restoration.
If one production path cannot be read during rollback, the publisher records
it as retained and continues restoring the other owned paths.
Quality writes to a transaction-specific temporary report before promotion.
The lock serializes cooperating publishers. Other editors can still change a
file during the final filesystem compare-and-replace operation.

### Interrupted publication

The high-level publisher saves a local checkpoint with the captured channel
before it invokes the deployment subprocess. A same-version retry verifies the
existing release and uses the checkpoint's channel and manifest pin. This keeps
another build's local channel selection intact. An unresolved checkpoint blocks
the high-level publisher from starting a different release. If a busy channel
lock interrupts pre-deployment rollback, the blocked checkpoint also saves the
build's directory identity. The same checkpoint is available when rollback
verifies the current release but its captured predecessor is no longer valid.
Let any channel owner finish, then retry the same version with
`pnpm release -- --version <version>`. The retry checks that the
directory still belongs to the recorded build and re-verifies its immutable
bytes against the current source and captured manifest pin. A retry requires
version files that still agree on the previous stable release. The deployment
attempt records `not-attempted` during preflight, `outcome-unknown` before
invoking Wrangler and `confirmed` after Wrangler returns success. The report
lists an origin in `deployedOrigins` only after provider confirmation. Origin
verification has its own results. If interruption occurred before the first
checkpoint or during local promotion, reconcile the release and production
files against the report and Git before retrying.

Before recovering a lock, confirm that the interrupted command and its child
processes, including Wrangler, have exited. For a local owner record, run
`node scripts/cdn/recover-lock.mjs publish` for the publisher or
`node scripts/cdn/recover-lock.mjs channel` for a channel update. Recovery
checks the recorded host and PID and preserves locks with an active or
unverifiable owner. For an empty legacy lock or an interrupted recovery marker,
verify that all cooperating commands have stopped before removing the exact
stale entry. The paths are `reports/publish.lock` and
`cdn/channels/canary.json.lock` with a `.recovery` suffix on the markers.

Generated publishing, origin and deployment receipts remain local and ignored.
Only the de-identified browser-QA and quality summaries required by the current
release checks remain versioned. Immutable CDN manifests and payloads remain
public; ignoring operator receipts does not replace released-byte validation.

See [browser support](browser-support.md), [restricted content](restricted-content.md)
and [the project guide](../AGENTS.md) for their corresponding contracts.
