use anyhow::{bail, Result};
use tokio::process::Command;

use crate::config::{QualityTier, StreamlinkSelection};
use crate::platform::PlatformKind;
use crate::stream::StreamInfo;

/// Resolve the best stream URL for a channel using streamlink (Twitch) or yt-dlp (YouTube).
/// After resolution the URL is HEAD-checked so ffmpeg doesn't have to discover a stale
/// manifest itself and surface a cryptic error.
///
/// `tier` controls the quality level: `None` preserves today's `"best"` behaviour
/// so callers without a capture profile see no change.
pub async fn resolve_stream_url(
    platform: PlatformKind,
    channel_name: &str,
    cookies_path: Option<&std::path::Path>,
    tier: Option<&QualityTier>,
) -> Result<StreamInfo> {
    let info = match platform {
        PlatformKind::Twitch => resolve_twitch(channel_name, tier).await,
        PlatformKind::YouTube => resolve_youtube(channel_name, cookies_path, tier).await,
        PlatformKind::Patreon => bail!("Patreon does not support live streams"),
    }?;

    if let Err(e) = validate_stream_url(&info.url).await {
        bail!("resolved stream URL is not reachable: {e}");
    }

    Ok(info)
}

/// Fast HEAD check against the resolved stream URL. Surfaces stale HLS
/// manifests and 403/404 conditions before ffmpeg gets to them.
async fn validate_stream_url(url: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    let resp = client.head(url).send().await?;
    let status = resp.status();
    if status.is_success() || status.is_redirection() {
        Ok(())
    } else {
        bail!("HEAD returned {status}")
    }
}

async fn resolve_twitch(channel_name: &str, tier: Option<&QualityTier>) -> Result<StreamInfo> {
    let url = format!("https://twitch.tv/{channel_name}");

    let token = crate::config::credentials::get_secret("twitch_access_token")
        .ok()
        .flatten();

    match run_streamlink(&url, token.as_deref(), tier).await {
        Ok(info) => Ok(info),
        Err(StreamlinkErr::Unauthorized) if token.is_some() => {
            // Stored OAuth token is stale — Twitch's playlist endpoint
            // refuses the request entirely. Retry without it; public
            // streams resolve fine unauthenticated.
            tracing::warn!(
                "Twitch OAuth token rejected as Unauthorized; retrying streamlink without it. \
                 Re-authenticate to restore access to sub-only streams."
            );
            match run_streamlink(&url, None, tier).await {
                Ok(info) => Ok(info),
                Err(StreamlinkErr::Failed(s)) => bail!("streamlink failed for {channel_name}: {s}"),
                Err(StreamlinkErr::Unauthorized) => {
                    bail!("streamlink failed for {channel_name}: Unauthorized (no token)")
                }
                Err(StreamlinkErr::NotFound) => resolve_with_ytdlp(&url, None, tier).await,
            }
        }
        Err(StreamlinkErr::Failed(s)) => bail!("streamlink failed for {channel_name}: {s}"),
        Err(StreamlinkErr::Unauthorized) => {
            bail!("streamlink failed for {channel_name}: Unauthorized")
        }
        Err(StreamlinkErr::NotFound) => resolve_with_ytdlp(&url, None, tier).await,
    }
}

enum StreamlinkErr {
    Unauthorized,
    Failed(String),
    NotFound,
}

async fn run_streamlink(
    url: &str,
    oauth_token: Option<&str>,
    tier: Option<&QualityTier>,
) -> Result<StreamInfo, StreamlinkErr> {
    // Build the streamlink quality selection from the tier, or fall back to
    // the plain "best" default when no tier is set.
    let sel = tier
        .map(|t| t.streamlink_selection())
        .unwrap_or(StreamlinkSelection {
            stream: "best",
            sorting_excludes: None,
            extended_codecs: false,
        });

    let mut cmd = Command::new("streamlink");
    cmd.args(["--stream-url", "--twitch-disable-ads"]);
    if let Some(token) = oauth_token {
        cmd.arg(format!("--twitch-api-header=Authorization=OAuth {token}"));
    }
    // Apply quality tier ceiling: exclude streams ranked above the tier cap.
    if let Some(excludes) = sel.sorting_excludes {
        cmd.arg(format!("--stream-sorting-excludes={excludes}"));
    }
    // Unlock Twitch h265/av1 streams for tiers that benefit (Best, P1080).
    if sel.extended_codecs {
        cmd.arg("--twitch-supported-codecs=h264,h265,av1");
    }
    cmd.args([url, sel.stream]);

    let output = match cmd.output().await {
        Ok(o) => o,
        Err(_) => return Err(StreamlinkErr::NotFound),
    };

    if output.status.success() {
        let stream_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stream_url.is_empty() {
            return Err(StreamlinkErr::Failed("empty URL".into()));
        }
        return Ok(StreamInfo {
            url: stream_url,
            quality: sel.stream.to_string(),
            is_live: true,
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("unauthorized") || lower.contains("token is invalid") {
        Err(StreamlinkErr::Unauthorized)
    } else {
        Err(StreamlinkErr::Failed(stderr.trim().to_string()))
    }
}

async fn resolve_youtube(
    channel_name: &str,
    cookies_path: Option<&std::path::Path>,
    tier: Option<&QualityTier>,
) -> Result<StreamInfo> {
    // channel_name could be a channel ID or handle
    let url = if channel_name.starts_with("UC") && channel_name.len() == 24 {
        format!("https://www.youtube.com/channel/{channel_name}/live")
    } else {
        format!("https://www.youtube.com/@{channel_name}/live")
    };

    resolve_with_ytdlp(&url, cookies_path, tier).await
}

async fn resolve_with_ytdlp(
    url: &str,
    cookies_path: Option<&std::path::Path>,
    tier: Option<&QualityTier>,
) -> Result<StreamInfo> {
    let format_sel = tier.map(|t| t.format_selector()).unwrap_or("best");

    let mut cmd = Command::new("yt-dlp");
    cmd.args(["-g", "--no-warnings", "-f", format_sel]);

    if let Some(cookies) = cookies_path {
        cmd.args(["--cookies", &cookies.to_string_lossy()]);
    }

    cmd.arg(url);

    let output = cmd.output().await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("yt-dlp failed for {url}: {stderr}");
    }

    let stream_url = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    if stream_url.is_empty() {
        bail!("yt-dlp returned empty URL for {url}");
    }

    Ok(StreamInfo {
        url: stream_url,
        quality: format_sel.to_string(),
        is_live: true,
    })
}
