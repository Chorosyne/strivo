//! Twitch live-from-start (Rewind) extractor.
//!
//! Pulls the in-progress broadcast from segment 0 (broadcast t=0) by hitting
//! the same `/vod/v2/<video_id>.m3u8` Usher endpoint the web player uses
//! when the viewer scrubs back past the live edge.
//!
//! Mechanism, captured 2026-05-22 against twitch.tv/xqc:
//!
//! 1. Find the in-progress archive `video_id` via helix
//!    `/videos?user_id=X&type=archive&first=1`. While the broadcaster is live
//!    with "Store past broadcasts" + "Always publish VODs" enabled, helix
//!    surfaces the still-growing archive ~30–120s after stream start.
//!
//! 2. Mint a VOD access token via `gql.twitch.tv/gql`,
//!    operation `PlaybackAccessToken_Template`, sending the **full inline
//!    GraphQL query** (Twitch does NOT use persistedQuery for this op).
//!    Anonymous Client-Id `kimne78kx3ncx6brgo4mv6wki5h1ko` works for
//!    non-sub-gated channels. Returns `{value, signature}` — `value` is a
//!    stringified JSON blob, `signature` is hex HMAC; both pass verbatim to
//!    Usher.
//!
//! 3. Build `https://usher.ttvnw.net/vod/v2/<video_id>.m3u8?nauthsig=…&nauth=…`
//!    with the player-realistic query params. The response is an HLS
//!    multivariant playlist whose variant `chunked/index-dvr.m3u8` is
//!    `EXT-X-PLAYLIST-TYPE:EVENT`, segments numbered `0.ts`...`N.ts` from
//!    broadcast t=0, growing append-only over the broadcast.
//!
//! The returned master URL is consumable directly by ffmpeg with `-i`.
//!
//! Full recon: `docs/TWITCH-LIVE-FROM-START-INTEL.md`.
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::platform::twitch::TwitchPlatform;
use crate::platform::Platform;

const GQL_URL: &str = "https://gql.twitch.tv/gql";
const USHER_VOD_URL: &str = "https://usher.ttvnw.net/vod/v2";
/// Public anonymous Client-Id baked into the Twitch web player. Still
/// accepted in late-2025 for unauthenticated playback-token mints on
/// non-sub-gated channels. Several open-source tools (streamlink,
/// twitch-dl, dudik/twitch-m3u8) share it.
const ANON_CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";

/// Captured 2026-05-22 from a live twitch.tv player session. Sent as an
/// inline query — Twitch does NOT use persistedQuery hashes for this op,
/// so we don't need to rotate this constant.
const PLAYBACK_ACCESS_TOKEN_QUERY: &str = r#"query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature   authorization { isForbidden forbiddenReasonCode }   __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature   __typename  }}"#;

#[derive(Debug, Clone)]
pub struct RewindStream {
    /// Master HLS playlist URL — feed directly to ffmpeg with `-i`.
    pub master_url: String,
    pub video_id: String,
    pub broadcast_started_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
pub enum RewindError {
    NoArchive,
    Forbidden,
    StaleArchive { age_minutes: i64 },
    Other(anyhow::Error),
}

impl std::fmt::Display for RewindError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoArchive => write!(
                f,
                "channel has no in-progress archive video — \"Store past broadcasts\" likely disabled"
            ),
            Self::Forbidden => write!(
                f,
                "access forbidden — channel rewind is restricted (likely sub-only); needs user OAuth token"
            ),
            Self::StaleArchive { age_minutes } => write!(
                f,
                "video_id race: latest archive is {age_minutes}min old, expected current broadcast"
            ),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for RewindError {}

impl From<anyhow::Error> for RewindError {
    fn from(e: anyhow::Error) -> Self {
        Self::Other(e)
    }
}

pub struct RewindResolver {
    twitch: Arc<RwLock<TwitchPlatform>>,
    http: reqwest::Client,
    oauth_token: Option<String>,
}

impl RewindResolver {
    pub fn new(twitch: Arc<RwLock<TwitchPlatform>>, oauth_token: Option<String>) -> Self {
        Self {
            twitch,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 strivo")
                .build()
                .expect("reqwest client"),
            oauth_token,
        }
    }

    /// Resolve the Usher master playlist URL for the channel's in-progress
    /// broadcast. Errors with `RewindError::NoArchive` when the channel
    /// doesn't archive, `Forbidden` when sub-gated and we lack OAuth, and
    /// `StaleArchive` when the latest helix archive predates the current
    /// stream (broadcaster either disabled archives or this stream just
    /// went live and the archive hasn't been published yet).
    pub async fn resolve(&self, channel_id: &str) -> Result<RewindStream, RewindError> {
        let video = self.latest_archive(channel_id).await?;
        let token = self.mint_vod_token(&video.id).await?;
        let master_url = build_usher_url(&video.id, &token);
        Ok(RewindStream {
            master_url,
            video_id: video.id,
            broadcast_started_at: video.published_at,
        })
    }

    async fn latest_archive(
        &self,
        channel_id: &str,
    ) -> Result<crate::platform::VodEntry, RewindError> {
        let since = Utc::now() - Duration::days(2);
        let vods = self
            .twitch
            .read()
            .await
            .fetch_channel_vods(channel_id, Some(since), Some(1))
            .await
            .map_err(|e| RewindError::Other(anyhow!("helix /videos: {e}")))?;

        let vod = vods.into_iter().next().ok_or(RewindError::NoArchive)?;

        // Stale-check: an archive is "the current broadcast" if its
        // published_at is recent. Twitch publishes the row near stream
        // start; we tolerate up to 24h of broadcast age (very long
        // streams happen).
        if let Some(pub_at) = vod.published_at {
            let age = Utc::now() - pub_at;
            if age > Duration::hours(24) {
                return Err(RewindError::StaleArchive {
                    age_minutes: age.num_minutes(),
                });
            }
        }
        Ok(vod)
    }

