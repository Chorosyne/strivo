pub mod patreon;
pub mod twitch;
pub mod youtube;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PlatformKind {
    Twitch,
    YouTube,
    Patreon,
}

impl std::fmt::Display for PlatformKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlatformKind::Twitch => write!(f, "Twitch"),
            PlatformKind::YouTube => write!(f, "YouTube"),
            PlatformKind::Patreon => write!(f, "Patreon"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelEntry {
    pub id: String,
    pub platform: PlatformKind,
    pub name: String,
    pub display_name: String,
    pub is_live: bool,
    pub stream_title: Option<String>,
    pub game_or_category: Option<String>,
    pub viewer_count: Option<u64>,
    pub started_at: Option<DateTime<Utc>>,
    pub thumbnail_url: Option<String>,
    pub auto_record: bool,
}

/// One past video / VOD / video-bearing post returned from a channel's back catalog.
///
/// Common shape across YouTube uploads, Twitch archive videos, and Patreon video posts —
/// just enough for the catalog runner to dedupe and hand a downloadable URL to yt-dlp.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodEntry {
    pub id: String,
    pub platform: PlatformKind,
    pub channel_id: String,
    pub title: String,
    pub published_at: Option<DateTime<Utc>>,
    pub duration: Option<Duration>,
    pub url: String,
    pub thumbnail_url: Option<String>,
}

#[allow(dead_code)]
#[async_trait::async_trait]
pub trait Platform: Send + Sync {
    fn kind(&self) -> PlatformKind;
    async fn authenticate(&self) -> anyhow::Result<()>;
    async fn fetch_followed_channels(&self) -> anyhow::Result<Vec<ChannelEntry>>;
    async fn check_live_status(&self, channel_ids: &[String]) -> anyhow::Result<Vec<ChannelEntry>>;
    async fn refresh_token(&self) -> anyhow::Result<()>;

    /// True iff this platform has usable credentials in memory. The
    /// monitor uses this to avoid issuing an initial poll before any
    /// platform has actually authenticated (the 10 s timeout can race
    /// authentication and produce an empty first poll).
    async fn is_authenticated(&self) -> bool;

    /// Enumerate a channel's full back catalog. Default returns NotSupported so platforms
    /// can opt in incrementally. `since` filters to entries newer than the given instant
    /// (best-effort — platforms that can't filter server-side may return more and the caller
    /// must filter). `limit` caps the count returned.
    async fn fetch_channel_vods(
        &self,
        _channel_id: &str,
        _since: Option<DateTime<Utc>>,
        _limit: Option<usize>,
    ) -> anyhow::Result<Vec<VodEntry>> {
        anyhow::bail!("catalog enumeration not supported for {}", self.kind())
    }
}
