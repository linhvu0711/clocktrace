# proofbox demo

A record of one end-to-end run of clocktrace on a disposable Mac made by [proofbox](https://github.com/linhvu0711/proofbox). It checks proofbox, not clocktrace. Nothing in the app changed.

## How it ran

1. `proofbox create --os macos --work . --setup setup-macos.sh` on a Namespace macOS 26.3.1 Sandbox (4 vCPU, 7 GB). The Setup script checks Xcode and Swift, keeps the Node it finds when it is 22.12 or later (v25.8 here), and installs pnpm 9.15.4.
2. `proofbox exec` runs `pnpm install --frozen-lockfile` with `EMBED_SOURCE_SKIP=1`, then `pnpm build` (TypeScript and the Swift helper), and links `apps/cli/bin/clocktrace.js` as `clocktrace` in `/opt/homebrew/bin`.
3. proofbox drives Terminal, System Settings, and Safari with `click`, `type`, `key`, and `scroll`. `mark` names each step, and `mark --wait` names the real waits, while the Collector records a page.
4. `proofbox record stop` builds each Proof video and a Proof screenshot per step.

## What the run covers

Video 1, setup and recording: `clocktrace setup` installs the app and the launch agent and starts the Collector. It asks for Accessibility, the real macOS dialog opens System Settings, the Clocktrace switch asks for the user password, and setup confirms the grant. Safari then asks to let Clocktrace control it (Automation, for URLs). Four sites are read in turn: the clocktrace repo on GitHub, Wikipedia, a YouTube video, and Hacker News.

Video 2, rules and reports: `clocktrace status` shows 3 of 3 permissions. A new Category `Research` and a Rule `domain ends with "wikipedia.org"` move the Wikipedia time already recorded to Research. A Private Rule for `news.ycombinator.com` leaves the earlier visit as it was and blanks the next visit, as the README says (a Private Rule works only from the time you add it). A Project Rule on the repo URL moves the GitHub time to `clocktrace-dev`. `clocktrace activities` shows the private row with no title and no URL.

## Notes from the run

- The password for the macOS dialog is `runner`, the Namespace default.
- YouTube refuses playback on a cloud machine, so the video shows an error. The page time still counts.
- Each site was read for about 30 s, so the default `breakdown` folds Wikipedia into "small items". Step 10 of video 2 uses `--min 1s` to show it under Research.
- The Accessibility list in System Settings also shows `sshd`, `sshd-keygen-wrapper`, and `sshd-session`. proofbox grants these so it can run commands and take screenshots on the Mac.
- Safari reopens the last tab when it starts again, so the Automation dialog in step 4 shows over the Hacker News page from the dry run.
- During video 2, at 16:39:11 UTC, macOS set the clock 15.4 s forward (`timed`, `settimeofday … adjust,15.416751504`). The Recording ended without error and the step captions after it match the screen.
