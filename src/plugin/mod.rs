pub mod registry;

use std::any::Any;
use std::path::PathBuf;
use std::pin::Pin;
use std::future::Future;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::Frame;

use crate::app::{AppState, DaemonEvent};
use crate::config::AppConfig;

/// Unique identifier for a plugin-contributed pane.
pub type PaneId = &'static str;

/// A command that a plugin registers (for global keybinding + help overlay).
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PluginCommand {
    pub name: &'static str,
    pub description: &'static str,
    pub key: KeyCode,
    pub modifiers: KeyModifiers,
}

/// Actions a plugin can request the host to perform.
#[allow(dead_code)]
pub enum PluginAction {
    /// Update the status bar message.
    SetStatus(String),
    /// Send a desktop notification.
    Notify { title: String, body: String },
    /// Navigate to this plugin's pane.
    ActivatePane(PaneId),
    /// Navigate back to sidebar (deactivate plugin pane).
    NavigateBack,
    /// Spawn an async task; results delivered back via on_plugin_event.
    SpawnTask {
        plugin_name: &'static str,
        future: Pin<Box<dyn Future<Output = Box<dyn Any + Send>> + Send>>,
    },
    /// Play a file in mpv.
    PlayFile(PathBuf),
    /// Play a file in mpv starting at a position (seconds). M5.2 —
    /// transcript-scoped seek: Enter on a Crunchr chunk hands the
    /// chunk's start_sec along with the recording path.
    PlayFileAt(PathBuf, f64),
    /// Request the host to update a plugin's config section and persist to disk.
    UpdateConfig {
        plugin_name: &'static str,
        config_update: Box<dyn Any + Send>,
    },
}

/// Context provided to plugins during initialization.
pub struct PluginContext<'a> {
    pub config: &'a AppConfig,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
}

/// Plugin manifest schema (M4.4 — yazi audit §5 adapt).
///
/// User-discoverable description of a plugin. Dropped into
/// `~/.config/strivo/plugins/<name>.toml` and scanned at startup by
/// [`scan_user_plugins`]. Today the manifest is informational only —
/// surfaced in the Settings tab so users can audit what's installed.
/// Dynamic loading of out-of-tree Rust plugins (cdylib + libloading)
/// is a separate piece of work tracked in the M4 polish bucket.
///
/// Example:
///
/// ```toml
/// name = "scratchpad"
/// version = "0.1.0"
/// description = "Quick-notes scratchpad pinned to F2"
/// activation_key = "F2"
/// pane = "right"
/// ```
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PluginManifest {
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Suggested activation key, e.g. `F2` or `<C-x>`. The TUI keymap
    /// table doesn't bind this automatically yet — see audit follow-up.
    #[serde(default)]
    pub activation_key: Option<String>,
    /// Where the plugin would prefer to render: "right" (Detail pane
    /// replacement), "overlay", or "statusbar".
    #[serde(default)]
    pub pane: Option<String>,
    /// Path to a future dynamic library (cdylib). Recognized but not
    /// loaded today; reserves the field shape.
    #[serde(default)]
    pub library_path: Option<std::path::PathBuf>,
    /// Path the manifest was loaded from (set by `scan_user_plugins`).
    #[serde(skip)]
    pub manifest_path: Option<std::path::PathBuf>,
}

/// Scan a directory for `*.toml` plugin manifests. Each successfully
/// parsed file becomes a [`PluginManifest`]; parse errors are logged
/// and skipped so a broken manifest doesn't block startup.
pub fn scan_user_plugins(dir: &std::path::Path) -> Vec<PluginManifest> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("toml") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        match toml::from_str::<PluginManifest>(&text) {
            Ok(mut m) => {
                m.manifest_path = Some(path.clone());
                out.push(m);
            }
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "plugin manifest parse failed");
            }
        }
    }
    audit_manifest_conflicts(&out);
    out
}

/// Walk loaded manifests and warn when an `activation_key` collides
/// with the base keymap table (M4.follow.c). Surfaces the user-facing
/// issue at startup rather than silently shadowing the binding —
/// users who notice the warning in the log can pick a different key
/// before they're confused at runtime.
fn audit_manifest_conflicts(manifests: &[PluginManifest]) {
    for m in manifests {
        let Some(ref key_spec) = m.activation_key else {
            continue;
        };
        let Some(pattern) = crate::tui::keymap::KeyPattern::parse(key_spec) else {
            tracing::warn!(
                plugin = %m.name,
                key = %key_spec,
                "plugin manifest activation_key unparseable (expected `q`, `<C-x>`, `F2`, …)"
            );
            continue;
        };
        // Walk the entire base table; collisions in any layer count.
        let chords = crate::tui::keymap::all_chords();
        for chord in chords {
            if chord.key.code == pattern.code && chord.key.modifiers == pattern.modifiers {
                tracing::warn!(
                    plugin = %m.name,
                    key = %key_spec,
                    bound_to = ?chord.action,
                    layer = ?chord.layer,
                    "plugin manifest activation_key collides with built-in binding",
                );
                break;
            }
        }
    }
}

