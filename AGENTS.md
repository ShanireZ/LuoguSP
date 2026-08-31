# AGENTS.md — LuoguSP project guide

See the workspace-wide rules in [`../AGENTS.md`](../AGENTS.md).

LuoguSP is a browser userscript for Luogu. Source modules live under `src/`; `LuoguSP.user.js` is a reproducible loader artifact, and immutable CDN releases live under `cdn/releases/<version>/`.

## Commands

- `pnpm run baseline:check` — expand the approved Baseline query and prove that every esbuild browser output consumes the fixed target contract.
- `pnpm run check` — reproducible-build check, quality budgets, and the full Node test suite.
- `pnpm release -- --plan --version <version>` — inspect the release plan without changing production.
- `pnpm release -- --version <version>` — build and deploy an immutable CDN release, update all version-bearing files, then stop for real-browser QA (`publish` remains a compatibility alias).
- `pnpm run qa:prepare` — prepare the currently promoted userscript for browser injection.
- `pnpm run qa:browser` — reproducible real-browser QA; writes `reports/browser-qa.json`. It exercises the **promoted artifact** (the bytes its two `@require` URLs point at), not the working tree, so run it **after** a release, not before. Prefers the system Chrome/Edge; falls back to Playwright's bundled Chromium.

## Release safety

- Never edit or overwrite an existing directory under `cdn/releases/`; release paths and hashed files are immutable.
- This repository uses GitHub Actions. After finishing and validating an owner-approved fix or increment, commit the focused change directly on local `main`; agents must not run `git push`. The owner batches one or more local commits into a single push so Actions runs for that push's final SHA; deferred pushing never relaxes the local release gates.
- The deploy CLI is the **globally installed** `wrangler` (workspace convention, see [`../AGENTS.md`](../AGENTS.md)), not a version pinned through `npx`. Because releases are immutable and byte-pinned by `@require #sha256=`, `scripts/cdn/publish.mjs` measures the global CLI first and fails closed below `cli.wrangler.minimum` in `config/cdn.json` — that value is a **verified floor**, so only lower it after re-verifying a real release.
- Run real-browser QA (`pnpm run qa:browser`) after `pnpm release` and before commit/push, then verify the deployed custom origin and the user-visible Luogu behavior by hand — the harness runs on an offline fixture and states its own limitations in the report.
- The QA stamp compares a **behaviour hash** that exempts only the `@description` line (`scripts/artifact-behaviour-hash.mjs`); every other metadata line and the script body are hashed. Editing the description alone therefore does not invalidate a genuine QA run.
- Keep `src/userscript.meta.js`, `LuoguSP.user.js`, `package.json`, `pnpm-lock.yaml`, the README version badge, CDN manifest, and release reports aligned. The release script owns version synchronization. There is **one** lockfile: the repository moved fully to pnpm on 2026-08-17, retiring the `package-lock.json` / `scripts/lock-sync.mjs` dual-track (both CI definitions used to install with `npm ci`, so refreshing only the pnpm lockfile failed CI before a single check ran). Both CI definitions now run `pnpm install --frozen-lockfile`, which is itself the drift gate — it refuses to install when `pnpm-lock.yaml` and `package.json` disagree. The pnpm version has a single source, `package.json`s `packageManager`; pnpm 12 enforces it with a hard `ERR_PNPM_BAD_PM_VERSION`, so no separate version-match assertion is needed.
- After the owner pushes the release commit to both `origin` (GitHub) and `cnb`, verify their branch heads and CI/build results. The project release is the immutable CDN deployment; do not create GitHub or CNB Release objects unless explicitly requested.
- Do not expose authentication tokens, request headers, cookies, or browser storage in logs or committed QA artifacts.

## Product constraints

- Web Platform Baseline contract: `runtime: browser-tool`, `featureTarget: newly`; production syntax is frozen in `baseline-targets.mjs` at the approved Widely boundary. Baseline does not polyfill Web APIs or replace real Luogu-page QA. The six-field declaration and tool snapshots live in `baseline.config.json`.
- Treat Luogu DOM and embedded payloads as external, versioned interfaces: prefer shape checks, fail closed, and add a regression fixture for every compatibility repair.
- On `/user/{uid}/practice`, color only the “尝试过的题目” list. The “已通过的题目” list is already grouped by difficulty and must not be recolored, fetched, or bulk-cached.
- Preserve unrelated user changes and keep generated browser artifacts outside the repository.

## Agent skills

### Issue tracker

Issues and specs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This target uses a single-context domain-doc layout. See `docs/agents/domain.md`.

### Related engineering skills

Working rules by phase, completion criteria, and the skill mapping live in the workspace-root [`Docs/dev_guide.md`](../Docs/dev_guide.md), which is imported into every session. It replaced the per-project `docs/agents/skill-workflows.md` copies, which had drifted and named uninstalled skills.

### Documentation system

Maintain durable documentation as an OKF knowledge bundle. See `docs/agents/documentation.md` and `docs/agents/index.md`.
