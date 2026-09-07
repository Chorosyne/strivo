use std::collections::HashSet;
use std::path::PathBuf;
use strivo_core::platform::PlatformKind;
use uuid::Uuid;

/// Archiver's `[archiver]` `config.toml` section. Owned here (not in
/// `strivo-core`) because it's Creator-Edition-only vocabulary — core
/// only stores it as an untyped `AppConfig::extensions` entry (see
/// `AppConfig::plugin_section`/`set_plugin_section`) so an existing
/// `config.toml`'s `[archiver]` section round-trips unchanged.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ArchiverConfig {
    /// Whether the plugin is enabled (gates tandem auto-processing).
    #[serde(default)]
    pub enabled: bool,

    /// Whether the first-run config modal has been completed.
    #[serde(default)]
    pub configured: bool,

    #[serde(default = "default_archive_dir")]
    pub archive_dir: PathBuf,
    #[serde(default = "default_archive_format")]
    pub format: String,
    #[serde(default = "default_concurrent_fragments")]
    pub concurrent_fragments: u32,
    #[serde(default)]
    pub rate_limit: String,

    /// Tandem mode: auto-trigger archiving for these channels.
    /// Each entry is "Platform:channel_id" (e.g., "Twitch:123456").
    #[serde(default)]
    pub tandem_channels: Vec<String>,

    /// Tandem mode: auto-trigger archiving for recordings from these playlists.
    #[serde(default)]
    pub tandem_playlists: Vec<String>,
}

impl Default for ArchiverConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            configured: false,
            archive_dir: default_archive_dir(),
            format: default_archive_format(),
            concurrent_fragments: default_concurrent_fragments(),
            rate_limit: String::new(),
            tandem_channels: Vec::new(),
            tandem_playlists: Vec::new(),
        }
    }
}

fn default_archive_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("Videos/StriVo/Archives"))
        .unwrap_or_else(|| PathBuf::from("./archives"))
}
fn default_archive_format() -> String {
    "best".to_string()
}
fn default_concurrent_fragments() -> u32 {
    4
}

/// Config modal state for the Archiver plugin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigModalState {
    /// Modal is not showing.
    Hidden,
    /// Modal is active (first-run or re-opened via 'c').
    Active {
        /// Which form field is currently selected.
        selected_field: usize,
        /// Whether the selected field is in text-edit mode.
        editing: bool,
        /// Total number of static fields (before channel checklist).
        static_field_count: usize,
    },
}

/// Filter for the recording picker list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordingFilter {
    All,
    ByChannel(String),
    ByPlaylist(String),
}

/// State for the recording picker view.
#[derive(Debug, Clone)]
pub struct PickerState {
    pub selected: usize,
    pub selections: HashSet<Uuid>,
    pub filter: RecordingFilter,
    /// Cached sorted list of recording IDs matching current filter.
    pub visible_ids: Vec<Uuid>,
}

impl Default for PickerState {
    fn default() -> Self {
        Self {
            selected: 0,
            selections: HashSet::new(),
            filter: RecordingFilter::All,
            visible_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ArchiveState {
    Pending,
    Scanning,
    Downloading,
    Paused,
    Complete,
    Failed,
}

impl std::fmt::Display for ArchiveState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "Pending"),
            Self::Scanning => write!(f, "Scanning"),
            Self::Downloading => write!(f, "Downloading"),
            Self::Paused => write!(f, "Paused"),
            Self::Complete => write!(f, "Complete"),
            Self::Failed => write!(f, "Failed"),
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ArchiveJob {
    pub id: Uuid,
    pub channel_name: String,
    pub channel_url: String,
    pub platform: PlatformKind,
    pub archive_dir: PathBuf,
    pub state: ArchiveState,
    pub total_videos: usize,
    pub completed_videos: usize,
    pub current_video: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct VideoEntry {
    pub video_id: String,
    pub title: String,
    pub upload_date: String,
    pub duration_secs: Option<f64>,
    pub playlist: Option<String>,
    pub downloaded: bool,
}

/// UI view toggle within the Archiver pane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiverView {
    ChannelList,
    ArchiveQueue,
    RecordingPicker,
}

/// Events from async archive tasks.
#[allow(dead_code)]
pub enum ArchiverEvent {
    ScanComplete {
        job_id: Uuid,
        videos: Vec<VideoEntry>,
    },
    VideoDownloaded {
        job_id: Uuid,
        video_id: String,
    },
    JobComplete {
        job_id: Uuid,
    },
    JobError {
        job_id: Uuid,
        error: String,
    },
}
