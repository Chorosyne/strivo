//! Centralized keymap table — single source of truth for keybindings.
//!
//! Yazi-inspired (see YAZI-AUDIT.md §2). Each `Chord` carries the key
//! pattern, the typed [`KeyAction`] to fire, and a static `desc` string.
//! The help overlay reads from this table so `?` always reflects reality
//! (M3.3); a future TOML overlay lets users remap (M3.4).
//!
//! M3 Phase 1 only migrates the **global** key layer in this commit —
//! pane handlers still own their own match arms. They consult
//! [`lookup`] first via [`maybe_global`] and only fall back to their
//! native match for layer-local keys not yet migrated.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::app::ActivePane;

/// Which keymap layer a chord belongs to. Layer precedence follows
/// `overlay > plugin > pane > global`. Overlays own their keys
/// outright (the global pre-dispatch shortcircuits while they're up);
/// pane layers consult global last so a pane-specific key wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Layer {
    /// Always-on keys: quit, help, theme picker, etc.
    Global,
    Sidebar,
    Detail,
    RecordingList,
    Schedule,
    Settings,
    Log,
    Wizard,
    StatusBar,
    /// Overlay layers. These short-circuit other layers while open.
    ThemePicker,
    EventLog,
    PlaybackOverlay,
    SearchInput,
    QuitConfirm,
    PropertiesModal,
    PlatformDebugModal,
}

impl Layer {
    /// Map an `ActivePane` to the matching pane layer. Caller asks the
    /// table for the active layer, falling back to `Global` if no
    /// pane-specific entry matches.
    pub fn for_pane(pane: &ActivePane) -> Option<Self> {
        Some(match pane {
            ActivePane::Sidebar => Self::Sidebar,
            ActivePane::Detail => Self::Detail,
            ActivePane::RecordingList => Self::RecordingList,
            ActivePane::Schedule => Self::Schedule,
            ActivePane::Settings => Self::Settings,
            ActivePane::Log => Self::Log,
            ActivePane::Wizard => Self::Wizard,
            ActivePane::StatusBar => Self::StatusBar,
            ActivePane::Plugin(_) => return None,
        })
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Sidebar => "sidebar",
            Self::Detail => "detail",
            Self::RecordingList => "recordings",
            Self::Schedule => "schedule",
            Self::Settings => "settings",
            Self::Log => "log",
            Self::Wizard => "wizard",
            Self::StatusBar => "statusbar",
            Self::ThemePicker => "themepicker",
            Self::EventLog => "eventlog",
            Self::PlaybackOverlay => "playback",
            Self::SearchInput => "search",
            Self::QuitConfirm => "quit?",
            Self::PropertiesModal => "props",
            Self::PlatformDebugModal => "platdebug",
        }
    }
}

/// Typed actions a key can request. Mirrored over to AppState which
/// applies them. New keys add a variant; the help overlay's third
/// column is the `desc` field of the corresponding [`Chord`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyAction {
    Quit,
    HelpToggle,
    HelpClose,
    ThemePickerOpen,
    EventLogToggle,
    EnterStatusBar,
    EnterLogPane,
    EnterSchedulePane,
    SearchStart,
    /// Plugin-layer activation commands are still routed via the
    /// registry; this variant exists so the table can document them
    /// even though dispatch happens elsewhere.
    PluginActivate,
}

impl KeyAction {
    pub fn desc(&self) -> &'static str {
        match self {
            Self::Quit => "quit (confirm if recording)",
            Self::HelpToggle => "toggle help overlay",
            Self::HelpClose => "close help overlay",
            Self::ThemePickerOpen => "theme picker",
            Self::EventLogToggle => "event log",
            Self::EnterStatusBar => "status-bar focus",
            Self::EnterLogPane => "log pane",
            Self::EnterSchedulePane => "schedule pane",
            Self::SearchStart => "search filter",
            Self::PluginActivate => "plugin command",
        }
    }
}

/// One row in the binding table. `on` matches a `crossterm::KeyEvent`;
/// `desc` is the help-overlay third column.
#[derive(Debug, Clone, Copy)]
pub struct Chord {
    pub layer: Layer,
    pub key: KeyPattern,
    pub action: KeyAction,
    pub desc: &'static str,
}

/// What to match against a key event. Kept simple for now — single
/// key + modifier flags. Multi-key prefixes (yazi-style `gg`) can be
/// added later by extending this enum.
#[derive(Debug, Clone, Copy)]
pub struct KeyPattern {
    pub code: KeyCode,
    pub modifiers: KeyModifiers,
}

impl KeyPattern {
    pub const fn new(code: KeyCode, modifiers: KeyModifiers) -> Self {
        Self { code, modifiers }
    }

    pub const fn plain(code: KeyCode) -> Self {
        Self {
            code,
            modifiers: KeyModifiers::NONE,
        }
    }

    pub const fn ctrl(c: char) -> Self {
        Self {
            code: KeyCode::Char(c),
            modifiers: KeyModifiers::CONTROL,
        }
    }

    pub const fn shift_char(c: char) -> Self {
        // crossterm sets SHIFT for uppercase chars on most platforms;
        // the actual KeyCode::Char is the uppercase form. We match
        // either form by emitting both flag combinations in `matches`.
        Self {
            code: KeyCode::Char(c),
            modifiers: KeyModifiers::SHIFT,
        }
    }

