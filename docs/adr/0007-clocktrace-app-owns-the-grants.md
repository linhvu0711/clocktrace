---
status: accepted
---

# Clocktrace.app owns the permission grants, and the Helper is its main program

macOS credits an Accessibility or Automation grant to the responsible process,
so a grant made from a terminal belongs to the terminal and the launchd
Collector still reads `denied` (#63). `setup` writes
`~/Applications/Clocktrace.app` whose main program is the Helper, the launchd
agent starts the Collector through its `spawn` verb
(`<app>/Contents/MacOS/Clocktrace spawn <node> <entry>`), and `permissions` and
`status` run it with `open -a` so the app asks and answers. In development the
bundle is ad-hoc signed by `setup`; at release it carries the Developer ID
signature from #21 and is copied whole.

## Considered options

- `node` as the main program: rejected, a bundle whose main program is `node`
  stays denied after the user turns it on (checked by hand on macOS 27.0,
  2026-09-21).
- Grant to the terminal and keep the Helper bare: rejected, the launchd
  Collector has no terminal and reads `denied` (#63).
- `.app` inside the repo checkout: rejected, the bundle must sit at a stable
  user path (`~/Applications`) or every rebuild moves the grants.

## Consequences

- An ad-hoc re-sign of a changed Helper makes the stored grant stale until
  `tccutil reset`; the release build (#21) signs with the Developer ID and
  ships the app in the tarball, so this is development-only.
- The app must stay in `~/Applications`: TCC follows the bundle path and a
  moved app asks again.
- `open -W` exits 0 whatever the app exits, so `permissions request` reports
  the real outcome on stdout as `{"outcome":"asked"|"notRunning"}`.
- Deleting the app makes `status` say `app: missing` with every permission
  `not checked` and makes `permissions` fail `app: missing`; `setup` repairs
  it.
