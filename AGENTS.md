# AGENTS.md — LuoguSP

In a containing workspace, also read ../AGENTS.md when present.

## Scope and authorities

LuoguSP is a Tampermonkey userscript for Luogu. Source lives in src/;
LuoguSP.user.js is a reproducible loader and cdn/releases/<version>/ contains
immutable CDN releases. [README.md](README.md) is the public usage entry point.
GitHub is authoritative; CNB is a separately authorized mirror.

- Read [architecture](docs/architecture.md) for source boundaries and
  [browser support](docs/browser-support.md) for compatibility and validation.
- package.json owns runtime requirements, pnpm version and commands;
  pnpm-lock.yaml is the only dependency lockfile.
- baseline.config.json owns browser policy and tool snapshots;
  baseline-targets.mjs owns frozen esbuild targets. Preserve fail-closed guards.
- Public documentation uses English. Preserve application labels, immutable
  release bytes, third-party licenses and unrelated changes.
- Internal operating records, research logs, publication approvals and asset
  production history belong in the workspace, outside Git.

## Commands and acceptance

Run from this repository root with the declared Node/pnpm versions.

| Trigger | Command | Evidence and limits |
| --- | --- | --- |
| Prepare dependencies | pnpm install --frozen-lockfile | Locked installation; not behavior acceptance. |
| Source or contract changes | pnpm check | Baseline, reproducible build, quality budgets and Node tests; not released-byte browser QA. |
| Baseline diagnostics | pnpm baseline:check | Queries, fixed targets and all esbuild consumers. |
| Release planning | pnpm release -- --plan --version <version> | Proposed release; no deployment. |
| Authorized release | pnpm release -- --version <version> | Builds/deploys immutable CDN content, updates version files, then stops for browser QA. |
| Released-byte QA | pnpm qa:browser | Promoted @require bytes and generated reports/browser-qa.json; needs a browser and network. |

For documentation-only changes, check local links, metadata and affected
documentation-contract tests. Separate worktree checks, released-byte QA, actual
Luogu behavior and custom-origin verification. Local fixtures do not establish
authenticated production behavior. Browser QA follows release and runs before a
release commit/push; prefer installed Chrome/Edge, then bundled Chromium.

## Release, privacy and compatibility

- Never edit existing CDN release directories or hashes. @require integrity pins
  immutable bytes. The release script owns metadata, loader, package/lockfile,
  README version badge, manifest and generated release reports.
- Use global wrangler; the publisher enforces config/cdn.json's minimum.
  A source push does not authorize CDN deployment or a provider Release object.
- scripts/artifact-behaviour-hash.mjs exempts only the metadata description line;
  all other metadata/body bytes remain covered by the behavior hash.
- Commit focused changes on main. Pushes, mirror sync, deployment and publication
  require the owner's applicable explicit authorization.
- Keep tokens, headers, cookies and browser storage out of logs and tracked QA.
  Temporary injection/browser artifacts stay outside the repository.
- Luogu DOM and embedded payloads are changing external interfaces. Validate
  shape, fail closed and add regression fixtures for compatibility fixes.
- On /user/{uid}/practice, color attempted problems only. Preserve native passed
  grouping; do not recolor, fetch or batch-cache the passed list.

Use [the issue tracker](docs/agents/issue-tracker.md) for public work requests.
