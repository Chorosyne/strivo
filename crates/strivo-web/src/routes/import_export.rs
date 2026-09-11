//! JSON channel import/export (task 4), the Monitor page's unified view, and
//! (Creator Edition) the plugin capability matrix. Split out of `routes::api`.

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
#[cfg(feature = "creator")]
use strivo_plugins::archiver::types::ArchiverConfig;

use crate::routes::settings::check_key;
use crate::server::AppState;
#[cfg(feature = "creator")]
use crate::problem::Problem;

/// `GET /api/v1/channels/export` — export the auto-record channel list
/// (with per-channel overrides) as a JSON document. Safe: read-only.
async fn channels_export(headers: HeaderMap, State(state): State<AppState>) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    let cfg = match state.config().await {
        Ok(c) => c,
        Err(e) => return crate::problem::Problem::internal(e).into_response(),
    };
    Json(json!({
        "version": 1,
        "channels": cfg.auto_record_channels,
        "capture_profiles": cfg.capture_profiles,
    }))
    .into_response()
}

/// `POST /api/v1/channels/import` — import channel list from a JSON document.
///
/// Merge strategy: channels that don't already exist (matched by
/// `platform + channel_id`) are appended; existing channels are updated
/// with the incoming overrides. Unrelated config (recording settings,
/// platform credentials, schedule, etc.) is left untouched.
async fn channels_import(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    // Validate version field.
    let version = body.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
    if version != 1 {
        return crate::problem::Problem::bad_request("unsupported import version — expected 1")
            .into_response();
    }
    let incoming: Vec<strivo_core::config::AutoRecordEntry> = match body
        .get("channels")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
    {
        Some(v) => v,
        None => {
            return crate::problem::Problem::bad_request(
                "'channels' array is required and must be valid AutoRecordEntry objects",
            )
            .into_response()
        }
    };
    // Optional: also import capture profiles from the export document.
    let incoming_profiles: Vec<strivo_core::config::CaptureProfile> = body
        .get("capture_profiles")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let _config_guard = state.config_write_lock.lock().await;
    let mut cfg = match strivo_core::config::AppConfig::load(state.config_path()) {
        Ok(c) => c,
        Err(e) => return crate::problem::Problem::internal(e.to_string()).into_response(),
    };

    let mut added = 0u32;
    let mut updated = 0u32;
    for ch in incoming {
        let key = format!("{}:{}", ch.platform, ch.channel_id);
        if let Some(existing) = cfg
            .auto_record_channels
            .iter_mut()
            .find(|c| format!("{}:{}", c.platform, c.channel_id) == key)
        {
            // Update format + profile overrides only; preserve channel_name from
            // existing record so a rename in the export doesn't silently clobber
            // a corrected local name.
            existing.format = ch.format;
            existing.profile = ch.profile;
            updated += 1;
        } else {
            cfg.auto_record_channels.push(ch);
            added += 1;
        }
    }
    // Merge capture profiles: append new, leave existing untouched.
    let mut profiles_added = 0u32;
    for p in incoming_profiles {
        if !cfg
            .capture_profiles
            .iter()
            .any(|existing| existing.name == p.name)
        {
            cfg.capture_profiles.push(p);
            profiles_added += 1;
        }
    }

    if let Err(e) = cfg.save(state.config_path()) {
        return crate::problem::Problem::internal(e.to_string()).into_response();
    }
    if let Err(e) = state.refresh_config().await {
        tracing::warn!("config cache refresh failed: {e}");
    }
    (
        axum::http::StatusCode::OK,
        Json(json!({
            "ok": true,
            "channels_added": added,
            "channels_updated": updated,
            "profiles_added": profiles_added,
        })),
    )
        .into_response()
}

