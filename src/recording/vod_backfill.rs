//! Twitch VOD backfill.
//!
//! When a Twitch live recording ends, the live HLS pull will have missed
//! the first ~5 minutes of broadcast (DVR window limit) and any black
//! frames left behind by streamlink's ad suppression. Twitch publishes a
//! full archive VOD a few minutes after the stream ends — backfilling
//! from it gives us the complete broadcast.
//!
//! Flow:
//! 1. Wait `delay_secs` seconds for the VOD to finalize on Twitch's side.
//! 2. Query helix `/videos?user_id=X&type=archive&first=5`.
//! 3. Pick the most recent archive whose `published_at` lands within ±2h
//!    of the live recording's start (Twitch's published_at is the broadcast
//!    start, not finalize time).
//! 4. Send `RecordingCommand::DownloadVod` with `<base>_vod.<ext>` as the
//!    output path — the live capture is preserved alongside.
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

use crate::platform::twitch::TwitchPlatform;
use crate::platform::{Platform, PlatformKind};
use crate::recording::RecordingCommand;

#[derive(Debug, Clone)]
pub struct BackfillRequest {
    pub channel_id: String,
    pub channel_name: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub live_output_path: PathBuf,
    pub stream_title: Option<String>,
    pub delay_secs: u64,
}

/// Spawn-and-forget task that waits for Twitch to finalize the VOD, then
/// queues its download via the recording manager. Failure is logged at
/// warn level and otherwise silent — the live capture is the user's
/// safety net.
pub fn spawn(
    req: BackfillRequest,
    twitch: Arc<RwLock<TwitchPlatform>>,
    recording_tx: mpsc::UnboundedSender<RecordingCommand>,
) {
    tokio::spawn(async move {
        if let Err(e) = run(req, twitch, recording_tx).await {
            tracing::warn!(error = %e, "vod backfill failed");
        }
    });
}

async fn run(
    req: BackfillRequest,
    twitch: Arc<RwLock<TwitchPlatform>>,
    recording_tx: mpsc::UnboundedSender<RecordingCommand>,
) -> anyhow::Result<()> {
    tracing::info!(
        channel = %req.channel_name,
        delay_secs = req.delay_secs,
        "vod backfill: scheduled"
    );
    tokio::time::sleep(Duration::from_secs(req.delay_secs)).await;

    let twitch_guard = twitch.read().await;
    // Search the last 7 days; helix returns newest-first, so the first
    // matching archive is what we want.
    let since = req.started_at - chrono::Duration::days(7);
    let vods = twitch_guard
        .fetch_channel_vods(&req.channel_id, Some(since), Some(5))
        .await
        .map_err(|e| anyhow::anyhow!("fetch_channel_vods: {e}"))?;
    drop(twitch_guard);

    let match_window = chrono::Duration::hours(2);
    let chosen = vods.into_iter().find(|v| {
        v.published_at
            .map(|p| (p - req.started_at).num_seconds().abs() <= match_window.num_seconds())
            .unwrap_or(false)
    });

    let Some(vod) = chosen else {
        tracing::info!(
            channel = %req.channel_name,
            started_at = %req.started_at,
            "vod backfill: no matching archive within ±2h — channel may have \"Store past broadcasts\" disabled"
        );
        return Ok(());
    };

    let output_path = vod_output_path(&req.live_output_path);
    tracing::info!(
        channel = %req.channel_name,
        vod_id = %vod.id,
        url = %vod.url,
        output = %output_path.display(),
        "vod backfill: starting download"
    );

    recording_tx
        .send(RecordingCommand::DownloadVod {
            url: vod.url,
            channel_name: req.channel_name,
            platform: PlatformKind::Twitch,
            output_path,
            cookies_path: None,
            post_title: req.stream_title.or(Some(vod.title)),
        })
        .map_err(|e| anyhow::anyhow!("recording_tx send: {e}"))?;

    Ok(())
}

/// `<base>.<ext>` → `<base>_vod.<ext>`.
fn vod_output_path(live: &std::path::Path) -> PathBuf {
    let parent = live.parent().unwrap_or(std::path::Path::new("."));
    let stem = live
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("recording");
    let ext = live
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mkv");
    parent.join(format!("{stem}_vod.{ext}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn vod_path_appends_suffix() {
        assert_eq!(
            vod_output_path(Path::new("/r/falco_2026-05-22.mkv")),
            PathBuf::from("/r/falco_2026-05-22_vod.mkv")
        );
        assert_eq!(
            vod_output_path(Path::new("/r/falco.mp4")),
            PathBuf::from("/r/falco_vod.mp4")
        );
    }
}
