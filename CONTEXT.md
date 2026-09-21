# Clocktrace

Automatic time tracking for a Mac, queried through an AI agent instead of a UI. The tracker records what the user does, the agent answers questions like "how much time did I spend coding this week".

## Language

### Tracking

**Activity**:
One continuous span of time in one app, with its window title and URL when known. The raw unit of tracked time. Activities are never edited after they are written.
_Avoid_: Event, session, entry, log

**Collector**:
The background process that watches the Mac and writes Activities. Runs as a per-user launchd agent.
_Avoid_: Tracker, daemon, watcher, recorder

**Helper**:
The small native Swift binary the Collector runs for every read that needs a macOS permission: frontmost app, window title, browser URL, idle seconds, and the Biome stream files.
_Avoid_: Native module, bridge, agent

**Tracker**:
The part of the Helper that decides when a reading is worth writing. It emits one JSON line when the app, title, or URL changes, or on a heartbeat. Never the Collector.
_Avoid_: Detector, differ, emitter

**Watcher**:
The Helper's `watch` loop. It reads the Mac every second and on app activation, and hands each reading to the Tracker. Never the Collector.
_Avoid_: Poller, run loop, daemon

**Idle**:
The state after 5 minutes with no keyboard or mouse input. The current Activity ends at the last input. Idle time is not stored, it shows as a gap.
_Avoid_: AFK, away, break

**Device**:
One source of Activities: this Mac, or an iPhone or iPad synced through Apple. Every Activity belongs to one Device.
_Avoid_: Source, machine, peer

**Importer**:
The part of the Collector that turns Biome App.InFocus records from other Devices into Activities. Isolated from Mac tracking and gated by a list of verified macOS versions.
_Avoid_: Screen Time sync, iOS tracker

**Host**:
An AI app that starts the MCP server and gives its model our tools. v0 registers with Claude Code, Codex, Hermes Agent, and OpenClaw.
_Avoid_: Client, agent app, harness, IDE

**Rollup**:
One row per day, Device, app, Category, and Project with the seconds summed, derived from Activities each night with the Rules of that moment. Whole-day queries read it, today reads Activities. Rebuilt for affected days when Rules change. Never the source of truth.
_Avoid_: Aggregate, cache, summary table

### Grouping

**Project**:
A flat named bucket for what the work is for: a product, a client, a thesis. An Activity has at most one Project, set by a Rule. Independent of Category.
_Avoid_: Client, tag, label, workspace

**Category**:
A flat named bucket that time is summed into, with a productive yes/no flag. Categories do not nest.
_Avoid_: Project, tag, label, group

**Rule**:
One test on an Activity with one effect: set its Category, set its Project, or mark it Private. A test is one field (app, title, url, domain, device), one compare (is, contains, starts with, ends with, matches), one value. On the domain field, starts with and ends with stop at a dot: ends with `github.com` covers `github.com` and `api.github.com`, never `evilgithub.com`; starts with `docs` covers `docs.google.com`, never `docsevil.com`. Rules are checked in order per effect and the first match wins. Category and Project rules run at query time and are never stored on the Activity. Private rules run before the write.
_Avoid_: Filter, mapping, classifier, blacklist

**Private**:
A Rule kind. A matching Activity keeps its app and time but its title and URL are blanked before it is written, so they never touch disk. There is no opposite effect, so a Private rule cannot carry an exception; write the rule narrow instead.
_Avoid_: Ignore, exclude, hidden, public

**Uncategorized**:
The Category an Activity falls into when no Rule matches. Not a stored Category, a result.
_Avoid_: Other, unknown, unassigned

**Starter set**:
The Categories and Rules that ship with a fresh install, covering common apps and sites. The user can rename or delete any of them.
_Avoid_: Defaults, presets, templates
