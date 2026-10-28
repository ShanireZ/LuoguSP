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
- Do not infer favored, voted, canReply or canEdit from public archive counts.
  Follow article-interaction-state.js and account isolation in
  article-interaction-store.js.
- Live public counts may update counters without changing personal state.
  Unknown and confirmed states remain distinguishable.
- Votes, favorites and replies use Luogu same-origin write contracts.
  Observe XMLHttpRequest as well as supported fetch paths; never log live headers
  or cookies.
- Saver workflow/comment-refresh requests update the archive. They do not
  interact as the current Luogu account. Follow task completion and freshness
  signals rather than treating acceptance as refreshed content.
- Keep archived paste fallback read-only; do not invent interaction controls.

The examined protocol baseline includes the
[Luogu Saver article router](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/article.router.ts)
and [paste router](https://github.com/laikit-dev/luogu-saver/blob/898f230b31db6f817d9d0bbcfcc848505eca759c/packages/backend/src/routers/paste.router.ts).
These sources identify an examined revision, not a live-service guarantee.
Validate response shapes and add regression fixtures for compatibility fixes.
