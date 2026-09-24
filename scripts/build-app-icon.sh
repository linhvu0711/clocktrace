#!/usr/bin/env bash
# Compile packages/collector/assets/AppIcon.icon, the Icon Composer source,
# into Assets.car (the layered icon of macOS 26 and later) and AppIcon.icns
# (older macOS) next to it. Needs Xcode 26 or newer. Run it after changing the
# icon and commit both outputs, so setup, the release, and CI never need Xcode.
#   scripts/build-app-icon.sh
set -euo pipefail

cd "$(dirname "$0")/.."

assets="packages/collector/assets"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

# The floor matches the Helper's platform in packages/helper/Package.swift.
xcrun actool "$assets/AppIcon.icon" --compile "$out" --app-icon AppIcon \
  --enable-on-demand-resources NO --development-region en \
  --target-device mac --platform macosx --include-all-app-icons \
  --minimum-deployment-target 13.0 \
  --output-partial-info-plist "$out/partial.plist" >/dev/null
cp "$out/Assets.car" "$out/AppIcon.icns" "$assets/"
echo "build-app-icon: $assets/Assets.car $assets/AppIcon.icns"
