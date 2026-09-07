#!/usr/bin/env bash
# V07 (docs/audits/2026-09-06-web-surface) — jobs.db connection-handle
# benchmark. Boots one compiled strivo binary's daemon + web process against
# a freshly seeded 50,000-row jobs.db in a fully sandboxed XDG root, then
# runs three workloads (sequential N=500, concurrent c=8 N=500, concurrent
# c=16 N=500) against the real HTTP surface — GET /api/v1/history?limit=50,
# the same paginated route the SPA calls — and prints one JSON line per
# workload with the wall-clock-derived avg ms/request.
#
# Mirrors crates/strivo-web/e2e/real-server.sh's sandboxing technique (every
# strivo path resolves off $HOME/$XDG_*_HOME, so a naive run would collide
# with a real installation), plus the short-sandbox-path fix from V07's
# closure evidence (a long XDG_STATE_HOME hits SUN_LEN on the daemon's Unix
# socket — hence /tmp/<name> rather than $TMPDIR/a-much-longer-path).
#
# Usage:
#   cargo build --release -p strivo-bin
#   scripts/bench_jobs_db.sh target/release/strivo [label] [rows]
#
# To reproduce the V07 A/B/C comparison (per-request open vs the old shared
# Mutex<Connection> vs the pooled design in src/recording/persist.rs):
#   1. Build the current tree's release binary — this is arm C (pooled).
#   2. `git show <pre-V07-commit>:src/recording/persist.rs > /tmp/persist.old.rs`,
#      swap it into src/recording/persist.rs, rebuild — this is arm B (mutex).
#   3. With that same old persist.rs, additionally change
#      crates/strivo-web/src/routes/api.rs's `history` handler to call
#      `PersistDb::open(&state.jobs_db_path)` per request instead of
#      `state.jobs_db()`, rebuild — this is arm A (per-request open).
#   4. Restore both files, rebuild, and diff the JSON lines this script
#      prints for each binary. Keep workloads separate; never average across
#      sequential and concurrent numbers.
set -euo pipefail

BIN="${1:?usage: bench_jobs_db.sh <strivo-binary> [label] [rows]}"
LABEL="${2:-bench}"
ROWS="${3:-50000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8381}"
API_KEY="v07-bench-key"
N="${BENCH_N:-500}"

SANDBOX_ROOT="/tmp/strivo-jobsdb-bench"
mkdir -p "$SANDBOX_ROOT"
WORKDIR="$(mktemp -d "$SANDBOX_ROOT/s.XXXXXX")"
export HOME="$WORKDIR"
export XDG_CONFIG_HOME="$WORKDIR/.c"
export XDG_DATA_HOME="$WORKDIR/.d"
export XDG_STATE_HOME="$WORKDIR/.s"
export XDG_CACHE_HOME="$WORKDIR/.ca"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

DAEMON_PID=""
SERVE_PID=""
cleanup() {
  trap - EXIT INT TERM
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true
  [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT INT TERM

# Seed jobs.db BEFORE the daemon starts, at the exact path strivo-core's
# AppConfig::data_dir() resolves to under this sandboxed XDG root.
DATA_DIR="$XDG_DATA_HOME/strivo"
mkdir -p "$DATA_DIR"
python3 "$SCRIPT_DIR/seed_jobs_db.py" "$DATA_DIR/jobs.db" "$ROWS" >&2

"$BIN" daemon &
DAEMON_PID=$!
daemon_up=0
for _ in $(seq 1 100); do
  if "$BIN" status >/dev/null 2>&1; then daemon_up=1; break; fi
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then break; fi
  sleep 0.2
done
if [ "$daemon_up" -ne 1 ]; then
  echo "bench_jobs_db.sh[$LABEL]: daemon never came up" >&2
  find "$XDG_STATE_HOME" -name 'strivo.*.log' -exec tail -n 100 {} \; >&2 || true
  exit 1
fi

"$BIN" serve --bind "127.0.0.1:$PORT" --api-key "$API_KEY" &
SERVE_PID=$!
BASE_URL="http://127.0.0.1:$PORT"
up=0
for _ in $(seq 1 100); do
  # Any HTTP response (200, or the sandbox's expected 503-disk-warn since
  # its fake recording dir doesn't exist) proves the listener + jobs_db
  # init path are alive; only a connection failure means "not up yet".
  if curl -s -o /dev/null "$BASE_URL/api/v1/health" 2>/dev/null; then up=1; break; fi
  sleep 0.2
done
if [ "$up" -ne 1 ]; then
  echo "bench_jobs_db.sh[$LABEL]: web server never came up" >&2
  exit 1
fi

echo "== $LABEL ($ROWS rows) ==" >&2
python3 "$SCRIPT_DIR/loadgen.py" --base-url "$BASE_URL" --api-key "$API_KEY" --n "$N" --concurrency 1  --label "$LABEL:sequential:N=$N"
python3 "$SCRIPT_DIR/loadgen.py" --base-url "$BASE_URL" --api-key "$API_KEY" --n "$N" --concurrency 8  --label "$LABEL:c8:N=$N"
python3 "$SCRIPT_DIR/loadgen.py" --base-url "$BASE_URL" --api-key "$API_KEY" --n "$N" --concurrency 16 --label "$LABEL:c16:N=$N"
