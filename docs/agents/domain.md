---
type: convention
title: Project context
description: Maps LuoguSP concepts to source and release authorities.
tags: [agents, project-context]
status: stable
---

# Project context

Read [the project guide](../../AGENTS.md) and [architecture](../architecture.md)
before changing source or release contracts.

| Concept | Source |
| --- | --- |
| Feature | Descriptors in src/features/, assembled by src/app/. |
| Lifecycle | Routing, scheduling and cleanup in src/core/. |
| Loader | Generated LuoguSP.user.js; metadata in src/userscript.meta.js. |
| CDN release | Immutable cdn/releases/ payloads; config/cdn.json owns publishing. |
| Browser support | baseline.config.json, baseline-targets.mjs and [validation boundaries](../browser-support.md). |

Source and executable contracts take priority over historical reports.
