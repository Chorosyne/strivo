#!/usr/bin/env bash
# Fails when packaging/vendored-deps.toml has a resolved (tool, platform) pin
# with no matching cross-reference line in
# packaging/THIRD-PARTY-LICENSES/NOTICE.md, so the compliance bundle can
# never silently drift behind what's actually bundled (see
# docs/adr/0003-installer-packaging-and-bundled-dependencies.md). Run from
# the repo root; wired into ci.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST="packaging/vendored-deps.toml"
NOTICE="packaging/THIRD-PARTY-LICENSES/NOTICE.md"

python3 - "$MANIFEST" "$NOTICE" <<'PY'
import sys, tomllib

manifest_path, notice_path = sys.argv[1:3]
with open(manifest_path, "rb") as f:
    manifest = tomllib.load(f)
with open(notice_path, "r", encoding="utf-8") as f:
    notice = f.read()

missing = []
for tool, platforms in manifest.items():
    if not isinstance(platforms, dict):
        continue
    for platform, row in platforms.items():
        if not isinstance(row, dict):
            continue
        if row.get("status") != "resolved":
            continue
        needle = f"[{tool}.{platform}]"
        if needle not in notice:
            missing.append(needle)

if missing:
    print("error: NOTICE.md is missing a pin reference for:", file=sys.stderr)
    for m in missing:
        print(f"  - {m}", file=sys.stderr)
    print(f"add a line naming {{}} to {notice_path}".format(", ".join(missing)), file=sys.stderr)
    sys.exit(1)

print(f"OK: every resolved pin in {manifest_path} has a NOTICE.md reference")
PY
