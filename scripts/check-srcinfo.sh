#!/usr/bin/env bash
# Fails when packaging/aur/.SRCINFO has drifted from packaging/aur/PKGBUILD.
# Skips with a clear message when makepkg isn't available (e.g. a non-Arch
# CI runner) rather than failing the build over missing tooling. Run from
# the repo root; wired into ci.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v makepkg >/dev/null 2>&1; then
  echo "skip: makepkg not found -- cannot verify packaging/aur/.SRCINFO against PKGBUILD on this runner"
  exit 0
fi

cd packaging/aur
if ! diff <(makepkg --printsrcinfo) .SRCINFO; then
  echo "error: packaging/aur/.SRCINFO is out of date -- regenerate with:" >&2
  echo "  cd packaging/aur && makepkg --printsrcinfo > .SRCINFO" >&2
  exit 1
fi

echo "OK: .SRCINFO matches PKGBUILD"
