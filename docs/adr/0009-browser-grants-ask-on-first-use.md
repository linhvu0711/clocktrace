---
status: accepted
---

# Browser Grants are asked on first use and fixed one browser at a time

The Collector asks macOS for a browser's Automation Grant the first time that
browser comes to the front and macOS has never asked. `setup` and `permissions`
never open a browser and never ask a new one. For a denied browser,
`permissions` opens System Settings › Privacy & Security › Automation, where each
browser has its own switch under Clocktrace, so one browser is fixed at a time. macOS answers a Grant
check only for a running browser, so a closed browser shows its Saved grant with
the time it was seen.

## Considered options

- `tccutil reset AppleEvents <app>` to make a denied browser ask again: kept only
  as a last fallback. `tccutil` takes a service and a client bundle ID, never a
  target, so it erases the Grant for every browser (`man tccutil`, macOS 27.0).
- Private TCC functions to reset one browser: rejected, undocumented and free to
  change with any macOS update.
- Reading `~/Library/Application Support/com.apple.TCC/TCC.db` to know the Grant
  of a closed browser: rejected, the schema is undocumented and changes between
  macOS versions.
- Asking every installed browser in `setup`: rejected, it opens browsers the user
  never uses (a hidden Chromium from a VS Code extension) and asks for Grants
  that are never needed.

## Consequences

- The Grant check and the URL read run beside the Watcher with a time limit.
  A first-use ask waits for the user's click, and a stale `appleeventsd` record
  can make the check never answer; neither may stop recording.
- The first macOS prompt for a browser appears while the user works, not during
  `setup`.
- A Saved grant can be old: a switch changed while the browser is closed shows
  the next time the browser is in front.
