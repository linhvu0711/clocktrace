# Clocktrace

Automatic time tracking for a Mac, queried through an AI agent or the terminal instead of a UI. The tracker records what the user does, the agent answers questions like "how much time did I spend coding this week".

## Language

### Tracking

**Activity**:
One continuous span of time in one app, with its window title and URL when known. The raw unit of tracked time. Activities are never edited after they are written.
_Avoid_: Event, session, entry, log

**App**:
`~/Applications/Clocktrace.app`, the bundle `setup` writes whose main program is the Helper binary. It owns the macOS Accessibility, Automation, and Full Disk Access grants: the Collector and `permissions`/`status` run through it, and it must not be moved.
_Avoid_: Bundle, wrapper, launcher

**Grant**:
macOS's yes or no for one permission of the App: Accessibility, Full Disk Access, or Automation for one browser. macOS asks for an Automation Grant once; after a no, the user's switch in System Settings changes it, or a `tccutil reset` that clears the Automation Grants of every browser at once (ADR 0009 keeps it as the last fallback).
_Avoid_: Permission state, access, consent

**Saved grant**:
The last Automation Grant clocktrace saw for one browser, with the time it saw it. `status` and `permissions` show it when the browser is closed, because macOS answers only for an open browser. A live check that finds no Grant removes it.
_Avoid_: Cached grant, last known grant, remembered permission

**Collector**:
The background process that watches the Mac and writes Activities. Runs as a per-user launchd agent.
_Avoid_: Tracker, daemon, watcher, recorder

**Stand-in id**:
The id an Activity gets when macOS gives its app a name but no bundle id, such as a Windows game run through Wine: `noid:` and the app name, as `noid:QSanguosha.exe`. A real bundle id never holds a colon, so the two never clash. Two such apps with one name share one Stand-in id. An app with no name or an empty name gets none and is not tracked. Built in #171.
_Avoid_: Fake id, fallback id, pseudo bundle id

**Installed**:
The Collector's plist file exists in `~/Library/LaunchAgents`. Distinct from Loaded: a stopped Collector is still installed. `setup` treats installed-but-stopped as set up, and so does the check before every CLI command and MCP tool, which asks for the plist and the database.
_Avoid_: Set up, present, configured

**Loaded**:
The Collector is bootstrapped into launchd and can run. `setup` installs and then loads; a failed load leaves the Collector installed but not loaded.
_Avoid_: Running, started, active, bootstrapped

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
The state after 15 minutes with no keyboard or mouse input and no Screen hold. The current Activity ends at the last input, or at the end of the Screen hold when that came later. Idle time is not stored, it shows as a gap.
_Avoid_: AFK, away, break

**Screen hold**:
The app in front asks macOS to keep the screen on, as a video, a video call, or a slideshow does. While it lasts, time with no input is not Idle, for at most 3 hours after the last input. A hold by an app that is not in front does not count.
_Avoid_: Wake lock, display assertion, keep-awake, playback

**Device**:
One source of Activities: this Mac, or an iPhone or iPad synced through Apple. Every Activity belongs to one Device.
_Avoid_: Source, machine, peer

**Importer**:
The part of the Collector that turns Biome App.InFocus records from other Devices into Activities. Isolated from Mac tracking and gated by a list of verified macOS versions.
_Avoid_: Screen Time sync, iOS tracker

**Progress**:
The Importer's bookmark for one Device: the last segment file and offset it turned into Activities, and that record's time. A Device with no records has no Progress yet.
_Avoid_: Cursor, checkpoint, since

**Import batch**:
One Importer run's new Activities, the Progress each Device moves to, and the run's status. Written in one transaction, so a failed write leaves none of them.
_Avoid_: Import, sync, chunk

**Host**:
An AI app that starts the MCP server and gives its model our tools. v0 registers with Claude Code, Codex, Hermes Agent, and OpenClaw.
_Avoid_: Client, agent app, harness, IDE

**Registration**:
The entry `setup` writes into one Host's config that tells it how to start our MCP server. It holds the absolute `node` and entry file paths, never a bare command, and every `setup` run rewrites it (ADR 0008).
_Avoid_: MCP entry, server entry, host config

**Twin**:
The CLI command that pairs with an MCP tool: `clocktrace rules add` is the Twin of `add_rule`. Both call one core function and neither has logic of its own. Every tool has one (ADR 0006).
_Avoid_: Alias, wrapper, mirror, subcommand

**Rollup**:
One row per day, Device, app, Category, and Project with the seconds summed, derived from Activities each night with the Rules of that moment. Whole-day `summary` questions read it, today reads Activities; `timeline` and `activities` always read Activities. Rebuilt for affected days when Rules change. Never the source of truth. Planned in #18, not built: no rollup table exists yet.
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
A Rule kind. A matching Activity keeps its app and time but its title and URL are blanked before it is written, so they never touch disk. There is no opposite effect, so a Private rule cannot carry an exception; write the rule narrow instead. A Private window needs no Rule.
_Avoid_: Ignore, exclude, hidden, public

**Private window**:
A browser window the browser itself marks private (Incognito, InPrivate, Private Browsing). The Helper sends no title and no URL for it, always, with no Rule and with or without Accessibility.
_Avoid_: Incognito tab, private mode, secret window

**Uncategorized**:
The Category an Activity falls into when no Rule matches. Not a stored Category, a result.
_Avoid_: Other, unknown, unassigned

**Starter set**:
The Categories and Rules that ship with a fresh install, covering common apps and sites. The user can rename or delete any of them.
_Avoid_: Defaults, presets, templates
