# clocktrace-helper

The small native Swift binary the Collector runs for every read that needs a
macOS permission: frontmost app, window title, browser URL, and idle seconds.

## Build

```sh
swift build -c release
```

The binary lands at `.build/arm64-apple-macosx/release/clocktrace-helper`;
`swift build -c release --show-bin-path` prints that directory on any machine.

## Commands

- `clocktrace-helper --version` — print the package version.
- `clocktrace-helper watch` — print JSON lines on stdout forever.
- Anything else — print usage to stderr and exit 2.

## Lines

`watch` prints one JSON object per line:

```json
{"app":"Safari","bundleId":"com.apple.Safari","idleSeconds":12.4,"missing":[],"title":"Example Domain","ts":"2026-09-17T10:13:31.628Z","url":"https://example.com/"}
```

| field | source |
| --- | --- |
| `ts` | ISO 8601 UTC with milliseconds |
| `app` | `NSWorkspace` frontmost app name; `null` at the login window |
| `bundleId` | `NSWorkspace` frontmost bundle id; `null` at the login window |
| `title` | Accessibility focused-window title; `null` when Accessibility is not granted or the app has no title |
| `url` | Apple Event read for Safari and the Chrome family; `null` for other apps or when the read fails |
| `idleSeconds` | `CGEventSource` seconds since last input |
| `missing` | grants the line needed but did not have: `accessibility`, `automation:<bundleId>` |

A line prints on every change of app, title, or URL, and at least every 10
seconds as a heartbeat. `idleSeconds` and `ts` alone never trigger a line.

## Grants

A helper started from a terminal uses that terminal's Accessibility and
Automation grants — macOS attributes the requests to the responsible terminal
process, never to the binary. `watch` never prompts on its own; when a grant is
missing it marks the line in `missing` and moves on. Prompting and the
`permissions` subcommand are owned by a later change.

## Live checks

Run these by hand from a terminal at `packages/helper`, with
`BIN="$(swift build -c release --show-bin-path)/clocktrace-helper"`:

1. `"$BIN" --version` prints `0.0.0`; `"$BIN" bogus` prints
   `usage: clocktrace-helper (--version | watch)` to stderr and exits 2.
2. With Accessibility off for the terminal: `"$BIN" watch` prints a first line
   for the terminal with `"title":null,"missing":["accessibility"]`, repeats a
   heartbeat at least every 10 seconds, and follows the frontmost app as you
   click around — every line carries all seven fields.
3. With Accessibility on for the terminal: the frontmost app's window title
   appears, e.g. `"app":"TextEdit","title":"Untitled","missing":[]`.
4. With Safari frontmost and the terminal allowed to control Safari:
   `"url":"https://example.com/"` appears and follows navigation; with the
   Automation grant off the same line shows `"url":null` and
   `"missing":["automation:com.apple.Safari"]`.
