# Plugin Manifest Format (M4.4)

Yazi-inspired (see YAZI-AUDIT.md §5). Drop a TOML file at
`~/.config/strivo/plugins/<slug>.toml` and StriVo will discover it on
startup and list it in the Settings tab.

Today the manifests are **informational only** — they don't dynamically
load Rust code. The runtime loader (cdylib + `libloading`) is on the
M4 polish-bucket list; this schema lands first so existing first-party
plugins can advertise the same metadata and so the user has a stable
discovery surface to write against.

## Fields

```toml
name           = "scratchpad"
version        = "0.1.0"
description    = "Quick-notes scratchpad pinned to F2"
activation_key = "F2"                 # yazi syntax: "F2", "<C-x>", single char
pane           = "right"              # "right" | "overlay" | "statusbar"
library_path   = "~/scratchpad.so"    # reserved; cdylib path for future loader
```

All fields except `name` are optional. Unknown fields are ignored (so
future StriVo versions can extend the schema without breaking older
manifests).

## How discovery works

- `~/.config/strivo/plugins/` is scanned at AppState construction.
- Each `*.toml` file is read; parse errors are logged and skipped.
- Successfully parsed manifests appear in **Settings → Plugins** as
  rows showing `<name>  v<version> · <activation_key>` plus the
  description as the hint.
- Files without a `.toml` extension are ignored.
- Missing directory: silently no-ops. Drop a manifest in to enable.

## Limits

- **No dynamic loading yet.** A manifest doesn't run code. The
  `library_path` field is reserved.
- **Activation keys are advisory.** The keymap table doesn't bind
  manifest activation keys automatically — wire them through the
  plugin trait once the dynamic loader is in.
- **First-party plugins** (Crunchr, Archiver) compile in via the path
  dep and don't need manifests; they will gain optional manifests in
  the same pass that introduces dynamic loading so the surface is
  uniform.

## Companion docs

- `YAZI-AUDIT.md` §5 — original audit + scope decision (no Lua).
- `ROADMAP.md` M4 Phase 4 — plugin manifest + discovery item.
