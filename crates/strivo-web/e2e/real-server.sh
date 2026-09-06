#!/usr/bin/env bash
# S04 — boots the REAL compiled strivo-web server (daemon + web process,
# same two binaries production runs) for the "real-server" Playwright
# lane, as opposed to tests/*.spec.ts's Node mock backend.
#
# Every strivo path that identifies "the" daemon on this machine
# (config dir, state dir incl. the PID file + IPC socket, data dir, cache
# dir) comes from `directories::ProjectDirs::from("", "", "strivo")`,
# which resolves relative to $HOME/$XDG_*_HOME — NOT from --config. So a
# naive `strivo daemon` here would either attach to a real daemon already
# running under this account, or clobber its config/state. We sandbox
# every one of those XDG roots under a fresh temp dir instead, so this
# lane can never see or touch a real installation.
set -euo pipefail

STRIVO_BIN="${STRIVO_BIN:?set STRIVO_BIN to the compiled strivo binary path}"
PORT="${PORT:-8281}"
API_KEY="${STRIVO_E2E_API_KEY:-strivo-e2e-real-server-test-key}"

SANDBOX_ROOT="${TMPDIR:-/tmp}"
# Playwright tears this script's process tree down with a plain kill (not
# always a trappable signal we get to react to), so the EXIT trap below is
# best-effort, not guaranteed. Self-heal instead of relying on it: sweep
# sandboxes from runs that didn't clean up, once, before making a new one.
find "$SANDBOX_ROOT" -maxdepth 1 -name 'strivo-e2e-sandbox.*' -mmin +10 -exec rm -rf {} + 2>/dev/null || true

WORKDIR="$(mktemp -d "$SANDBOX_ROOT/strivo-e2e-sandbox.XXXXXX")"
export HOME="$WORKDIR"
export XDG_CONFIG_HOME="$WORKDIR/.config"
export XDG_DATA_HOME="$WORKDIR/.local/share"
export XDG_STATE_HOME="$WORKDIR/.local/state"
export XDG_CACHE_HOME="$WORKDIR/.cache"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

DAEMON_PID=""
SERVE_PID=""

cleanup() {
  trap - EXIT INT TERM
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true
  [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$WORKDIR"
  exit 0
}
trap cleanup EXIT INT TERM

"$STRIVO_BIN" daemon &
DAEMON_PID=$!

daemon_up=0
for _ in $(seq 1 50); do
  if "$STRIVO_BIN" status >/dev/null 2>&1; then
    daemon_up=1
    break
  fi
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

if [ "$daemon_up" -ne 1 ]; then
  echo "real-server.sh: daemon never came up; recent log:" >&2
  find "$XDG_STATE_HOME" -name 'strivo.*.log' -exec tail -n 100 {} \; >&2 || true
  exit 1
fi

"$STRIVO_BIN" serve --bind "127.0.0.1:$PORT" --api-key "$API_KEY" &
SERVE_PID=$!
wait "$SERVE_PID"
