#!/usr/bin/env bash
# Fails when a top-level AppConfig field (src/config/mod.rs) has no mention
# in config.toml.example, so the example can't silently fall behind the
# real schema again. Run from the repo root; wired into ci.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG_RS="src/config/mod.rs"
EXAMPLE="config.toml.example"

python3 - "$CONFIG_RS" "$EXAMPLE" <<'PY'
import re, sys

config_rs_path, example_path = sys.argv[1:3]
with open(config_rs_path, encoding="utf-8") as f:
    src = f.read()

# Isolate the `pub struct AppConfig { ... }` body: start at its opening
# brace, stop at the first top-level (column-0) closing brace after it.
m = re.search(r"pub struct AppConfig \{", src)
if not m:
    print("error: could not find `pub struct AppConfig {` in src/config/mod.rs", file=sys.stderr)
    sys.exit(1)
body_start = m.end()
close_m = re.search(r"^\}", src[body_start:], re.MULTILINE)
if not close_m:
    print("error: could not find the end of AppConfig's struct body", file=sys.stderr)
    sys.exit(1)
body = src[body_start: body_start + close_m.start()]

# Direct (4-space-indented) `pub <field>:` fields only -- excludes fields
# declared on nested structs (which are indented deeper).
fields = re.findall(r"^    pub (\w+):", body, re.MULTILINE)

# Not real TOML keys in the example: config_path is #[serde(skip)]
# (in-memory only), and extensions is #[serde(flatten)] -- its whole point
# is that arbitrary plugin-owned top-level tables round-trip through it
# with no fixed key of their own.
skip = {"config_path", "extensions"}
fields = [f for f in fields if f not in skip]

with open(example_path, encoding="utf-8") as f:
    example = f.read()

missing = [f for f in fields if not re.search(rf"\b{re.escape(f)}\b", example)]

if missing:
    print(f"error: {example_path} has no mention of these AppConfig fields:", file=sys.stderr)
    for f in missing:
        print(f"  - {f}", file=sys.stderr)
    sys.exit(1)

print(f"OK: every top-level AppConfig field is documented in {example_path}")
PY
