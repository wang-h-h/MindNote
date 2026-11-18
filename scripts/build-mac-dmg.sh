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
hdiutil create -volname MindNote -srcfolder "$scratch/volume" -format UDZO -fs HFS+ "$scratch/$image"
hdiutil verify "$scratch/$image"
mv -f "$scratch/$image" "$output/$image"
printf '%s\n' "$output/$image"
