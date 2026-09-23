#!/usr/bin/env bash
# Build the release tarball release/clocktrace-<version>-darwin-arm64.tar.gz:
# bump the version, build, then stage the CLI with its production dependencies
# (pnpm deploy), the Helper, and Clocktrace.app, and pack them (ADR 0009).
#   scripts/release.sh [--no-sign] <version>
# Without --no-sign the app is signed with the Developer ID, notarized through
# the `clocktrace` keychain profile, and stapled. --no-sign signs it ad hoc,
# packs, and puts the version files back; CI runs it that way. Stops on the
# first failure.
set -euo pipefail

cd "$(dirname "$0")/.."

sign=1
if [[ "${1:-}" == "--no-sign" ]]; then
  sign=0
  shift
fi
if [[ $# -ne 1 ]]; then
  echo "usage: scripts/release.sh [--no-sign] <version>"
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

packages=(apps/cli apps/mcp packages/core packages/collector packages/helper)
version_swift="packages/helper/Sources/HelperCore/Version.swift"
version_files=("$version_swift")
for package in "${packages[@]}"; do
  version_files+=("$package/package.json")
done

# The bump stays only in the release commit; any other exit puts it back.
committed=0
restore() {
  if [[ "$committed" == "0" ]]; then
    git checkout -- "${version_files[@]}"
  fi
}
trap restore EXIT

echo "release: version $version"
for package in "${packages[@]}"; do
  (cd "$package" && npm pkg set version="$version")
done
sed -i '' -E "s/\"[^\"]*\"/\"$version\"/" "$version_swift"

pnpm build

stage="release/stage"
app="$stage/helper/Clocktrace.app"
helper="packages/helper/.build/release/clocktrace-helper"
tarball="release/clocktrace-$version-darwin-arm64.tar.gz"
rm -rf "$stage" "$tarball"
pnpm --filter @clocktrace/cli deploy --prod "$PWD/$stage"
ln -s bin/clocktrace.js "$stage/clocktrace"

# The same bundle setup writes in development (packages/collector/src/app.ts),
# next to the Helper, where setup copies it whole.
mkdir -p "$app/Contents/MacOS"
cp "$helper" "$stage/helper/clocktrace-helper"
cp "$helper" "$app/Contents/MacOS/Clocktrace"
chmod 755 "$stage/helper/clocktrace-helper" "$app/Contents/MacOS/Clocktrace"
node --input-type=module \
  -e 'import { infoPlist } from "./packages/collector/dist/index.js"; process.stdout.write(infoPlist());' \
  >"$app/Contents/Info.plist"

if [[ "$sign" == "0" ]]; then
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
echo "release: $tarball"
shasum -a 256 "$tarball"
