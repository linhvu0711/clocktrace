---
name: clocktrace-helper-native-permissions
description: Test clocktrace-helper permission states and native macOS consent dialogs from Terminal.app.
---

# Native permissions proof

Use a macOS desktop and run permission commands inside Terminal.app: macOS attributes TCC grants to the responsible terminal, so launching the helper through remote exec may test a different identity.

At `packages/helper`, use an existing release build and set `BIN="$(swift build -c release --show-bin-path)/clocktrace-helper"`. Build with `swift build -c release` if needed.

For reliable GUI command entry, write commands to the clipboard using exec `printf '%s\n' '<command>' | pbcopy`, then use computer keys `cmd+v` and `Return`. Direct typing of shell punctuation may be unreliable. macOS key names use `cmd`, not `super`.

Before a fresh consent walk, reset only the relevant Terminal TCC grants with `tccutil reset <service> com.apple.Terminal` (Accessibility, AppleEvents, SystemPolicyAllFiles), then quit/reopen Terminal. Resetting grants changes user settings; do this only with authorization.

For the closed-browser case, verify Safari is absent with `pgrep -x Safari` both before and after the helper request. Open Safari with `open -a Safari` before the Automation prompt test.

Full Disk Access opens System Settings asynchronously; wait for the actual application list to render before taking evidence. Enabling Terminal can require local admin authorization. Use the native Quit & Reopen sheet and allow several seconds for Terminal to restore, then set BIN again before checking state.

Record the native dialog before consenting. Capture JSON before and after grants; a repeated granted Automation request should be silent and must not show another dialog. Check `$?` immediately after each request.

For CLI walks (e.g. `clocktrace setup`) inside Terminal.app, `pnpm` may fail with `ERR_PNPM_WORKSPACE_WALK_ERROR` because Terminal lacks Full Disk Access and the workspace walk reads protected files under `~/Library`. Run the built entrypoint directly instead: `node apps/cli/bin/clocktrace.js <command>` from the repo root. If `osascript` cannot set window size ("Access not allowed"), resize from the shell with `printf '\e[8;<rows>;<cols>t'`.

## Devin Secrets Needed

- Local macOS administrator credentials for Full Disk Access authorization. Obtain from the lead through an approved channel; do not put values in this skill.
