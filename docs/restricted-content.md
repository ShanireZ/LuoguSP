---
type: contract
title: Restricted content and interaction boundaries
description: Separates archives, public counts and account-specific state.
tags: [content, api, privacy]
status: stable
---

# Restricted content and interaction boundaries

Implementation lives in src/features/restricted-content/. Treat archive data and
same-origin Luogu interaction as separate sources. Archived read access does not
establish the current account's privileges or personal state.

- Article and paste queries use the configured Saver transport. Public counts can
  be archived snapshots rather than current values.
- The archive ID and payload shape must match the requested article or paste
  before the document is rebuilt.
- Saver comments are optional. Ignore unavailable comment data or an explicit
  mismatch with the article. Skip malformed rows and keep the first usable
  row for each reply ID. The archived reply count uses this filtered list;
  the reply endpoint still prefers valid native Luogu responses.
- Do not infer favored, voted, canReply or canEdit from public archive counts.
  Follow article-interaction-state.js and account isolation in
  article-interaction-store.js.
- The rebuilt article disables the reply form because the scaffold carries
  no current-account permission for that article.
- Live public counts may update counters without changing personal state.
  Unknown and confirmed states remain distinguishable.
- Votes, favorites and replies use Luogu same-origin write contracts.
  Observe XMLHttpRequest and fetch without changing the native response.
  Save votes only when the final Luogu response confirms the requested vote
  and count. Save favorites only when the final response matches the same
  write endpoint and its success format. Show a status message for an
  unconfirmed 2xx response or a confirmed operation whose state could not be
  saved. Never log live headers or cookies.
- Saver workflow/comment-refresh requests update the archive. They do not
  interact as the current Luogu account. Follow task completion and freshness
  signals rather than treating acceptance as refreshed content.
- A newly accepted archive workflow checks for saved content after 3 seconds
  and then backs off to 6- and 12-second intervals. The 45-second deadline
  starts at acceptance and includes time spent reading query responses.
  The deadline and route disposal both cancel in-flight polling.
- Each native scaffold, author, and article-list request has a 15-second
  timeout through response body consumption. Leaving the route cancels pending
  preparation. The scaffold can fall back from ranking to discussion.
- The overlay clears when the native article or paste content mounts.
  Its status follows the Saver lookup, archive wait and native page
  preparation. The indicator is static when reduced motion is set.
  Time labels and action bars can appear later. If native startup has
  not rendered content within 15 seconds after document replacement,
  the page shows a failure message with a link to the original.
- The rebuilt viewport permits zoom. Article archive actions use a
  keyboard-focusable update button and original-page link. Refresh
  progress is announced while focus stays on the user's control.
- Keep archived paste fallback read-only; do not invent interaction controls.

The examined protocol baseline includes the
[Luogu Saver article router](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/article.router.ts)
and [paste router](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/paste.router.ts).
These sources identify an examined revision, not a live-service guarantee.
Validate response shapes and add regression fixtures for compatibility fixes.
