#!/usr/bin/env bash
# Build the release tarball release/clocktrace-<version>-darwin-arm64.tar.gz:
# build, then stage the CLI with its production dependencies (pnpm deploy), the
# Helper, and Clocktrace.app, and pack them (ADR 0010).
#   scripts/release.sh --bump <version>
#   scripts/release.sh [--no-sign] <version>
# main takes changes only through a pull request, so a release is two runs.
# --bump sets the version in the five package.json files and Version.swift on a
# branch, pushes it, and opens the pull request. Once it is merged, the run
# without a flag builds from main, signs the app with the Developer ID,
# notarizes it through the `clocktrace` keychain profile, staples it, tags main,
# pushes only the tag, and publishes with gh. --no-sign sets the version, signs
# ad hoc, packs, and puts the version files back; CI runs it that way. Stops on
# the first failure.
set -euo pipefail

cd "$(dirname "$0")/.."

mode=sign
case "${1:-}" in
  --no-sign)
    mode=no-sign
    shift
    ;;
  --bump)
    mode=bump
    shift
    ;;
esac
if [[ $# -ne 1 ]]; then
  echo "usage: scripts/release.sh [--bump | --no-sign] <version>"
  exit 1
fi
version="$1"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release: version must look like 1.2.3, got $version"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "release: the tree has uncommitted changes, commit or stash them first"
  exit 1
fi

packages=(apps/cli packages/core packages/collector packages/mcp packages/helper)
version_swift="packages/helper/Sources/HelperCore/Version.swift"
version_files=("$version_swift")
for package in "${packages[@]}"; do
  version_files+=("$package/package.json")
done

set_version() {
  for package in "${packages[@]}"; do
    (cd "$package" && npm pkg set version="$version")
  done
  sed -i '' -E "s/\"[^\"]*\"/\"$version\"/" "$version_swift"
}

# --bump and a signed release both start from what GitHub holds.
if [[ "$mode" != "no-sign" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" != "main" ]]; then
    echo "release: run from main, not $branch"
    exit 1
  fi
  git fetch --quiet origin main
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    echo "release: main is not in sync with origin/main"
    exit 1
  fi
  if [[ -n "$(git ls-remote --tags origin "v$version")" ]]; then
    echo "release: tag v$version is already on origin"
    exit 1
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "release: gh is not signed in"
    exit 1
  fi
fi

if [[ "$mode" == "bump" ]]; then
  bump_branch="chore/release-v$version"
  if [[ -n "$(git ls-remote --heads origin "$bump_branch")" ]]; then
    echo "release: branch $bump_branch is already on origin"
    exit 1
  fi
  # Every exit goes back to main. Before the push it also drops the local
  # branch, so the same version can run again.
  bump_pushed=0
  # shellcheck disable=SC2329 # the EXIT trap calls it
  leave_bump() {
    git switch --quiet --force main
    if [[ "$bump_pushed" == "0" ]]; then
      git branch --quiet -D "$bump_branch" 2>/dev/null || true
    fi
  }
  trap leave_bump EXIT
  git switch --quiet -c "$bump_branch"
  set_version
  git commit --quiet -m "chore: release v$version" -- "${version_files[@]}"
  git push --quiet -u origin "$bump_branch"
  bump_pushed=1
  gh pr create --base main --head "$bump_branch" \
    --title "chore: release v$version" \
    --body "Sets the version to $version. Once this is merged, pull main and run \`scripts/release.sh $version\` to build, sign, tag, and publish it."
  echo "release: merge the pull request, pull main, then run scripts/release.sh $version"
  exit 0
fi

# The build is native, and v0 ships arm64 only.
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "release: an arm64 Mac is required, this is $(uname -m)"
  exit 1
fi

# A signed release builds what main holds, so the version must already be
# there, merged through the --bump pull request.
if [[ "$mode" == "sign" ]]; then
  for package in "${packages[@]}"; do
    found="$(cd "$package" && npm pkg get version | tr -d '"')"
    if [[ "$found" != "$version" ]]; then
      echo "release: $package is at $found, not $version. Run scripts/release.sh --bump $version and merge its pull request first"
      exit 1
    fi
  done
  if ! grep -q "\"$version\"" "$version_swift"; then
    echo "release: $version_swift is not at $version. Run scripts/release.sh --bump $version and merge its pull request first"
    exit 1
  fi
fi

# --no-sign puts the version files back on any exit. A signed release takes
# back its local tag on any exit before the push, so the same version can run
# again.
tagged=0
pushed=0
cleanup() {
  if [[ "$mode" == "no-sign" ]]; then
    git checkout HEAD -- "${version_files[@]}"
  fi
  if [[ "$tagged" == "1" && "$pushed" == "0" ]]; then
    git tag -d "v$version" >/dev/null
  fi
}
trap cleanup EXIT

echo "release: version $version"
if [[ "$mode" == "no-sign" ]]; then
  set_version
fi

pnpm build

stage="release/stage"
app="$stage/helper/Clocktrace.app"
helper="packages/helper/.build/release/clocktrace-helper"
tarball="release/clocktrace-$version-darwin-arm64.tar.gz"
rm -rf "$stage" "$tarball"
pnpm --filter @clocktrace/cli deploy --prod "$PWD/$stage"
ln -s bin/clocktrace.js "$stage/clocktrace"
cp LICENSE "$stage/LICENSE"

# The same bundle setup writes in development (packages/collector/src/app.ts),
# next to the Helper, where setup copies it whole.
mkdir -p "$app/Contents/MacOS"
cp "$helper" "$stage/helper/clocktrace-helper"
cp "$helper" "$app/Contents/MacOS/Clocktrace"
chmod 755 "$stage/helper/clocktrace-helper" "$app/Contents/MacOS/Clocktrace"
node --input-type=module \
  -e 'import { infoPlist } from "./packages/collector/dist/index.js"; process.stdout.write(infoPlist());' \
  >"$app/Contents/Info.plist"
mkdir -p "$app/Contents/Resources"
cp packages/collector/assets/Assets.car packages/collector/assets/AppIcon.icns \
  "$app/Contents/Resources/"

if [[ "$mode" == "no-sign" ]]; then
  codesign --force --sign - "$app"
else
  # The Hardened Runtime blocks Apple Events without the entitlement, and the
  # Helper reads the browser URL through them.
  codesign --force --sign "Developer ID Application" --options runtime \
    --timestamp --deep --entitlements scripts/clocktrace.entitlements "$app"
  zip="release/Clocktrace.zip"
  rm -f "$zip"
  ditto -c -k --keepParent "$app" "$zip"
  xcrun notarytool submit "$zip" --keychain-profile clocktrace --wait
  xcrun stapler staple "$app"
  signature="$(codesign -dv --verbose=2 "$app" 2>&1)"
  echo "$signature"
  if ! grep -q "^Authority=Developer ID Application" <<<"$signature"; then
    echo "release: Clocktrace.app is not signed with the Developer ID"
    exit 1
  fi
  spctl --assess --type execute -vv "$app"
fi

tar -czf "$tarball" -C "$stage" .
# MIT needs the notice in every copy, and pnpm deploy leaves it out.
if ! tar -tzf "$tarball" ./LICENSE >/dev/null 2>&1; then
  echo "release: $tarball has no LICENSE"
  exit 1
fi
echo "release: $tarball"
shasum -a 256 "$tarball"

if [[ "$mode" == "sign" ]]; then
  hash="$(shasum -a 256 "$tarball" | cut -d " " -f 1)"
  # main takes changes only through a pull request, but tags are open: the
  # release pushes only its tag, on the commit the --bump pull request merged.
  git tag "v$version"
  tagged=1
  git push --quiet origin "v$version"
  pushed=1
  if ! gh release create "v$version" "$tarball" --title "v$version" \
    --notes "sha256: $hash" --verify-tag; then
    echo "release: v$version is pushed, but the GitHub release failed. Publish it with:"
    echo "  gh release create v$version $tarball --title v$version --notes \"sha256: $hash\" --verify-tag"
    exit 1
  fi
fi
