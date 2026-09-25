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
- `clocktrace-helper permissions` — print one JSON line with the state of every
  grant.
- `clocktrace-helper permissions request (accessibility | automation <bundleId> | fulldiskaccess)`
  — raise that grant's prompt, or open its System Settings pane, then print
  `{"outcome":"asked"}` to stdout and exit with the request's code. Browser not
  running: `<bundleId> is not running, open it and retry` to stderr,
  `{"outcome":"notRunning"}` to stdout, exit 3.
- `clocktrace-helper biome records [--from <deviceId>=<segment>]...` — print one JSON line per iPhone and iPad focus record from the Biome App.InFocus stream, ordered by device, segment file, and offset; each `--from` names one device folder and one segment file name, and skips that device's segment files whose name sorts before it, so the named file and every later one are read, also when the named file is gone; a device folder with no flag is read in full. Each device's `tombstone/` subfolder holds deletion markers, not records, and is skipped. An entry whose payload does not match its header CRC32 prints the `parse` error line at its offset. Exit 3 without Full Disk Access, 4 without the remote folder, 6 when a device folder cannot be listed (the other devices still print).
- `clocktrace-helper biome devices` — print one JSON line per row of the Biome `DevicePeer` table. Exit 3 without Full Disk Access, 5 when the table cannot be read.
- `clocktrace-helper spawn <program> [args...]` — run `<program>` with the args as a child of this binary, forward SIGTERM and SIGINT to it, and exit with its exit status (128 + signal when it dies on a signal). Prints `spawn: cannot start <program>` and exits 127 when the child does not start.
- Anything else — print
  `usage: clocktrace-helper (--version | watch | permissions | permissions request (accessibility | automation <bundleId> | fulldiskaccess) | biome records [--from <deviceId>=<segment>]... | biome devices | spawn <program> [args...])`
  to stderr and exit 2.

## Lines

`watch` prints one JSON object per line:

```json
{"app":"Safari","bundleId":"com.apple.Safari","idleSeconds":12.4,"missing":[],"screenHold":false,"title":"Example Domain","ts":"2026-09-17T10:13:31.628Z","url":"https://example.com/"}
```

| field | source |
| --- | --- |
| `ts` | ISO 8601 UTC with milliseconds |
| `app` | `NSWorkspace` frontmost app name; `null` at the login window |
| `bundleId` | `NSWorkspace` frontmost bundle id; `null` at the login window |
| `title` | Accessibility focused-window title; `null` when Accessibility is not granted, the app has no title, or the window is a Private window |
| `url` | Apple Event read for Safari and the Chrome family; `null` for other apps, when the read fails, for a Private window, and for Safari when the Helper cannot tell (Accessibility off or no private text loaded) |
| `idleSeconds` | `CGEventSource` seconds since last input |
| `missing` | grants the line needed but did not have: `accessibility`, `automation:<bundleId>` |
| `screenHold` | `IOPMCopyAssertionsByProcess`: `true` when the frontmost app holds `PreventUserIdleDisplaySleep`, itself or through a process acting for it; `false` otherwise and when the read fails |

A line prints on every change of app, title, or URL, and at least every 10
seconds as a heartbeat. `idleSeconds` and `ts` alone never trigger a line.

## Grants

The grants belong to `Clocktrace.app`: `clocktrace setup` writes the bundle at
`~/Applications/Clocktrace.app` with this binary as its main program, so macOS
attributes the Accessibility, Automation, and Full Disk Access grants to the
app — the Collector (`spawn`ed by the app binary) and `permissions`/`status`
(run through `open -a`) read and raise them under it.

A helper started from a terminal instead uses that terminal's Accessibility and
Automation grants — macOS attributes the requests to the responsible terminal
process, never to the binary. `watch` never prompts on its own; when a grant is
missing it marks the line in `missing` and moves on.

## Permissions

`permissions` prints one JSON object per line:

```json
{"accessibility":"granted","automation":{"com.apple.Safari":"notRunning","com.brave.Browser":"granted","com.google.Chrome":"notAsked","com.microsoft.edgemac":"notInstalled","com.operasoftware.Opera":"notInstalled","com.vivaldi.Vivaldi":"notInstalled","org.chromium.Chromium":"notInstalled"},"fullDiskAccess":"denied"}
```

| field | source | states |
| --- | --- | --- |
| `accessibility` | `AXIsProcessTrusted` | `granted`, `denied` |
| `automation.<bundleId>` | `AEDeterminePermissionToAutomateTarget` without asking | `granted`, `denied`, `notAsked`, `notRunning` (browser closed), `noAnswer` (running, macOS did not answer in 5 s), `notInstalled` |
| `fullDiskAccess` | opening `~/Library/Biome/sync/sync.db` | `granted`, `denied` |

macOS cannot tell a denied Accessibility grant from one never asked, and Full
Disk Access has no prompt — `request fulldiskaccess` opens the System Settings
pane instead.

## Live checks

Run these by hand from a terminal at `packages/helper`, with
`BIN="$(swift build -c release --show-bin-path)/clocktrace-helper"`:

1. `"$BIN" --version` prints `0.0.0`; `"$BIN" bogus` prints
   `usage: clocktrace-helper (--version | watch | permissions | permissions request (accessibility | automation <bundleId> | fulldiskaccess) | biome records [--from <deviceId>=<segment>]... | biome devices | spawn <program> [args...])`
   to stderr and exits 2.
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
5. `"$BIN" permissions` prints one JSON line with `accessibility`, an
   `automation` entry per supported browser (`notInstalled` when absent,
   `notRunning` when installed but closed), and `fullDiskAccess`.
6. With Safari closed: `"$BIN" permissions request automation com.apple.Safari`
   prints `com.apple.Safari is not running, open it and retry` to stderr and
   exits 3. With Safari open it raises the macOS Automation prompt; after
   `Allow`, `"$BIN" permissions` shows `"com.apple.Safari":"granted"`.
7. `"$BIN" permissions request accessibility` raises the macOS Accessibility
   prompt naming the terminal.
8. `"$BIN" permissions request fulldiskaccess` opens System Settings at
   Privacy & Security → Full Disk Access.
9. With the terminal enabled in Full Disk Access: `"$BIN" permissions` ends
   `"fullDiskAccess":"granted"}`.