    async fn mint_vod_token(&self, video_id: &str) -> Result<VodAccessToken, RewindError> {
        // Try with OAuth (if we have one) — needed for sub-gated channels.
        // On 401 (stale token), retry anonymously: most public channels
        // mint VOD tokens anonymously, and there's no point failing the
        // entire resolve because the user's saved OAuth rotted.
        let with_oauth = self.oauth_token.as_deref();
        match self.mint_vod_token_inner(video_id, with_oauth).await {
            Ok(t) => Ok(t),
            Err(RewindError::Other(e)) if with_oauth.is_some() && e.to_string().contains("401") => {
                tracing::warn!(
                    "twitch_rewind: stored OAuth token rejected (401); retrying anonymously. \
                     Re-authenticate to restore access to sub-only rewind streams."
                );
                self.mint_vod_token_inner(video_id, None).await
            }
            Err(e) => Err(e),
        }
    }

    async fn mint_vod_token_inner(
        &self,
        video_id: &str,
        oauth_token: Option<&str>,
    ) -> Result<VodAccessToken, RewindError> {
        let body = serde_json::json!({
            "operationName": "PlaybackAccessToken_Template",
            "query": PLAYBACK_ACCESS_TOKEN_QUERY,
            "variables": {
                "isLive": false,
                "login": "",
                "isVod": true,
                "vodID": video_id,
                "playerType": "site",
                "platform": "web",
            },
        });

        let mut req = self
            .http
            .post(GQL_URL)
            .header("Client-Id", ANON_CLIENT_ID)
            .header("Content-Type", "text/plain;charset=UTF-8")
            .header("Origin", "https://www.twitch.tv")
            .header("Referer", "https://www.twitch.tv/")
            .json(&body);
        if let Some(tok) = oauth_token {
            req = req.header("Authorization", format!("OAuth {tok}"));
        }

        let resp = req
            .send()
            .await
            .map_err(|e| RewindError::Other(anyhow!("GQL request: {e}")))?;
        let status = resp.status();
        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| RewindError::Other(anyhow!("GQL parse: {e}")))?;
        if !status.is_success() {
            return Err(RewindError::Other(anyhow!(
                "GQL HTTP {status}: {}",
                json.to_string()
            )));
        }
        let tok = json
            .get("data")
            .and_then(|d| d.get("videoPlaybackAccessToken"))
            .ok_or_else(|| {
                RewindError::Other(anyhow!(
                    "GQL response missing videoPlaybackAccessToken: {json}"
                ))
            })?;
        let value = tok
            .get("value")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RewindError::Other(anyhow!("missing token value")))?
            .to_string();
        let signature = tok
            .get("signature")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RewindError::Other(anyhow!("missing token signature")))?
            .to_string();

        // Decode the stringified JSON value to surface sub-gate / geo-block
        // before we hand the URL off to ffmpeg.
        let decoded: TokenValue =
            serde_json::from_str(&value).with_context(|| format!("decode token value: {value}"))?;
        if decoded.authorization.forbidden {
            return Err(RewindError::Forbidden);
        }
        Ok(VodAccessToken { value, signature })
    }
}

#[derive(Debug, Deserialize)]
struct TokenValue {
    authorization: TokenAuthorization,
}

#[derive(Debug, Deserialize)]
struct TokenAuthorization {
    forbidden: bool,
}

#[derive(Debug, Clone)]
struct VodAccessToken {
    value: String,
    signature: String,
}

fn build_usher_url(video_id: &str, tok: &VodAccessToken) -> String {
    // Player-realistic param set. `p` is anti-cache padding (any int);
    // the player ships a random int — micros from the epoch is plenty.
    let p: u128 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0)
        % 1_000_000;
    let mut url = reqwest::Url::parse(&format!("{USHER_VOD_URL}/{video_id}.m3u8"))
        .expect("usher URL parse");
    url.query_pairs_mut()
        .append_pair("nauthsig", &tok.signature)
        .append_pair("nauth", &tok.value)
        .append_pair("allow_source", "true")
        .append_pair("allow_audio_only", "true")
        .append_pair("playlist_include_framerate", "true")
        .append_pair("supported_codecs", "av1,h265,h264")
        .append_pair("platform", "web")
        .append_pair("p", &p.to_string());
    url.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usher_url_uses_nauthsig_and_nauth() {
        let tok = VodAccessToken {
            value: r#"{"k":"v"}"#.into(),
            signature: "deadbeef".into(),
        };
        let url = build_usher_url("2778422119", &tok);
        assert!(url.starts_with("https://usher.ttvnw.net/vod/v2/2778422119.m3u8?"));
        assert!(url.contains("nauthsig=deadbeef"));
        // nauth is URL-encoded JSON
        assert!(url.contains("nauth=%7B%22k%22%3A%22v%22%7D"));
        assert!(url.contains("allow_source=true"));
        assert!(url.contains("supported_codecs=av1%2Ch265%2Ch264"));
    }

    #[test]
    fn forbidden_token_value_parses() {
        let v: TokenValue = serde_json::from_str(
            r#"{"authorization":{"forbidden":true,"reason":"SUB_ONLY_LIVE"}}"#,
        )
        .unwrap();
        assert!(v.authorization.forbidden);
    }
}
