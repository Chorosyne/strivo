#!/usr/bin/env bash
# Assembles a self-contained Linux AppImage: the strivo binary plus
# vendored ffmpeg/ffprobe/streamlink/yt-dlp, bundled per
# docs/adr/0003-installer-packaging-and-bundled-dependencies.md so a user
# never has to install them separately. mpv is NOT bundled here -- see the
# "unresolved" note below; it stays a host dependency on Linux for now.
#
# Usage: packaging/linux/build-appimage.sh <strivo-binary-path> <output-dir>
#
# Downloads are pinned and sha256-verified against packaging/vendored-deps.toml
# -- never trust a mismatch, fail loudly instead.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/packaging/vendored-deps.toml"
STRIVO_BIN="${1:?usage: build-appimage.sh <strivo-binary-path> <output-dir>}"
OUT_DIR="${2:?usage: build-appimage.sh <strivo-binary-path> <output-dir>}"

[[ -x "${STRIVO_BIN}" ]] || { echo "error: ${STRIVO_BIN} is not an executable file" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# The version lives in root Cargo.toml's [workspace.package] table; every
# crate manifest inherits it via `version.workspace = true` rather than
# declaring its own copy (see docs/PACKAGING-PLAN.md "Version
# single-source-of-truth").
VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "${REPO_ROOT}/Cargo.toml" | head -1)"

# --- read a (tool, platform) row out of vendored-deps.toml -----------------
# Small enough a hand-rolled TOML reader would be a wrong abstraction; Python's
# stdlib tomllib (3.11+) does this exactly, no extra dependency to vendor.
manifest_field() {
  local tool="$1" platform="$2" field="$3"
  python3 - "$MANIFEST" "$tool" "$platform" "$field" <<'PY'
import sys, tomllib
path, tool, platform, field = sys.argv[1:5]
with open(path, "rb") as f:
    data = tomllib.load(f)
row = data.get(tool, {}).get(platform, {})
print(row.get(field, ""))
PY
}

fetch_and_verify() {
  local tool="$1" platform="$2" dest="$3"
  local status url sha256
  status="$(manifest_field "$tool" "$platform" status)"
  if [[ "$status" != "resolved" ]]; then
    echo "error: packaging/vendored-deps.toml has no resolved pin for ${tool}.${platform}" >&2
    exit 1
  fi
  url="$(manifest_field "$tool" "$platform" url)"
  sha256="$(manifest_field "$tool" "$platform" sha256)"
  echo "› fetching ${tool} (${platform})"
  curl -fsSL -o "$dest" "$url"
  local actual
  actual="$(sha256sum "$dest" | cut -d' ' -f1)"
  if [[ "$actual" != "$sha256" ]]; then
    echo "error: sha256 mismatch for ${tool}.${platform}: expected ${sha256}, got ${actual}" >&2
    exit 1
  fi
}

echo "== StriVo AppImage build (v${VERSION}) =="

# --- AppDir skeleton ---------------------------------------------------
APPDIR="${WORK}/AppDir"
mkdir -p "${APPDIR}/usr/bin" "${APPDIR}/usr/share/applications" \
         "${APPDIR}/usr/share/icons/hicolor/256x256/apps"

cp "${STRIVO_BIN}" "${APPDIR}/usr/bin/strivo"
cp "${REPO_ROOT}/packaging/linux/AppRun" "${APPDIR}/AppRun"
chmod +x "${APPDIR}/AppRun" "${APPDIR}/usr/bin/strivo"
cp "${REPO_ROOT}/packaging/linux/strivo.desktop" "${APPDIR}/strivo.desktop"
cp "${REPO_ROOT}/packaging/linux/strivo.desktop" "${APPDIR}/usr/share/applications/strivo.desktop"
cp "${REPO_ROOT}/packaging/icons/strivo-256.png" "${APPDIR}/strivo.png"
cp "${REPO_ROOT}/packaging/icons/strivo-256.png" "${APPDIR}/usr/share/icons/hicolor/256x256/apps/strivo.png"

