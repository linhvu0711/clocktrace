---
status: accepted
---

# Hosts start our code by absolute paths, never by PATH

`setup` writes a Registration into each Host and a launchd plist for the Collector. Both name the running `node` (`process.execPath`) and the absolute entry file, resolved from `import.meta.url`. Neither relies on the Host or launchd finding `clocktrace` or `node` on PATH.

## Considered options

Register the bare command `clocktrace`, as the first version did, and put the bin on PATH with `pnpm link --global` now and Homebrew later. Rejected because a Host launched from the Dock gets only the system PATH `/usr/bin:/bin:/usr/sbin:/sbin` (anthropics/claude-code issue 57859), so it never finds a Homebrew or pnpm bin. A bin shim has a second hole. It runs the first `node` on PATH, and on one dev Mac that was a Node 10 from 2021.

## Consequences

`process.execPath` resolves symlinks, so under Homebrew it is a Cellar path that dies on `brew upgrade node`. A moved checkout has the same effect. `setup` always removes and re-adds the Registration, so running `setup` again is the one repair. There is no "already registered" outcome.