/// Default directory `~/.config/strivo/plugins/` where user plugin
/// manifests live. Created on first access only if a write would
/// follow — scanning gracefully no-ops on a missing directory.
pub fn user_plugin_dir() -> std::path::PathBuf {
    crate::config::AppConfig::config_dir().join("plugins")
}

/// Fieldless mirror of DaemonEvent for event filtering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonEventKind {
    ChannelsUpdated,
    ChannelWentLive,
    ChannelWentOffline,
    StreamUrlResolved,
    RecordingStarted,
    RecordingProgress,
    RecordingFinished,
    Notification,
    AllRecordingsStopped,
    DeviceCodeRequired,
    PlatformAuthenticated,
    PatreonPostFound,
    ScheduleFired,
    Error,
}

impl DaemonEventKind {
    pub fn from_event(event: &DaemonEvent) -> Self {
        match event {
            DaemonEvent::ChannelsUpdated(_) => Self::ChannelsUpdated,
            DaemonEvent::ChannelWentLive(_) => Self::ChannelWentLive,
            DaemonEvent::ChannelWentOffline(_) => Self::ChannelWentOffline,
            DaemonEvent::StreamUrlResolved { .. } => Self::StreamUrlResolved,
            DaemonEvent::RecordingStarted { .. } => Self::RecordingStarted,
            DaemonEvent::RecordingProgress { .. } => Self::RecordingProgress,
            DaemonEvent::RecordingFinished { .. } => Self::RecordingFinished,
            DaemonEvent::Notification { .. } => Self::Notification,
            DaemonEvent::AllRecordingsStopped => Self::AllRecordingsStopped,
            DaemonEvent::DeviceCodeRequired { .. } => Self::DeviceCodeRequired,
            DaemonEvent::PlatformAuthenticated { .. } => Self::PlatformAuthenticated,
            DaemonEvent::PatreonPostFound { .. } => Self::PatreonPostFound,
            DaemonEvent::ScheduleFired { .. } => Self::ScheduleFired,
            DaemonEvent::Error(_) => Self::Error,
        }
    }
}

/// The core Plugin trait. All plugins implement this.
#[allow(dead_code, unused)]
pub trait Plugin: Send {
    /// Unique name for this plugin (e.g., "crunchr").
    fn name(&self) -> &'static str;

    /// Human-readable display name.
    fn display_name(&self) -> &str;

    /// Called once after registration.
    fn init(&mut self, ctx: &PluginContext) -> anyhow::Result<()>;

    /// Called on shutdown. Errors are logged by the registry and do not
    /// abort the shutdown of sibling plugins.
    fn shutdown(&mut self) -> anyhow::Result<()> {
        Ok(())
    }

    /// Which daemon events this plugin wants to receive. None = all.
    fn event_filter(&self) -> Option<Vec<DaemonEventKind>> {
        None
    }

    /// Handle a daemon event. Return actions for the host to execute.
    fn on_event(&mut self, _event: &DaemonEvent, _app: &AppState) -> Vec<PluginAction> {
        Vec::new()
    }

    /// Handle a keyboard event when this plugin's pane is active.
    fn on_key(&mut self, _key: KeyEvent, _app: &AppState) -> Vec<PluginAction> {
        Vec::new()
    }

    /// Handle events from the plugin's own async tasks.
    fn on_plugin_event(&mut self, _event: Box<dyn Any + Send>) -> Vec<PluginAction> {
        Vec::new()
    }

    /// Commands this plugin contributes (for help overlay and keybinding dispatch).
    fn commands(&self) -> Vec<PluginCommand> {
        Vec::new()
    }

    /// Pane IDs this plugin contributes.
    fn panes(&self) -> Vec<PaneId> {
        Vec::new()
    }

    /// Render this plugin's pane.
    fn render_pane(
        &self,
        _pane_id: PaneId,
        _frame: &mut Frame,
        _area: Rect,
        _app: &AppState,
    ) {
    }

    /// Optional: contribute a segment to the status bar.
    fn status_line(&self, _app: &AppState) -> Option<String> {
        None
    }

    /// Optional: contribute lines to the recording properties panel
    /// (rendered under a plugin-owned heading).
    fn properties_section(
        &self,
        _job_id: uuid::Uuid,
        _app: &AppState,
    ) -> Vec<ratatui::text::Line<'static>> {
        Vec::new()
    }

    /// Downcast support.
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}
