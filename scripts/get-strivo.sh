#!/usr/bin/env bash
# StriVo AppImage installer/launcher — batteries-included, no Rust toolchain,
# no separate ffmpeg/mpv/streamlink/yt-dlp install required (see
# docs/adr/0003-installer-packaging-and-bundled-dependencies.md; mpv is the
# one exception, still a host dependency on Linux for now — see
# packaging/vendored-deps.toml).
#
# This is the consumer install path. scripts/install.sh remains the
# from-source, build-it-yourself dev path and is unaffected by this script.
#
#   curl -fsSL https://raw.githubusercontent.com/revoydotdev/strivo/main/scripts/get-strivo.sh | bash
#   curl -fsSL .../get-strivo.sh | bash -s -- install   # non-interactive
#
# Run with no arguments and a real terminal attached to get the menu below;
# run with a subcommand (install/launch/enable/disable/uninstall/update) for
# a scriptable, non-interactive one-shot action — this is also what a
# curl-piped invocation with no TTY falls back to automatically.
set -euo pipefail

REPO="revoydotdev/strivo"
APP_DIR="${STRIVO_APPIMAGE_DIR:-${HOME}/.local/share/strivo}"
BIN_DIR="${STRIVO_APPIMAGE_BIN_DIR:-${HOME}/.local/bin}"
APPIMAGE_PATH="${APP_DIR}/StriVo.AppImage"
LAUNCHER_PATH="${BIN_DIR}/strivo"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"

c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_cyan=$'\033[36m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'

