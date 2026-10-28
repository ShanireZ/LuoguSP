# LuoguSP

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square)](LICENSE)
![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-00485B.svg?style=flat-square)
[![Version: 2.14.6](https://img.shields.io/badge/version-2.14.6-2f80ed.svg?style=flat-square)](LuoguSP.user.js)

A Tampermonkey userscript that enhances Luogu problem pages, profiles, IDE mode,
articles and pastes.

Repository: [GitHub](https://github.com/ShanireZ/LuoguSP) ·
[CNB mirror](https://cnb.cool/Round1/LuoguSP).

## Features

- **Problem difficulty colors**: color problem IDs on supported pages using Luogu's
  difficulty levels; preserve native submission-list coloring.
- **Problem hover previews**: show title, difficulty, pass/submission counts,
  limits, collapsible tags and personal status beside problem links.
- **User hover previews**: extend username/avatar cards with profile information,
  awards and available follow, message, article, report and block actions.
- **Profile introductions**: display introductions omitted from profile home pages.
- **Restricted articles and pastes**: retrieve archived content through
  [Luogu Saver](https://www.luogu.me/), with supported article refresh and interaction.
- **IDE sample batch testing**: run all samples and inspect results, duration,
  memory use and output differences.
- **In-page settings**: enable or disable features through the navigation settings entry.

Coloring follows initial rendering, pagination and client-side navigation.
Available native data is applied before the next paint; missing data waits
300 ms after mounting, then uses the cache or existing request queue.
Practice pages process attempted problems only, preserving the passed list.
The first visible result also depends on userscript injection timing.

Difficulty cache entries expire after five minutes without sliding renewal;
queried entries are capped at 1,000. Hover previews have an independent five-minute,
60-entry cache. Both remain in tab memory across client-side navigation and clear
on reload. Expired entries refresh on use; static pages are not polled.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the script and confirm installation:
   - [CNB Raw](https://cnb.cool/Round1/LuoguSP/-/git/raw/main/LuoguSP.user.js)
   - [GitHub Raw](https://raw.githubusercontent.com/ShanireZ/LuoguSP/main/LuoguSP.user.js)

Alternatively, paste the complete LuoguSP.user.js source into a new userscript,
or drag the downloaded file into Tampermonkey.

## Update

Open either Raw link again and confirm the update, use Tampermonkey's update
check, or replace the installed script with the latest complete source.

## Development

Read [the project guide](AGENTS.md) and [documentation](docs/index.md).
pnpm check validates the worktree. The local browser fixture
node scripts/qa/problem-color-local.mjs exposes first-paint coloring,
pagination, navigation and request-delay checks at the URL it prints.
It does not replace released-byte browser QA or authenticated Luogu verification.

## Authors and license

Maintained by ShanireZ; realskc maintained versions through 1.8.2.
Distributed under [GNU General Public License v3.0](LICENSE).
