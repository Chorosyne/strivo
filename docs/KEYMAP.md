# Keymap Conventions (M3.2)

Companion to `src/tui/keymap.rs` (the runtime source of truth) and the
auto-generated help overlay (`?`). This doc covers the *conventions* the
table follows, not the exhaustive list of bindings.

## Precedence

Layers are consulted in this order; the first match wins:

```
overlay > plugin > pane > global
```

Concretely:
- **Overlay** layers (TextInput, EventLog, ThemePicker, QuitConfirm,
  PropertiesModal, PlatformDebugModal, SearchInput) swallow keys
  outright while open. The global dispatcher short-circuits to the
  overlay before consulting any table.
- **Plugin** activation commands run before pane dispatch so a plugin
  bound to e.g. `Ctrl+C` wins over the active pane.
- **Pane** layers (Sidebar, Detail, RecordingList, Schedule, Settings,
  Log, Wizard, StatusBar) own their pane-local bindings.
- **Global** keys (Quit, Help, Theme picker, Event log, Schedule pane,
  Log pane, Search) fall through any pane layer that doesn't intercept
  them.

## Universal navigation

Every navigable pane MUST honor:
- `j`/`k` and `↓`/`↑` — next / previous row
- `g`/`G` and `Home`/`End` — first / last row
- `h`/`Esc`/`←` — back / cancel
- `Enter` — activate row (or pane-specific Enter semantics)
- `/` — start search filter (where the pane has searchable content)

Audit status (2026-05-16): Sidebar, Detail, RecordingList, Settings,
Log, Schedule, EventLog all compliant. Wizard intentionally diverges
(tab-style platform switcher).

## Modifier discipline

- **Ctrl+key** — global actions (`Ctrl+T` theme picker, `Ctrl+D`
  diagnostics focus). No pane should bind `Ctrl+key` so the global
  scope is reliable.
- **Shift+key** — global pane-switchers and inverse / "do more" forms
  (`Shift+E` event log, `Shift+F` log pane, `Shift+S` schedule pane,
  `Shift+R` recording rename, `Shift+M` recording move, `Shift+D`
  delete-to-trash on RecordingList, `Shift+D` schedule-row delete).
  Single-letter `d`/`D` divergence is intentional: `d` is destructive
  *and trash-bound* (recordings), `D` is destructive *and immediate*
  (schedule entry — there's no schedule-trash). Audit when the M3.4
  remap config lands.
- **Alt+key** — reserved; not used today.

## Single-letter alphas

Reserve `q`, `?`, `/`, `:` (future palette) for global. Anything else
is pane-local. Conflicts at startup are a hard panic
(`keymap::assert_no_conflicts`).

## Future additions tracked here

- `:` — command palette (M4 Phase 2). Will surface every `KeyAction`
  by typed name.
- `'` — marks (M4 Phase 2). Pane-local jump-to-mark.
- `?` — already toggles help; the auto-gen `format_pattern` in
  `dialog.rs` keeps the help text in sync.

## How to add a binding

1. Add a `KeyAction` variant in `src/tui/keymap.rs`.
2. Append a `Chord` to the `table()` array; the `.desc` field becomes
   the help-overlay third column for free.
3. Land the state mutation in `AppState::apply_key_action`.
4. Tests in `src/tui/keymap.rs` cover lookup + conflict detection;
   add a case if the binding has a non-obvious modifier shape.

Per-pane bindings (j/k navigation, etc.) currently still live in their
handler match arms; M3 follow-ups migrate them row-by-row into the
table so the help overlay and remap overlay see them too.
