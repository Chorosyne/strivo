//! Strivo Pro licence status endpoint (Phase 1 stub).
//!
//! Returns the current entitlement so the SPA can decide whether to show
//! the upgrade card. The real implementation lives behind the activation
//! backend (CF Workers + D1) and the in-app licence cache (Phase 3).
//! Until then this returns a hard-coded "free, not entitled" payload so
//! the UI surface lights up.

use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::json;

use crate::server::AppState;

#[derive(Serialize)]
struct LicenceStatus {
    /// True if any Pro feature should unlock.
    entitled: bool,
    /// "free" | "pro" | "trial".
    tier: &'static str,
    /// Present when a trial is active; null otherwise.
    trial: Option<serde_json::Value>,
    /// ISO-8601 expiry for paid/trial; null for free.
    expires_at: Option<String>,
    /// Set once Phase 3 is wired up.
    machine_id: Option<String>,
    /// Tells the SPA the real backend is offline — show the upgrade card
    /// but disable the "Activate" button (the trial CTA stays live).
    implemented: bool,
}

async fn status() -> Json<LicenceStatus> {
    // Dev override: STRIVO_DEV_UNLOCK_ALL=1 reports as fully entitled so
    // the team can dogfood gated features without a real licence. Stays
    // wired through Phase 3 — the gating layer reads the same env.
    let dev_unlock = std::env::var("STRIVO_DEV_UNLOCK_ALL")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    Json(LicenceStatus {
        entitled: dev_unlock,
        tier: if dev_unlock { "pro" } else { "free" },
        trial: None,
        expires_at: None,
        machine_id: None,
        implemented: false,
    })
}

async fn not_implemented() -> (axum::http::StatusCode, Json<serde_json::Value>) {
    (
        axum::http::StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": "not_implemented",
            "message": "Activation backend is not wired yet — coming in Phase 3."
        })),
    )
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/licence/status", get(status))
        .route(
            "/api/v1/licence/activate",
            axum::routing::post(not_implemented),
        )
        .route(
            "/api/v1/licence/trial",
            axum::routing::post(not_implemented),
        )
        .route(
            "/api/v1/licence/refresh",
            axum::routing::post(not_implemented),
        )
}
