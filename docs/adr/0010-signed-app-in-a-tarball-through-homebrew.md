---
status: accepted
---

# One signed tarball on GitHub Releases, installed through Homebrew

Each release is one tarball on GitHub Releases, `clocktrace-<version>-darwin-arm64.tar.gz`, built by `scripts/release.sh <version>`. It holds the CLI laid out by `pnpm deploy`, with its Node dependencies unbundled in `node_modules`, plus `helper/clocktrace-helper` and `helper/Clocktrace.app`. The app is signed with the Developer ID, notarized, and stapled, and `setup` copies it whole into `~/Applications`. v0 is arm64 only. Node comes from Homebrew as a dependency of the tap formula (#24), which points at the release asset. The Collector finds the Helper in `helper/` next to the top `node_modules` of an installed copy (`helperPathFor` in `packages/collector/src/config.ts`), so no environment variable is needed.

## Considered options

- A tarball that mirrors the workspace (`apps/`, `packages/`, `packages/helper/.build/release/`), so the old Helper path still works with no code change. Rejected: users get the workspace files, the lockfile, and a hidden `.build` folder.
- A `.pkg` installer and an x86_64 build. Left out of v0.

## Consequences

- A release is two runs, because `main` takes changes only through a pull request. `scripts/release.sh --bump <version>` sets the version in the five `package.json` files and `Version.swift` on the branch `chore/release-v<version>` and opens the pull request. Once it is merged, `scripts/release.sh <version>` checks that `main` holds that version, builds and signs, tags `main`, pushes only the tag, and runs `gh release create` with the sha256 in the notes. Both runs start only from a clean `main` that matches `origin/main`.
- CI builds the unsigned tarball (`--no-sign`) and keeps it as an artifact, but only when the workflow is started by hand (#124). Signing never runs in CI.
- The app is signed with the `com.apple.security.automation.apple-events` entitlement (`scripts/clocktrace.entitlements`). The Hardened Runtime blocks Apple Events without it, and the Helper reads the browser URL through them.
- `codesign --deep` signs nothing extra, because the app holds one code item, `Contents/MacOS/Clocktrace`.