/// `GET /api/v1/monitor` — unified view for the Monitor page. Returns
/// every channel currently set to record-when-live, every channel
/// flagged for archiver tandem download, and the per-channel playlist
/// allow-lists.
async fn monitor_state(headers: HeaderMap, State(state): State<AppState>) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    let cfg = match state.config().await {
        Ok(c) => c,
        Err(e) => return crate::problem::Problem::internal(e).into_response(),
    };
    let auto_record: Vec<serde_json::Value> = cfg
        .auto_record_channels
        .iter()
        .map(|c| {
            // Expose the container override (from format.container) and
            // profile name so the Monitor page can render per-channel
            // format/quality selects without an extra API call.
            let container = c.format.as_ref().and_then(|f| f.container.as_deref());
            json!({
                "platform": c.platform,
                "channel_id": c.channel_id,
                "channel_name": c.channel_name,
                "key": format!("{}:{}", c.platform, c.channel_id),
                "format": container,
                "profile": c.profile,
            })
        })
        .collect();
    // Archiver tandem downloads are a Creator Edition surface; the PVR build
    // reports an empty list so the SPA's Monitor page renders identically.
    #[cfg(feature = "creator")]
    let auto_download: Vec<serde_json::Value> = {
        let archiver: ArchiverConfig = cfg.plugin_section("archiver");
        // Pivot tandem_playlists from "Key/Playlist" back to per-channel
        // lists so the SPA can render them grouped.
        let mut tandem: std::collections::BTreeMap<String, Vec<String>> = Default::default();
        for raw in &archiver.tandem_playlists {
            if let Some((key, pl)) = raw.split_once('/') {
                tandem
                    .entry(key.to_string())
                    .or_default()
                    .push(pl.to_string());
            }
        }
        archiver
            .tandem_channels
            .iter()
            .map(|key| {
                let (platform, channel_id) = key.split_once(':').unwrap_or((key.as_str(), ""));
                json!({
                    "platform": platform,
                    "channel_id": channel_id,
                    "key": key,
                    "playlists": tandem.get(key).cloned().unwrap_or_default(),
                })
            })
            .collect()
    };
    #[cfg(not(feature = "creator"))]
    let auto_download: Vec<serde_json::Value> = Vec::new();
    let alerts: Vec<serde_json::Value> = cfg
        .channel_alerts
        .iter()
        .map(|c| {
            json!({
                "key": c.channel_key,
                "on_live": c.on_live,
                "on_upload": c.on_upload,
            })
        })
        .collect();
    Json(json!({
        "auto_record": auto_record,
        "auto_download": auto_download,
        "alerts": alerts,
    }))
    .into_response()
}

