# AGENTS.md — LuoguSP project guide

See the workspace-wide rules in [`../AGENTS.md`](../AGENTS.md).

LuoguSP is a browser userscript for Luogu. Source modules live under `src/`; `LuoguSP.user.js` is a reproducible loader artifact, and immutable CDN releases live under `cdn/releases/<version>/`.

## Commands

- `pnpm run check` — reproducible-build check, quality budgets, and the full Node test suite.
- `pnpm release -- --plan --version <version>` — inspect the release plan without changing production.
- `pnpm release -- --version <version>` — build and deploy an immutable CDN release, update all version-bearing files, then stop for real-browser QA (`publish` remains a compatibility alias).
- `pnpm run qa:prepare` — prepare the currently promoted userscript for browser injection.
- `pnpm run qa:browser` — reproducible real-browser QA; writes `reports/browser-qa.json`. It exercises the **promoted artifact** (the bytes its two `@require` URLs point at), not the working tree, so run it **after** a release, not before. Prefers the system Chrome/Edge; falls back to Playwright's bundled Chromium.

## Release safety

- Never edit or overwrite an existing directory under `cdn/releases/`; release paths and hashed files are immutable.
- The deploy CLI is the **globally installed** `wrangler` (workspace convention, see [`../AGENTS.md`](../AGENTS.md)), not a version pinned through `npx`. Because releases are immutable and byte-pinned by `@require #sha256=`, `scripts/cdn/publish.mjs` measures the global CLI first and fails closed below `cli.wrangler.minimum` in `config/cdn.json` — that value is a **verified floor**, so only lower it after re-verifying a real release.
- Run real-browser QA (`pnpm run qa:browser`) after `pnpm release` and before commit/push, then verify the deployed custom origin and the user-visible Luogu behavior by hand — the harness runs on an offline fixture and states its own limitations in the report.
- The QA stamp compares a **behaviour hash** that exempts only the `@description` line (`scripts/artifact-behaviour-hash.mjs`); every other metadata line and the script body are hashed. Editing the description alone therefore does not invalidate a genuine QA run.
- Keep `src/userscript.meta.js`, `LuoguSP.user.js`, `package.json`, both lockfiles, the README version badge, CDN manifest, and release reports aligned. The release script owns version synchronization; dependency changes must refresh both lockfiles. Daily commands run under pnpm, but **both CI definitions install with `npm ci`**, so a stale `package-lock.json` fails CI before a single check runs — `quality:check` now gates on it (`scripts/lock-sync.mjs`); refresh it with `npm install --package-lock-only`.
- Push the release commit to both `origin` (GitHub) and `cnb`, then verify their branch heads and CI/build results. The project release is the immutable CDN deployment; do not create GitHub or CNB Release objects unless explicitly requested.
- Do not expose authentication tokens, request headers, cookies, or browser storage in logs or committed QA artifacts.

## Product constraints

- Treat Luogu DOM and embedded payloads as external, versioned interfaces: prefer shape checks, fail closed, and add a regression fixture for every compatibility repair.
- On `/user/{uid}/practice`, color only the “尝试过的题目” list. The “已通过的题目” list is already grouped by difficulty and must not be recolored, fetched, or bulk-cached.
- Preserve unrelated user changes and keep generated browser artifacts outside the repository.
