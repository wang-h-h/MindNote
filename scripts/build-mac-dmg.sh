#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin ]] || { echo 'Build the DMG on macOS.' >&2; exit 1; }
arch="$(node -p 'process.arch')"
version="$(node -p 'require("./package.json").version')"
app="out/MindNote-darwin-$arch/MindNote.app"
output="out/make/macos/$arch"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$output" "$scratch/volume"

codesign --verify --deep --strict "$app"
ditto "$app" "$scratch/volume/MindNote.app"
ln -s /Applications "$scratch/volume/Applications"
image="MindNote-$version-macOS-$arch.dmg"
# The disk image service can report EBUSY on hosted Macs immediately after copying a bundle.
for attempt in 1 2 3; do
  candidate="$scratch/image-$attempt.dmg"
  if hdiutil create -volname MindNote -srcfolder "$scratch/volume" -format UDZO -fs HFS+ "$candidate"; then
    break
  fi
  [[ "$attempt" != 3 ]] || exit 1
  sleep 5
done
hdiutil verify "$candidate"
mv -f "$candidate" "$output/$image"
printf '%s\n' "$output/$image"
