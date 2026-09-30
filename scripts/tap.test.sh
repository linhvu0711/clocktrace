#!/usr/bin/env bash
# Tests scripts/tap.sh against a local bare tap with a copy of the formula's
# shape, so nothing reaches GitHub.
#   bash scripts/tap.test.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

old_hash="$(printf 'a%.0s' {1..64})"
new_hash="$(printf 'b%.0s' {1..64})"
new_url="https://github.com/linhvu0711/clocktrace/releases/download/v9.9.9/clocktrace-9.9.9-darwin-arm64.tar.gz"

seed="$tmp/seed"
origin="$tmp/tap.git"
mkdir -p "$seed/Formula"
cat >"$seed/Formula/clocktrace.rb" <<RUBY
class Clocktrace < Formula
  desc "Time tracker"
  url "https://github.com/linhvu0711/clocktrace/releases/download/v9.9.8/clocktrace-9.9.8-darwin-arm64.tar.gz"
  sha256 "$old_hash"
  license "MIT"
end
RUBY
git -C "$seed" init --quiet -b main
git -C "$seed" add -A
git -C "$seed" commit --quiet -m "clocktrace 9.9.8"
git clone --quiet --bare "$seed" "$origin"
export CLOCKTRACE_TAP_REMOTE="$origin"

failures=0
check() {
  local name="$1"
  shift
  if "$@"; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    failures=$((failures + 1))
  fi
}
status=0
run_tap() {
  set +e
  bash "$root/scripts/tap.sh" "$@" >"$tmp/out" 2>&1
  status=$?
  set -e
}
says() { grep -qF -- "$1" "$tmp/out"; }
formula() { git -C "$origin" show main:Formula/clocktrace.rb; }
commits() { git -C "$origin" rev-list --count main; }

run_tap 9.9.9 "$new_hash"
check "a release exits 0" test "$status" -eq 0
check "it sets the url" grep -qF "  url \"$new_url\"" <(formula)
check "it sets the sha256" grep -qF "  sha256 \"$new_hash\"" <(formula)
check "it changes only those two lines" \
  test "$(git -C "$origin" diff --numstat main~1 main | cut -f 1)" -eq 2
check "it commits as the version" \
  test "$(git -C "$origin" log -1 --format=%s main)" = "clocktrace 9.9.9"

run_tap 9.9.9 "$new_hash"
check "a second run for the same release exits 0" test "$status" -eq 0
check "it says the tap is already there" says "already points at v9.9.9"
check "it pushes nothing" test "$(commits)" -eq 2

run_tap 9.9.9 NOTAHASH
check "a bad sha256 stops" test "$status" -eq 1
check "it names the sha256" says "tap: sha256 must be 64 lowercase hex characters"

run_tap 9.9 "$new_hash"
check "a bad version stops" test "$status" -eq 1

git clone --quiet "$origin" "$tmp/edit"
sed -i '' '/^  sha256 /d' "$tmp/edit/Formula/clocktrace.rb"
git -C "$tmp/edit" commit --quiet -am "drop sha256"
git -C "$tmp/edit" push --quiet origin main
run_tap 9.9.10 "$new_hash"
check "a formula with no sha256 line stops" test "$status" -eq 1
check "it says to update it by hand" says "has no single sha256 line"
check "it pushes nothing then" test "$(commits)" -eq 3

git -C "$tmp/edit" pull --quiet
sed -i '' -E "s|^(  url \".*\")$|\\1 # release archive|" "$tmp/edit/Formula/clocktrace.rb"
printf '  sha256 "%s"\n' "$old_hash" >>"$tmp/edit/Formula/clocktrace.rb"
git -C "$tmp/edit" commit --quiet -am "comment after the url"
git -C "$tmp/edit" push --quiet origin main
run_tap 9.9.10 "$new_hash"
check "a url line with a comment after it stops" test "$status" -eq 1
check "it names the url line" says "has no single url line"
check "it pushes nothing then either" test "$(commits)" -eq 4

if [[ "$failures" -gt 0 ]]; then
  echo "tap.test: $failures failed"
  exit 1
fi
echo "tap.test: all passed"