banner() {
  cat <<EOF
${c_cyan}${c_bold}
   _____ _        _  __     __
  / ____| |      (_) \\ \\   / /
 | (___ | |_ _ __ ___\\ \\_/ /__
  \\___ \\| __| '__| \\ \\   / _ \\
  ____) | |_| |  | |\\ V | (_) |
 |_____/ \\__|_|  |_| \\_/ \\___/${c_reset}
 ${c_bold}self-hosted live-stream PVR${c_reset} — Twitch · YouTube · Patreon

EOF
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required but not found" >&2; exit 1; }; }

# Downloads the sibling <url>.sha256 asset (published alongside every
# AppImage by release.yml's build-linux job, see
# packaging/linux/build-appimage.sh) and verifies $dest against it with
# `sha256sum -c`, mirroring build-appimage.sh's own fetch_and_verify().
# Fails loudly -- and removes the unverified download -- on a checksum
# mismatch or a missing/malformed .sha256 asset; never installs on trust.
verify_appimage() {
  local url="$1" dest="$2"
  local sha_url="${url}.sha256"
  local checksum_raw
  checksum_raw="$(curl -fsSL "$sha_url" || true)"
  if [[ -z "$checksum_raw" ]]; then
    echo "error: no .sha256 checksum published at ${sha_url} -- refusing to install an unverified binary" >&2
    rm -f "$dest"
    exit 1
  fi

  local expected_sha
  expected_sha="$(printf '%s' "$checksum_raw" | awk 'NR==1{print $1}')"
  if [[ ! "$expected_sha" =~ ^[0-9a-f]{64}$ ]]; then
    echo "error: malformed checksum data from ${sha_url}" >&2
    rm -f "$dest"
    exit 1
  fi

  local checksum_file
  checksum_file="$(dirname "$dest")/.$(basename "$dest").sha256"
  printf '%s  %s\n' "$expected_sha" "$(basename "$dest")" > "$checksum_file"
  if ! ( cd "$(dirname "$dest")" && sha256sum -c "$(basename "$checksum_file")" --status ); then
    echo "error: sha256 mismatch for $(basename "$dest") -- refusing to install a tampered or corrupted download" >&2
    rm -f "$dest" "$checksum_file"
    exit 1
  fi
  rm -f "$checksum_file"
  echo "› checksum verified"
}

latest_appimage_url() {
  need curl
  # GitHub's unauthenticated API is rate-limited but fine for an occasional
  # installer run; no token handling needed for a public repo's releases.
  # `|| true` on each stage: with pipefail set, grep/sed finding nothing is a
  # normal "no AppImage in this release yet" outcome, not a script-ending
  # error — do_install turns an empty result into a clear message itself.
  local release_json url
  release_json="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" || true)"
  url="$(printf '%s' "$release_json" \
    | grep -o '"browser_download_url": *"[^"]*StriVo-[^"]*-x86_64\.AppImage"' \
    | head -1 \
    | sed -E 's/.*"(https:\/\/[^"]+)"/\1/' || true)"
  printf '%s' "$url"
}

do_install() {
  need curl
  need sha256sum
  local url
  url="$(latest_appimage_url)"
  [[ -n "$url" ]] || { echo "error: couldn't find a Linux AppImage in the latest release" >&2; exit 1; }

  echo "› downloading $(basename "$url")"
  mkdir -p "${APP_DIR}" "${BIN_DIR}"
  curl -fsSL -o "${APPIMAGE_PATH}.new" "$url"
  verify_appimage "$url" "${APPIMAGE_PATH}.new"
  chmod +x "${APPIMAGE_PATH}.new"
  mv -f "${APPIMAGE_PATH}.new" "${APPIMAGE_PATH}"

  cat > "${LAUNCHER_PATH}" <<LAUNCHER
#!/usr/bin/env bash
exec "${APPIMAGE_PATH}" "\$@"
LAUNCHER
  chmod +x "${LAUNCHER_PATH}"

  # Desktop integration is best-effort — a headless/server install has
  # neither directory populated by a desktop environment, and that's fine.
  if mkdir -p "${DESKTOP_DIR}" "${ICON_DIR}" 2>/dev/null; then
    local extract_dir
    extract_dir="$(mktemp -d)"
    ( cd "${extract_dir}" \
      && "${APPIMAGE_PATH}" --appimage-extract usr/share/applications/strivo.desktop >/dev/null 2>&1 || true )
    ( cd "${extract_dir}" \
      && "${APPIMAGE_PATH}" --appimage-extract usr/share/icons/hicolor/256x256/apps/strivo.png >/dev/null 2>&1 || true )
    [[ -f "${extract_dir}/squashfs-root/usr/share/applications/strivo.desktop" ]] && \
      cp "${extract_dir}/squashfs-root/usr/share/applications/strivo.desktop" "${DESKTOP_DIR}/strivo.desktop"
    [[ -f "${extract_dir}/squashfs-root/usr/share/icons/hicolor/256x256/apps/strivo.png" ]] && \
      cp "${extract_dir}/squashfs-root/usr/share/icons/hicolor/256x256/apps/strivo.png" "${ICON_DIR}/strivo.png"
    rm -rf "${extract_dir}"
  fi

  echo "${c_green}✓ Installed${c_reset} ${APPIMAGE_PATH}"
  echo "  Linked as ${LAUNCHER_PATH}"
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) echo "  ${c_yellow}Add ${BIN_DIR} to your PATH to run 'strivo' directly.${c_reset}" ;;
  esac
  "${APPIMAGE_PATH}" doctor || true
}

do_launch() {
  [[ -x "${APPIMAGE_PATH}" ]] || { echo "error: not installed yet — run with 'install' first" >&2; exit 1; }
  echo "Starting StriVo — open http://127.0.0.1:8181 once it's up."
  exec "${APPIMAGE_PATH}"
}

do_enable()  { [[ -x "${APPIMAGE_PATH}" ]] || { echo "error: not installed yet" >&2; exit 1; }; "${APPIMAGE_PATH}" enable; }
do_disable() { [[ -x "${APPIMAGE_PATH}" ]] || { echo "error: not installed yet" >&2; exit 1; }; "${APPIMAGE_PATH}" disable; }

do_uninstall() {
  "${APPIMAGE_PATH}" disable 2>/dev/null || true
  rm -f "${APPIMAGE_PATH}" "${LAUNCHER_PATH}" "${DESKTOP_DIR}/strivo.desktop" "${ICON_DIR}/strivo.png"
  echo "${c_green}✓ Removed StriVo program files.${c_reset} Configuration and recordings were preserved."
}

menu() {
  banner
  local status="not installed"
  [[ -x "${APPIMAGE_PATH}" ]] && status="installed at ${APPIMAGE_PATH}"
  echo " Status: ${status}"
  echo ""
  echo "  1) Install / update"
  echo "  2) Launch"
  echo "  3) Enable background service (systemd --user)"
  echo "  4) Disable background service"
  echo "  5) Uninstall"
  echo "  6) Exit"
  echo ""
  read -r -p "Choose an option [1-6]: " choice
  case "$choice" in
    1) do_install ;;
    2) do_launch ;;
    3) do_enable ;;
    4) do_disable ;;
    5) do_uninstall ;;
    6|"") exit 0 ;;
    *) echo "not a valid option" ;;
  esac
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    install|update) do_install ;;
    launch)         do_launch ;;
    enable)         do_enable ;;
    disable)        do_disable ;;
    uninstall)      do_uninstall ;;
    "")
      if [[ -t 0 && -t 1 ]]; then
        while true; do menu; echo; done
      else
        # Piped, no TTY, no subcommand: install is the useful default for
        # `curl ... | bash` — matches the one-shot installer convention.
        do_install
      fi
      ;;
    *) echo "usage: $0 [install|launch|enable|disable|uninstall]" >&2; exit 2 ;;
  esac
}

main "$@"
