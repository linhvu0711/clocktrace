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

`pnpm exec` also masks child exit codes: `clocktrace permissions` + Ctrl-C exits 130, but through `pnpm --filter cli exec` the shell sees `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` and exit 1. To run the bare `clocktrace` command (and preserve real exit codes), symlink the built bin onto PATH: `ln -sf "$(pwd)/apps/cli/bin/clocktrace.js" ~/.local/bin/clocktrace` and `export PATH="$HOME/.local/bin:$PATH"`.

"Fresh machine" walks assume no Chrome-family browsers. Any installed Chrome/Brave/Edge/Vivaldi/Chromium is detected via `NSWorkspace.urlForApplication(withBundleIdentifier:)` and adds `Automation · <browser>` rows and extra prompts, breaking expected transcripts. Moving the .app is not enough — LaunchServices still resolves it; delete the .app (or `lsregister -u <path>` then delete) and re-check `clocktrace-helper permissions` JSON for `notInstalled`.

Host checklist pre-ticks any detected host: `~/.claude.json`, `~/.codex`, `~/.hermes`, `~/.openclaw`, or `claude`/`codex`/`openclaw` on PATH. Verify all are absent when the walk expects nothing selected.

Turning on a Full Disk Access toggle in System Settings prompts for local admin authentication before the toggle sticks; the toggle may visually revert in a stale pane even after a successful grant — trust `clocktrace permissions` output over the Settings UI.

Re-running `clocktrace setup` with the agent already loaded can report `collector did not start` even though `launchctl print gui/$(id -u)/com.clocktrace.collector` reaches `state = running` seconds later — launchd takes a while to re-register the job (during which `launchctl print` errors "Could not find service"), and the delay grows with each bootout→bootstrap cycle on the same box (observed ~13s→19s across repeated runs, likely relaunch throttling). To still exercise the rest of setup, unload the agent first (`launchctl bootout` + remove the plist) so the run takes the fresh-bootstrap path.

## Devin Secrets Needed

- Local macOS administrator credentials for Full Disk Access authorization. Obtain from the lead through an approved channel; do not put values in this skill.