    pub fn matches(&self, ev: &KeyEvent) -> bool {
        if self.code != ev.code {
            return false;
        }
        // Crossterm reports SHIFT inconsistently for character keys
        // (Unix vs Windows). Treat the SHIFT bit as a soft match for
        // KeyCode::Char so platform drift doesn't break bindings.
        if matches!(self.code, KeyCode::Char(_)) {
            // Required modifiers minus SHIFT must be a subset of the
            // event modifiers; SHIFT is allowed to differ.
            let want = self.modifiers - KeyModifiers::SHIFT;
            let have = ev.modifiers - KeyModifiers::SHIFT;
            return want == have;
        }
        self.modifiers == ev.modifiers
    }
}

/// The global keymap. New rows go here; per-layer lookup walks this
/// vector once. Layer precedence is enforced by [`lookup`], which
/// searches active-layer entries before falling back to `Global`.
fn table() -> &'static [Chord] {
    use KeyCode::*;
    use KeyModifiers as M;
    const fn c(layer: Layer, key: KeyPattern, action: KeyAction, desc: &'static str) -> Chord {
        Chord { layer, key, action, desc }
    }
    // Global. Per-pane keys (j/k navigation, etc.) still live in
    // their handler match arms and will migrate in M3 follow-ups.
    static T: &[Chord] = &[
        c(Layer::Global, KeyPattern::plain(Char('q')),      KeyAction::Quit,                "quit"),
        c(Layer::Global, KeyPattern::plain(Char('?')),      KeyAction::HelpToggle,          "toggle help"),
        c(Layer::Global, KeyPattern::ctrl('t'),             KeyAction::ThemePickerOpen,     "theme picker"),
        c(Layer::Global, KeyPattern::ctrl('d'),             KeyAction::EnterStatusBar,      "diagnostics focus"),
        c(Layer::Global, KeyPattern { code: Char('E'), modifiers: M::SHIFT }, KeyAction::EventLogToggle, "event log"),
        c(Layer::Global, KeyPattern { code: Char('F'), modifiers: M::SHIFT }, KeyAction::EnterLogPane,   "log pane"),
        c(Layer::Global, KeyPattern { code: Char('S'), modifiers: M::SHIFT }, KeyAction::EnterSchedulePane, "schedule pane"),
        c(Layer::Global, KeyPattern::plain(Char('/')),      KeyAction::SearchStart,         "search filter"),
    ];
    T
}

/// Look up a `KeyAction` for `key` in `layer`, falling back to `Global`
/// if there is no layer-local hit.
pub fn lookup(layer: Layer, key: &KeyEvent) -> Option<KeyAction> {
    let t = table();
    // Layer-specific entries first.
    if let Some(chord) = t.iter().find(|c| c.layer == layer && c.key.matches(key)) {
        return Some(chord.action);
    }
    // Global fallback (only when the active layer isn't already Global).
    if layer != Layer::Global {
        if let Some(chord) = t.iter().find(|c| c.layer == Layer::Global && c.key.matches(key)) {
            return Some(chord.action);
        }
    }
    None
}

/// Iterator over chords in a given layer plus the global layer. Used
/// by the auto-generated help overlay (M3.3).
pub fn chords_for(layer: Layer) -> Vec<&'static Chord> {
    let t = table();
    t.iter()
        .filter(|c| c.layer == layer || c.layer == Layer::Global)
        .collect()
}

/// All chords (every layer). Used by the conflict-detection assert
/// and any "show me everything" rendering paths.
pub fn all_chords() -> &'static [Chord] {
    table()
}

/// Sanity check at startup: assert no two chords in the same layer
/// share the same `(code, modifiers)`. Called from `AppState::new` so
/// any duplicate is a panic on first run rather than silent shadowing.
pub fn assert_no_conflicts() {
    let t = table();
    let mut seen: Vec<(Layer, KeyCode, KeyModifiers)> = Vec::new();
    for chord in t {
        let key = (chord.layer, chord.key.code, chord.key.modifiers);
        if seen.contains(&key) {
            panic!(
                "keymap conflict in layer {:?}: {:?} (mods {:?}) bound twice",
                chord.layer, chord.key.code, chord.key.modifiers
            );
        }
        seen.push(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_global_quit() {
        let ev = KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE);
        assert_eq!(lookup(Layer::Sidebar, &ev), Some(KeyAction::Quit));
    }

    #[test]
    fn ctrl_t_opens_theme_picker() {
        let ev = KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL);
        assert_eq!(lookup(Layer::Global, &ev), Some(KeyAction::ThemePickerOpen));
    }

    #[test]
    fn shift_e_opens_event_log_regardless_of_shift_drift() {
        // Some platforms send SHIFT for uppercase char; others don't.
        let with_shift = KeyEvent::new(KeyCode::Char('E'), KeyModifiers::SHIFT);
        let without_shift = KeyEvent::new(KeyCode::Char('E'), KeyModifiers::NONE);
        assert_eq!(lookup(Layer::Global, &with_shift), Some(KeyAction::EventLogToggle));
        assert_eq!(lookup(Layer::Global, &without_shift), Some(KeyAction::EventLogToggle));
    }

    #[test]
    fn no_conflicts_in_table() {
        assert_no_conflicts();
    }
}
