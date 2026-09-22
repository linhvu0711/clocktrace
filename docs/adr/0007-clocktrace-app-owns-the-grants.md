---
status: accepted
---

# Clocktrace.app owns the permission grants

macOS attributes Accessibility, Automation, and Full Disk Access grants to the
responsible process — the app the asking process belongs to — so a Helper
started from Terminal asked for Terminal, and the Collector's reads showed
Terminal's grants, not Clocktrace's (#63). `setup` now writes
`~/Applications/Clocktrace.app`, a bundle whose main program is the Helper
binary, and the grants live on it. The launchd agent runs the app binary as
`<app>/Contents/MacOS/Clocktrace spawn <node> <entry>` so the Collector runs
under the app's responsibility, and `permissions`/`status` run the Helper
through `open -W -a <app>` so their reads and prompts carry the app's grants
too. The app must not be moved: TCC follows the bundle path and a moved app
asks again.

## Considered options

- Ship the Helper as the Collector itself with no bundle: rejected, a bare
  binary never owns grants; macOS still attributes them to whatever launched
  it.
- Ask inside the Collector process: rejected, launchd children belong to
  launchd, not to a TCC-known app.
- `.app` inside the repo checkout: rejected, the bundle must sit at a stable
  user path (`~/Applications`) or every rebuild moves the grants.

## Consequences

- `setup` writes and ad-hoc signs the app only when the Helper lacks a
  Developer ID signature, and always re-registers it with `lsregister -f`; a
  Developer ID-signed Helper copies straight over (#21 covers signing).
- `open -W` exits 0 whatever the app exits, so `permissions request` reports
  the real outcome on stdout as `{"outcome":"asked"|"notRunning"}`.
- Deleting the app makes `status` say `app: missing` with every permission
  `not checked` and makes `permissions` fail `app: missing`; `setup` repairs
  it.
- Moving the app later is a new grant flow, not this ticket.
