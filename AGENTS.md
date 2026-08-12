# AGENTS.md — LuoguSP project guide

See the workspace-wide rules in [`../AGENTS.md`](../AGENTS.md).

LuoguSP is a browser userscript for Luogu. Source modules live under `src/`; `LuoguSP.user.js` is a reproducible loader artifact, and immutable CDN releases live under `cdn/releases/<version>/`.

## Commands

- `npm run check` — reproducible-build check, quality budgets, and the full Node test suite.
- `npm run publish -- --plan --version <version>` — inspect the release plan without changing production.
- `npm run publish -- --version <version>` — build and deploy an immutable CDN release, update all version-bearing files, then stop for real-browser QA.
- `npm run qa:prepare` — prepare the currently promoted userscript for browser injection.

## Release safety

- Never edit or overwrite an existing directory under `cdn/releases/`; release paths and hashed files are immutable.
- Run real-browser QA after `npm run publish` and before commit/push. Verify the deployed custom origin as well as the user-visible Luogu behavior.
- Keep `src/userscript.meta.js`, `LuoguSP.user.js`, `package.json`, `package-lock.json`, the README version badge, CDN manifest, and release reports on one version. The publish script owns this synchronization.
- Push the release commit to both `origin` (GitHub) and `cnb`, verify their branch heads and CI/build results, then create matching annotated tags and releases on both platforms.
- Do not expose authentication tokens, request headers, cookies, or browser storage in logs or committed QA artifacts.

## Product constraints

- Treat Luogu DOM and embedded payloads as external, versioned interfaces: prefer shape checks, fail closed, and add a regression fixture for every compatibility repair.
- On `/user/{uid}/practice`, color only the “尝试过的题目” list. The “已通过的题目” list is already grouped by difficulty and must not be recolored, fetched, or bulk-cached.
- Preserve unrelated user changes and keep generated browser artifacts outside the repository.