mkdir -p "${APPDIR}/usr/share/doc/strivo/THIRD-PARTY-LICENSES"
cp "${REPO_ROOT}"/packaging/THIRD-PARTY-LICENSES/* "${APPDIR}/usr/share/doc/strivo/THIRD-PARTY-LICENSES/"
cp "${REPO_ROOT}/LICENSE" "${APPDIR}/usr/share/doc/strivo/LICENSE"

# --- ffmpeg + ffprobe (BtbN LGPL static build, tar.xz) ------------------
fetch_and_verify ffmpeg linux_x86_64 "${WORK}/ffmpeg.tar.xz"
mkdir -p "${WORK}/ffmpeg-extract"
tar -xf "${WORK}/ffmpeg.tar.xz" -C "${WORK}/ffmpeg-extract"
# BtbN's archive root dir is named after the exact build (e.g.
# ffmpeg-N-<rev>-<hash>-linux64-lgpl/), not something to hardcode; find the
# bin/ subdirectory it always contains instead.
FFMPEG_BIN_DIR="$(find "${WORK}/ffmpeg-extract" -type d -name bin | head -1)"
cp "${FFMPEG_BIN_DIR}/ffmpeg"  "${APPDIR}/usr/bin/ffmpeg"
cp "${FFMPEG_BIN_DIR}/ffprobe" "${APPDIR}/usr/bin/ffprobe"
chmod +x "${APPDIR}/usr/bin/ffmpeg" "${APPDIR}/usr/bin/ffprobe"

# --- yt-dlp (standalone binary) -----------------------------------------
fetch_and_verify yt-dlp linux_x86_64 "${APPDIR}/usr/bin/yt-dlp"
chmod +x "${APPDIR}/usr/bin/yt-dlp"

# --- streamlink (official AppImage, nested) -----------------------------
# streamlink's own AppImage bundles a Python interpreter -- it is not a
# single native binary we can just copy out. Its AppRun resolves every path
# relative to its own real location (readlink -f "$0"), so nesting the whole
# extracted tree under usr/lib/ and wrapping with a one-line redirect script
# works regardless of who invokes it or from where. Verified locally against
# the actual 8.5.0-1 release before writing this comment.
fetch_and_verify streamlink linux_x86_64 "${WORK}/streamlink.AppImage"
chmod +x "${WORK}/streamlink.AppImage"
( cd "${WORK}" && ./streamlink.AppImage --appimage-extract >/dev/null )
mkdir -p "${APPDIR}/usr/lib/streamlink-appimage"
cp -r "${WORK}/squashfs-root/." "${APPDIR}/usr/lib/streamlink-appimage/"
cat > "${APPDIR}/usr/bin/streamlink" <<'WRAPPER'
#!/bin/sh
HERE="$(dirname "$(readlink -f "${0}")")"
exec "${HERE}/../lib/streamlink-appimage/AppRun" "$@"
WRAPPER
chmod +x "${APPDIR}/usr/bin/streamlink"

# --- mpv: unresolved, see packaging/vendored-deps.toml ------------------
echo "note: mpv is not bundled on Linux (no verified official static build --" \
     "see packaging/vendored-deps.toml [mpv.linux_x86_64]). 'strivo doctor'" \
     "will report it as a host dependency until this is resolved."

# --- pack ----------------------------------------------------------------
APPIMAGETOOL="${WORK}/appimagetool"
if ! command -v appimagetool >/dev/null 2>&1; then
  echo "› fetching appimagetool"
  curl -fsSL -o "${APPIMAGETOOL}" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "${APPIMAGETOOL}"
else
  APPIMAGETOOL="$(command -v appimagetool)"
fi

mkdir -p "${OUT_DIR}"
OUT_FILE="${OUT_DIR}/StriVo-${VERSION}-x86_64.AppImage"
ARCH=x86_64 "${APPIMAGETOOL}" --appimage-extract-and-run "${APPDIR}" "${OUT_FILE}"
sha256sum "${OUT_FILE}" | sed "s#${OUT_DIR}/##" > "${OUT_FILE}.sha256"

echo "== built ${OUT_FILE} =="
