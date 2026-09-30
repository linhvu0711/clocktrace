#!/usr/bin/env bash
# Tests the guards and the --bump run of scripts/release.sh in a scratch clone
# with a local bare origin and a stub gh, so nothing builds, signs, or reaches
# GitHub. The signed build itself is proven by hand on a release (#23).
#   bash scripts/release.test.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Never a version main holds, so the test outlives every release.
version="99.0.0"
branch="chore/release-v$version"
work="$tmp/work"
origin="$tmp/origin.git"

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

# The stub gh is signed in, and records every call.
mkdir -p "$tmp/bin"
cat >"$tmp/bin/gh" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$tmp/gh.log"
EOF
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH"

# The clone runs the working copy of release.sh, committed on its main.
git clone --quiet --no-tags "$root" "$work"
git clone --quiet --bare "$work" "$origin"
git -C "$work" remote set-url origin "$origin"
git -C "$work" checkout --quiet -B main
cp "$root/scripts/release.sh" "$work/scripts/release.sh"
git -C "$work" commit --quiet --allow-empty -am "test: release.sh under test"
git -C "$work" push --quiet --force origin main
current="$(cd "$work/apps/cli" && npm pkg get version | tr -d '"')"

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
run_release() {
  set +e
  (cd "$work" && bash scripts/release.sh "$@") >"$tmp/out" 2>&1
  status=$?
  set -e
}
says() { grep -qF -- "$1" "$tmp/out"; }

run_release "$version"
check "a signed run stops while main holds the old version" test "$status" -eq 1
check "it names the version main holds" says "release: apps/cli is at $current, not $version"
check "it says to run --bump" says "run scripts/release.sh --bump $version"
check "it leaves no tag" test -z "$(git -C "$work" tag -l "v$version")"

# The version guard reads files only, so it answers before the arm64 check.
mkdir -p "$tmp/intel"
printf '#!/usr/bin/env bash\necho x86_64\n' >"$tmp/intel/uname"
chmod +x "$tmp/intel/uname"
PATH="$tmp/intel:$PATH" run_release "$version"
check "the version guard answers on an Intel Mac too" says "release: apps/cli is at $current, not $version"

run_release --bump "$version"
check "--bump exits 0" test "$status" -eq 0
check "--bump pushes its branch" git -C "$origin" show-ref --verify --quiet "refs/heads/$branch"
check "--bump changes only the six version files" \
  test "$(git -C "$work" diff --name-only main "origin/$branch" | wc -l | tr -d ' ')" -eq 6
check "--bump sets Version.swift" \
  grep -qF "\"$version\"" <(git -C "$work" show "origin/$branch:packages/helper/Sources/HelperCore/Version.swift")
check "--bump opens the pull request" grep -qF "pr create --base main --head $branch" "$tmp/gh.log"
check "--bump goes back to main" test "$(git -C "$work" branch --show-current)" = main
check "--bump leaves the tree clean" test -z "$(git -C "$work" status --porcelain)"
check "--bump leaves main alone" test "$(git -C "$origin" rev-parse main)" = "$(git -C "$work" rev-parse main)"

run_release "$version"
check "a signed run with the bump open stops" test "$status" -eq 1
check "it says to merge the open pull request" says "merge the pull request of $branch"

run_release --bump "$version"
check "a second --bump stops" test "$status" -eq 1
check "it names the branch already on origin" says "release: branch $branch is already on origin"

git -C "$origin" tag "v98.0.0" main
run_release --bump 98.0.0
check "--bump stops on a tag already on origin" says "release: tag v98.0.0 is already on origin"

git -C "$work" switch --quiet -c other
run_release --bump 97.0.0
check "--bump stops off main" says "release: run from main, not other"
git -C "$work" switch --quiet main

if [[ "$failures" -gt 0 ]]; then
  echo "release.test: $failures failed"
  exit 1
fi
echo "release.test: all passed"
