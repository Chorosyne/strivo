//! Capture-profile CRUD (quality tiers, task 1). Split out of `routes::api`.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{post, put};
use axum::{Json, Router};
use serde_json::json;

use crate::routes::settings::check_key;
use crate::server::AppState;

/// `POST /api/v1/capture_profiles` — create a new named capture profile.
/// Body: `{ name, quality_tier?, format?, transcode?, audio_only, transcript, cutoff_episodes? }`.
async fn create_capture_profile(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    let name = match body.get("name").and_then(|v| v.as_str()) {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => return crate::problem::Problem::bad_request("name is required").into_response(),
    };
    let quality_tier = body
        .get("quality_tier")
        .and_then(|v| serde_json::from_value::<strivo_core::config::QualityTier>(v.clone()).ok());
    let format = body.get("format").and_then(|v| {
        serde_json::from_value::<strivo_core::config::RecordingFormat>(v.clone()).ok()
    });
    let transcode = body.get("transcode").and_then(|v| v.as_bool());
    let audio_only = body
        .get("audio_only")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let transcript = body
        .get("transcript")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let cutoff_episodes = body
        .get("cutoff_episodes")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    let _config_guard = state.config_write_lock.lock().await;
    let mut cfg = match strivo_core::config::AppConfig::load(state.config_path()) {
        Ok(c) => c,
        Err(e) => return crate::problem::Problem::internal(e.to_string()).into_response(),
    };
    if cfg.capture_profiles.iter().any(|p| p.name == name) {
        return crate::problem::Problem::bad_request(format!("profile '{name}' already exists"))
            .into_response();
    }
    cfg.capture_profiles
        .push(strivo_core::config::CaptureProfile {
            name: name.clone(),
            quality_tier,
            format,
            transcode,
            audio_only,
            transcript,
            cutoff_episodes,
        });
    if let Err(e) = cfg.save(state.config_path()) {
        return crate::problem::Problem::internal(e.to_string()).into_response();
    }
    if let Err(e) = state.refresh_config().await {
        tracing::warn!("config cache refresh failed: {e}");
    }
    (
        StatusCode::CREATED,
        Json(json!({ "ok": true, "name": name })),
    )
        .into_response()
}

/// `PUT /api/v1/capture_profiles/{name}` — update an existing capture profile.
async fn update_capture_profile(
    headers: HeaderMap,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    let _config_guard = state.config_write_lock.lock().await;
    let mut cfg = match strivo_core::config::AppConfig::load(state.config_path()) {
        Ok(c) => c,
        Err(e) => return crate::problem::Problem::internal(e.to_string()).into_response(),
    };
    let Some(profile) = cfg.capture_profiles.iter_mut().find(|p| p.name == name) else {
        return crate::problem::Problem::not_found("capture profile not found").into_response();
    };
    if let Some(tier) = body.get("quality_tier") {
        profile.quality_tier = if tier.is_null() {
            None
        } else {
            serde_json::from_value(tier.clone()).ok()
        };
    }
    if let Some(fmt) = body.get("format") {
        profile.format = if fmt.is_null() {
            None
        } else {
            serde_json::from_value(fmt.clone()).ok()
        };
    }
    if let Some(v) = body.get("transcode") {
        profile.transcode = if v.is_null() { None } else { v.as_bool() };
    }
    if let Some(v) = body.get("audio_only").and_then(|v| v.as_bool()) {
        profile.audio_only = v;
    }
    if let Some(v) = body.get("transcript").and_then(|v| v.as_bool()) {
        profile.transcript = v;
    }
    if let Some(v) = body.get("cutoff_episodes") {
        profile.cutoff_episodes = if v.is_null() {
            None
        } else {
            v.as_u64().map(|n| n as u32)
        };
    }
    if let Err(e) = cfg.save(state.config_path()) {
        return crate::problem::Problem::internal(e.to_string()).into_response();
    }
    if let Err(e) = state.refresh_config().await {
        tracing::warn!("config cache refresh failed: {e}");
    }
    Json(json!({ "ok": true, "name": name })).into_response()
}

/// `DELETE /api/v1/capture_profiles/{name}` — delete a capture profile.
async fn delete_capture_profile(
    headers: HeaderMap,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    let _config_guard = state.config_write_lock.lock().await;
    let mut cfg = match strivo_core::config::AppConfig::load(state.config_path()) {
        Ok(c) => c,
        Err(e) => return crate::problem::Problem::internal(e.to_string()).into_response(),
    };
    let before = cfg.capture_profiles.len();
    cfg.capture_profiles.retain(|p| p.name != name);
    if cfg.capture_profiles.len() == before {
        return crate::problem::Problem::not_found("capture profile not found").into_response();
    }
    if let Err(e) = cfg.save(state.config_path()) {
        return crate::problem::Problem::internal(e.to_string()).into_response();
    }
    if let Err(e) = state.refresh_config().await {
        tracing::warn!("config cache refresh failed: {e}");
    }
    Json(json!({ "ok": true })).into_response()
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/capture_profiles", post(create_capture_profile))
        .route(
            "/api/v1/capture_profiles/{name}",
            put(update_capture_profile).delete(delete_capture_profile),
        )
}
