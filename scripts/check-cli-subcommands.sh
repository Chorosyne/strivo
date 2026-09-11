#!/usr/bin/env bash
# Fails when config.toml.example, CONTRIBUTING.md, or docs/*.md mention a
# `strivo <subcommand>` that doesn't exist in crates/strivo-bin/src/cli.rs's
# `Command` enum -- catching dead-CLI-reference doc drift like the removed
# `strivo theme` subcommand. Run from the repo root; wired into ci.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

CLI_RS="crates/strivo-bin/src/cli.rs"

python3 - "$CLI_RS" docs/*.md CONTRIBUTING.md config.toml.example <<'PY'
import re, sys

cli_rs_path = sys.argv[1]
doc_paths = sys.argv[2:]

with open(cli_rs_path, encoding="utf-8") as f:
    src = f.read()

m = re.search(r"pub enum Command \{", src)
if not m:
    print("error: could not find `pub enum Command {` in cli.rs", file=sys.stderr)
    sys.exit(1)
body_start = m.end()
close_m = re.search(r"^\}", src[body_start:], re.MULTILINE)
body = src[body_start: body_start + close_m.start()]

# Top-level (4-space-indented) variant names only -- e.g. `    Daemon,` or
# `    Enable {`. clap's default derive rename for both variants and their
# generated subcommand name is kebab-case.
variants = re.findall(r"^    (\w+)\s*[,{]", body, re.MULTILINE)

def to_kebab(name: str) -> str:
    s = re.sub(r"(?<!^)(?=[A-Z])", "-", name)
    return s.lower()

valid = {to_kebab(v) for v in variants}

# Two ways a doc names a real invocation:
#   (a) inline code: `strivo <word>`
#   (b) a bare shell-example line inside a fenced ``` code block
#   (c) an indented comment example, e.g. "#   strivo config path"
#       (config.toml.example's own convention, no fences in a TOML file)
# Subcommands are always lowercase kebab-case (clap's default derive
# rename), so requiring a lowercase first letter both matches real usage
# and rules out e.g. `docker ps` output naming a container "strivo" next
# to a capitalized status word ("strivo   Up 10 seconds").
backtick_re = re.compile(r"`strivo\s+([a-z][\w-]*)")
comment_example_re = re.compile(r"^#\s+strivo\s+([a-z][\w-]*)")

missing = []
for path in doc_paths:
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        continue

    in_fence = False
    for lineno, line in enumerate(lines, start=1):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue

        found = []
        found += backtick_re.findall(line)
        m2 = comment_example_re.match(line)
        if m2:
            found.append(m2.group(1))
        if in_fence:
            stripped = line.strip()
            m3 = re.match(r"^strivo\s+([a-z][\w-]*)", stripped)
            if m3:
                found.append(m3.group(1))

        for token in found:
            if token not in valid:
                missing.append((path, lineno, token))

if missing:
    print("error: reference to a strivo subcommand that doesn't exist in cli.rs:", file=sys.stderr)
    for path, lineno, token in missing:
        print(f"  - {path}:{lineno}: `strivo {token}`", file=sys.stderr)
    print(f"valid top-level subcommands: {', '.join(sorted(valid))}", file=sys.stderr)
    sys.exit(1)

print("OK: every documented `strivo <subcommand>` exists in cli.rs")
PY
