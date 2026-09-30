#!/usr/bin/env bash
# Point the Homebrew tap's formula at a release and push the tap (ADR 0010).
#   scripts/tap.sh <version> <sha256>
# scripts/release.sh runs it after it publishes the release. Run it by hand
# when that step failed; a second run for the same release changes nothing.
# CLOCKTRACE_TAP_REMOTE names another tap remote, for the test.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: scripts/tap.sh <version> <sha256>"
  exit 1
fi
version="$1"
hash="$2"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "tap: version must look like 1.2.3, got $version"
  exit 1
fi
if [[ ! "$hash" =~ ^[0-9a-f]{64}$ ]]; then
  echo "tap: sha256 must be 64 lowercase hex characters, got $hash"
  exit 1
fi

remote="${CLOCKTRACE_TAP_REMOTE:-https://github.com/linhvu0711/homebrew-clocktrace.git}"
url="https://github.com/linhvu0711/clocktrace/releases/download/v$version/clocktrace-$version-darwin-arm64.tar.gz"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
tap="$tmp/tap"
git clone --quiet "$remote" "$tap"
formula="$tap/Formula/clocktrace.rb"

# The formula declares url and sha256 once each, at two spaces, with nothing
# after the value. Any other declaration, or one in a shape sed would skip,
# stops the run, so a release never pushes a url and a sha256 that disagree.
for key in url sha256; do
  if [[ "$(grep -cE "^[[:space:]]*${key}[[:space:]]" "$formula")" != "1" ]] ||
    [[ "$(grep -cE "^  $key \"[^\"]*\"$" "$formula")" != "1" ]]; then
    echo "tap: Formula/clocktrace.rb has no single $key line, update it by hand"
    exit 1
  fi
done
sed -i '' -E \
  -e "s|^  url \"[^\"]*\"$|  url \"$url\"|" \
  -e "s|^  sha256 \"[^\"]*\"$|  sha256 \"$hash\"|" \
  "$formula"

if git -C "$tap" diff --quiet; then
  echo "tap: Formula/clocktrace.rb already points at v$version"
  exit 0
fi
git -C "$tap" commit --quiet -m "clocktrace $version" -- Formula/clocktrace.rb
git -C "$tap" push --quiet origin HEAD
echo "tap: Formula/clocktrace.rb points at v$version"