/// `GET /api/v1/plugins/capabilities` — the DAW-vision capability
/// matrix: which plugins (or roadmap slots) fulfil each capability
/// tag. First-party providers are hard-coded here today; once the
/// daemon exposes the registry over IPC we'll switch to that. The
/// SPA renders this as the cross-plugin pipeline graph and lets
/// users discover "who does what".
#[cfg(feature = "creator")]
async fn plugin_capabilities(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return Problem::unauthorized().into_response();
    }
    use strivo_core::plugin::capability as cap;
    // (capability, [(plugin, status)]) where status is "available"
    // if the plugin is shipped or "roadmap" if the slot is reserved
    // for an upcoming plugin (matches the DAW-vision plan).
    // Every entry here corresponds to an in-tree, shipped + tested
    // plugin crate. The `roadmap` status now applies to the one
    // marketplace entry (`yt-publish`) that still depends on external
    // work (YouTube OAuth + API creds) — surfaced from the
    // marketplace catalog below.
    let matrix = json!([
        { "capability": cap::TRANSCRIPTION,        "providers": [{"plugin": "crunchr", "status": "available"}] },
        { "capability": cap::WORD_TIMESTAMPS,      "providers": [{"plugin": "crunchr", "status": "available"}] },
        { "capability": cap::DIARISATION,          "providers": [{"plugin": "crunchr", "status": "available"}] },
        { "capability": cap::TOPIC_SEGMENTATION,   "providers": [{"plugin": "crunchr", "status": "available"}] },
        { "capability": cap::CHAPTERS,             "providers": [{"plugin": "chapters", "status": "available"}] },
        { "capability": cap::SCENE_DETECTION,      "providers": [{"plugin": "cuepoints", "status": "available"}] },
        { "capability": cap::THUMBNAIL_RANKING,    "providers": [{"plugin": "thumbnails", "status": "available"}] },
        { "capability": cap::HIGHLIGHT_DETECTION,  "providers": [{"plugin": "clipper", "status": "available"}] },
        { "capability": cap::CLIP_EXTRACTION,      "providers": [{"plugin": "clipper", "status": "available"}] },
        { "capability": cap::TRANSLATION,          "providers": [{"plugin": "captions", "status": "available"}] },
        { "capability": cap::CAPTIONS,             "providers": [
            {"plugin": "captions",       "status": "available"},
            {"plugin": "captions-ass",   "status": "available"}
        ] },
        { "capability": cap::AUDIENCE_RETENTION,   "providers": [
            {"plugin": "heatmap",      "status": "available"},
            {"plugin": "chat-density", "status": "available"}
        ] },
        { "capability": cap::FRAUD_DETECTION,      "providers": [{"plugin": "viewguard", "status": "available"}] },
        { "capability": cap::STREAM_COMPARISON,    "providers": [
            {"plugin": "insights",         "status": "available"},
            {"plugin": "viewguard-trend",  "status": "available"}
        ] },
        { "capability": cap::REPORTING,            "providers": [{"plugin": "casebook", "status": "available"}] },
        { "capability": cap::BRAND_SAFETY,         "providers": [{"plugin": "brandsafe", "status": "available"}] },
        { "capability": cap::ASSET_CATALOG,        "providers": [{"plugin": "archiver", "status": "available"}] },
        { "capability": cap::SOURCE_TRACK_SPLIT,   "providers": [
            {"plugin": "multitrack",    "status": "available"}
        ] },
        { "capability": cap::PUBLISH_QUEUE,        "providers": [
            {"plugin": "reuse",      "status": "available"},
            {"plugin": "yt-publish", "status": "roadmap"}
        ] },
        { "capability": cap::EDL_EDITOR,           "providers": [
            {"plugin": "editor",   "status": "available"},
            {"plugin": "deadair",  "status": "available"},
            {"plugin": "branding", "status": "available"},
            {"plugin": "broll",    "status": "available"}
        ] },
        // Net-new capabilities from iters 23–24. Use `x.`-prefixed tags so
        // they don't drift from the WELL_KNOWN_CAPABILITIES constant set.
        { "capability": "x.loudness",        "providers": [{"plugin": "loudness", "status": "available"}] },
        { "capability": "x.structure",       "providers": [{"plugin": "structure", "status": "available"}] },
        { "capability": "x.audio_automation", "providers": [{"plugin": "automation", "status": "available"}] },
        { "capability": "x.scenes",          "providers": [{"plugin": "scenes", "status": "available"}] },
        { "capability": "x.publish_slots",   "providers": [{"plugin": "schedule-optimizer", "status": "available"}] },
        { "capability": "x.tempo",           "providers": [{"plugin": "beat-detect", "status": "available"}] },
        { "capability": "x.voice_gate",      "providers": [{"plugin": "vad", "status": "available"}] },
        { "capability": "x.sidechain",       "providers": [{"plugin": "sidechain", "status": "available"}] },
        { "capability": "x.insert_fx",       "providers": [{"plugin": "insert-fx", "status": "available"}] },
        { "capability": "x.pitch_time",      "providers": [{"plugin": "pitch", "status": "available"}] },
        { "capability": "x.multistream",     "providers": [{"plugin": "multistream", "status": "available"}] },
        { "capability": "x.chat",            "providers": [{"plugin": "chat",        "status": "available"}] },
        { "capability": "x.pipelines_dag",   "providers": [{"plugin": "pipelines-dag", "status": "available"}] },
        { "capability": "x.marketplace",     "providers": [{"plugin": "marketplace",   "status": "available"}] },
    ]);
    Json(matrix).into_response()
}

pub fn router() -> Router<AppState> {
    #[allow(unused_mut)]
    let mut r = Router::new()
        .route("/api/v1/channels/export", get(channels_export))
        .route("/api/v1/channels/import", post(channels_import))
        .route("/api/v1/monitor", get(monitor_state));

    #[cfg(feature = "creator")]
    {
        r = r.route("/api/v1/plugins/capabilities", get(plugin_capabilities));
    }

    r
}
