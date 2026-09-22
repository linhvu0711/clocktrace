#!/usr/bin/env bash
# Points git at the hooks in .githooks so the pre-push gates run on every push.
# Runs from pnpm install. Safe to run twice. Does nothing outside a git checkout
# (a tarball install), and never fails the install.
set -uo pipefail

cd "$(dirname "$0")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "install-hooks: not a git checkout, nothing to do"
  exit 0
fi

if git config core.hooksPath .githooks; then
  echo "install-hooks: core.hooksPath = .githooks"
else
  echo "install-hooks: could not set core.hooksPath, hooks are off"
fi
exit 0
