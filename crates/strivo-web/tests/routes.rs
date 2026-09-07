//! Route-shape tests for the strivo-web router (webui phase 10 / web-auth
//! remediation).
//!
//! These build the REAL router via `strivo_web::server::build_router`, fed
//! an `AppState` whose `IpcClient` is bound to a socket that never connects
//! (`AppState::test_state`). No daemon required: a handler that reaches the
//! IPC call after an (absent) auth check observes a connection failure —
//! typically a 503, or in `recordings::download`'s case a 404 from
//! `lookup_path` — rather than panicking. Critically, a 503/404 from that
//! path still proves the handler ran (i.e. auth did NOT block it), which is
//! exactly the signal these tests need.

use axum::body::to_bytes;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use tower::ServiceExt;

use strivo_web::auth::ApiKey;
use strivo_web::server::{build_router, AppState, PUBLIC_ROUTES};

fn key() -> ApiKey {
    ApiKey("test-key-12345".into())
}

/// The real, fully-wired router (every route + the auth/CSRF middleware
/// stack from `server::build_router`), backed by a disconnected IPC client.
fn app() -> axum::Router {
    build_router(AppState::test_state("route-shape-test-key"))
}

/// Send `method path` through `router` with an `X-Api-Key: bogus-key-value`
/// header (never a valid key — see `key()`/`AppState::test_state`, which
/// use different literals). State-changing methods carry a JSON body so
/// axum's `Json<T>` extractor doesn't short-circuit with 400/415 before the
/// handler's own auth check ever runs.
async fn send_bogus_key(router: axum::Router, method: &str, path: &str) -> StatusCode {
    let m = Method::from_bytes(method.to_ascii_uppercase().as_bytes()).unwrap();
    let mut builder = Request::builder()
        .method(m)
        .uri(path)
        .header("x-api-key", "bogus-key-value");
    let body = if matches!(method, "post" | "put" | "delete" | "patch") {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
        Body::from("{}")
    } else {
        Body::empty()
    };
    let req = builder.body(body).unwrap();
    router.oneshot(req).await.unwrap().status()
}

#[test]
fn api_key_constant_time_compare() {
    let k = key();
    assert!(k.matches("test-key-12345"));
    assert!(!k.matches("test-key-12346"));
    assert!(!k.matches("test-key"));
    assert!(!k.matches(""));
}

#[test]
fn api_key_generate_is_alphanumeric() {
    let k = ApiKey::generate();
    let s = k.as_str();
    assert_eq!(s.len(), 32);
    assert!(s.chars().all(|c| c.is_ascii_alphanumeric()));
}

/// The real router's catch-all 404 fallback still fires for a path that
/// matches nothing — replaces the old placeholder test that asserted 404
/// against a deliberately-empty stub `Router` (which proved the stub was
/// empty, not that the app's fallback works).
#[tokio::test]
async fn router_unmatched_path_404s() {
    let app = app();
    let req = Request::builder()
        .uri("/api/v1/totally-bogus-nonexistent-route")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

/// `GET /api/v1/health` is the one documented no-auth route on the always-
/// compiled surface; confirm the real router still serves it without a key
/// (the S08 sweep below skips it — this is its positive-path complement).
/// It reports 503 rather than 200 against this test's disconnected IPC
/// client (a real "daemon unreachable" liveness signal, not an auth
/// rejection) — assert not-401 rather than a specific 2xx/5xx.
#[tokio::test]
async fn health_is_public() {
    let req = Request::builder()
        .uri("/api/v1/health")
        .body(Body::empty())
        .unwrap();
    let resp = app().oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn body_to_bytes_helper_compiles() {
    // This test just keeps the to_bytes import alive so future
    // tests that want to assert on response bodies don't have to
    // re-import. Real body assertions land alongside daemon-mocked
    // tests in a follow-up.
    let body = Body::from("hello");
    let bytes = to_bytes(body, usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], b"hello");
}

// ── S01/S02 acceptance: bogus X-Api-Key must yield 401, specifically ─────
//
// A bare "not 200" assertion would pass against a guard that's never
// reached at all (e.g. a 404/503/307 from further down the handler). These
// assert the literal 401.

#[cfg(feature = "creator")]
#[tokio::test]
async fn s01_pipelines_chains_delete_rejects_bogus_key() {
    let status = send_bogus_key(app(), "delete", "/api/v1/pipelines/chains/s01-test-chain").await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "DELETE /api/v1/pipelines/chains/{{id}} must reject a bogus X-Api-Key with 401, got {status}"
    );
}

#[tokio::test]
async fn s02_recording_download_rejects_bogus_key() {
    let id = uuid::Uuid::nil();
    let status = send_bogus_key(app(), "get", &format!("/api/v1/recordings/{id}/download")).await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "GET /api/v1/recordings/{{id}}/download must reject a bogus X-Api-Key with 401, got {status}"
    );
}

#[tokio::test]
async fn s02_recording_play_rejects_bogus_key() {
    let id = uuid::Uuid::nil();
    let status = send_bogus_key(app(), "get", &format!("/api/v1/recordings/{id}/play")).await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "GET /api/v1/recordings/{{id}}/play must reject a bogus X-Api-Key with 401, got {status}"
    );
}

#[tokio::test]
async fn s06_licence_trial_rejects_bogus_key() {
    let status = send_bogus_key(app(), "post", "/api/v1/licence/trial").await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "POST /api/v1/licence/trial must reject a bogus X-Api-Key with 401, got {status}"
    );
}

#[cfg(feature = "creator")]
#[tokio::test]
async fn s07_plugin_capabilities_rejects_bogus_key() {
    let status = send_bogus_key(app(), "get", "/api/v1/plugins/capabilities").await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "GET /api/v1/plugins/capabilities must reject a bogus X-Api-Key with 401, got {status}"
    );
}

#[cfg(feature = "creator")]
#[tokio::test]
async fn s07_pipelines_dag_rejects_bogus_key() {
    let status = send_bogus_key(app(), "get", "/api/v1/pipelines/dag").await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "GET /api/v1/pipelines/dag must reject a bogus X-Api-Key with 401, got {status}"
    );
}

// ── S08: route-level auth invariant ───────────────────────────────────────
//
// Enumerates every route registration this crate's routers make (grepped
// from the `.route(...)` call sites in `src/routes/*.rs`; kept in sync by
// hand — axum 0.8's `Router` has no runtime route-listing API) and asserts
// EXACT-MATCH against `KNOWN_PUBLIC`, the one place every intentionally
// unauthenticated route is declared: every route in `KNOWN_PUBLIC` is
// skipped, and every route NOT in it must reject a bogus `X-Api-Key` with
// literal 401. A route added to `ALWAYS_ROUTES`/`CREATOR_ROUTES` (or a new
// `.route(...)` call site not yet added to either table) that isn't also
// declared in `KNOWN_PUBLIC` fails the build the moment it stops requiring
// auth — that's the point: an ungated route can no longer hide.
//
// S16 (see server.rs's `require_auth`) closed the one legitimate escape
// hatch this test used to have: a route requiring a JSON body used to
// reject a malformed/mismatched body with 400/415/422 *before* the
// handler's own auth check ever ran, because axum resolves `Json<T>`
// before invoking the handler. Auth now runs in `route_layer` middleware
// ahead of every extractor, so that class of result can't occur here any
// more — `is_body_shape_rejection` below is kept only as a hard assertion
// (zero tolerance, not a printed warning) so a regression that reopens it
// fails loudly instead of being silently absorbed as "inconclusive".

/// Public by design — imported directly from `server::PUBLIC_ROUTES`, the
/// one place every intentionally-unauthenticated route is declared (also
/// enforced at runtime by `require_auth`'s `is_public_route`), so this
/// sweep can't silently drift from the runtime allowlist. See the
/// remediation brief. `/app` is not named explicitly in that brief but
/// serves the exact same `spa_shell` handler as `/` with no auth of its
/// own, so it's treated as part of "the SPA shell" here.
const KNOWN_PUBLIC: &[(&str, &str)] = PUBLIC_ROUTES;

/// Guards against a future refactor accidentally reintroducing a second,
/// independently-maintained public-route list: `KNOWN_PUBLIC` above must
/// stay a direct alias of `server::PUBLIC_ROUTES`, not a copy of it.
#[test]
fn known_public_matches_library_public_routes() {
    assert_eq!(
        KNOWN_PUBLIC, PUBLIC_ROUTES,
        "the sweep's public-route list has diverged from strivo_web::server::PUBLIC_ROUTES"
    );
}

/// Always-compiled surface (PVR + Creator builds both mount these).
const ALWAYS_ROUTES: &[(&str, &str)] = &[
    ("get", "/api/v1/health/checks"),
    ("get", "/api/v1/telemetry"),
    ("get", "/api/v1/channels"),
    ("get", "/api/v1/patreon"),
    ("get", "/api/v1/recordings"),
    ("post", "/api/v1/recordings"),
    ("delete", "/api/v1/recordings/{id}"),
    ("get", "/api/v1/recordings/{id}"),
    ("get", "/api/v1/recordings/{id}/thumb"),
    ("get", "/api/v1/recordings/{id}/probe"),
    ("post", "/api/v1/recordings/stop_all"),
    ("post", "/api/v1/recordings/clear_errored"),
    ("delete", "/api/v1/recordings/{id}/file"),
    ("post", "/api/v1/recordings/{id}/remux"),
    ("get", "/api/v1/schedule"),
    ("post", "/api/v1/schedule"),
    ("delete", "/api/v1/schedule/{index}"),
    ("get", "/api/v1/settings"),
    ("post", "/api/v1/poll_now"),
    ("post", "/api/v1/settings/poll_interval"),
    ("post", "/api/v1/settings/update"),
    ("post", "/api/v1/settings/platform/{name}"),
    ("get", "/api/v1/logs"),
    ("get", "/api/v1/history"),
    ("post", "/api/v1/backup"),
    ("get", "/api/v1/backups"),
    ("post", "/api/v1/backups/{name}/restore"),
    ("get", "/api/v1/backups/{name}/download"),
    ("delete", "/api/v1/blocklist"),
    ("get", "/api/v1/blocklist"),
    ("post", "/api/v1/blocklist"),
    ("put", "/api/v1/channels/{channel_key}/auto_record"),
    ("get", "/api/v1/monitor"),
    ("post", "/api/v1/capture_profiles"),
    ("delete", "/api/v1/capture_profiles/{name}"),
    ("put", "/api/v1/capture_profiles/{name}"),
    ("get", "/api/v1/channels/export"),
    ("post", "/api/v1/channels/import"),
    ("get", "/api/v1/storage"),
    ("get", "/api/v1/gantt"),
    ("post", "/api/v1/channels/{channel_id}/bulk"),
    ("post", "/api/v1/channels/{channel_id}/playlists"),
    ("post", "/api/v1/channels/{channel_id}/vods"),
    ("post", "/api/v1/patreon/pull"),
    ("post", "/api/v1/vods/download"),
    ("post", "/api/v1/channels/resolve"),
    ("get", "/events"),
    ("get", "/api/v1/licence/status"),
    ("post", "/api/v1/licence/activate"),
    ("post", "/api/v1/licence/trial"),
    ("post", "/api/v1/licence/refresh"),
    // S15: gated (not KNOWN_PUBLIC) even though it only clears the
    // caller's own cookies — no reason for an unauthenticated caller to
    // reach it, and require_auth's allowlist doesn't special-case it.
    ("post", "/api/v1/auth/logout"),
    ("get", "/api/v1/multistream/tiles"),
    ("get", "/api/v1/recordings/{id}/download"),
    ("get", "/api/v1/recordings/{id}/play"),
];

/// Creator Edition only (`--features creator`): api.rs's pipeline/
/// marketplace/archiver/capabilities block plus the whole of
/// `routes::plugins`.
#[cfg(feature = "creator")]
const CREATOR_ROUTES: &[(&str, &str)] = &[
    ("get", "/api/v1/pipelines/dag"),
    ("get", "/api/v1/pipelines/runs"),
    ("post", "/api/v1/pipelines/runs"),
    ("post", "/api/v1/pipelines/runs/{id}/cancel"),
    ("post", "/api/v1/pipelines/stages/{id}/retry"),
    (
        "get",
        "/api/v1/pipelines/runs/{pipeline_id}/stages/{stage_id}/artifacts/{index}",
    ),
    ("get", "/api/v1/pipelines/chains"),
    ("post", "/api/v1/pipelines/chains"),
    ("delete", "/api/v1/pipelines/chains/{id}"),
    // S15: gated. The handler's doc comment calls this "public" meaning
    // not Pro-gated (free builds still see the upgrade path) — that's
    // orthogonal to authentication, which is required like every other
    // route here.
    ("get", "/api/v1/marketplace/catalog"),
    ("put", "/api/v1/channels/{channel_key}/archiver_tandem"),
    ("put", "/api/v1/channels/{channel_key}/archiver_playlists"),
    ("get", "/api/v1/plugins/capabilities"),
    ("post", "/api/v1/plugins/{plugin}/{verb}"),
    ("get", "/api/v1/plugins"),
    ("get", "/api/v1/plugins/crunchr/recordings"),
    ("get", "/api/v1/plugins/crunchr/recordings/{id}"),
    ("get", "/api/v1/plugins/crunchr/search"),
    ("get", "/api/v1/plugins/archiver/channels"),
    (
        "get",
        "/api/v1/plugins/archiver/channels/{channel_id}/videos",
    ),
    ("get", "/api/v1/plugins/viewguard/verdicts"),
    (
        "get",
        "/api/v1/plugins/viewguard/channels/{channel_id}/samples",
    ),
    ("get", "/api/v1/plugins/insights/words"),
    ("get", "/api/v1/plugins/insights/topics"),
    ("get", "/api/v1/plugins/insights/recordings/{id}/speakers"),
    ("get", "/api/v1/plugins/insights/export"),
    ("get", "/api/v1/recordings/{id}/captions.vtt"),
    ("post", "/api/v1/plugins/chapters/{id}"),
    ("post", "/api/v1/plugins/cuepoints/{id}"),
    ("post", "/api/v1/plugins/clipper/{id}/analyze"),
    ("post", "/api/v1/plugins/clipper/{id}/extract"),
    ("get", "/api/v1/plugins/clipper/{id}/clips"),
    ("post", "/api/v1/plugins/thumbnails/{id}"),
    ("get", "/api/v1/plugins/thumbnails/{id}/{stem}"),
    ("get", "/api/v1/plugins/thumbnails/file"),
    ("get", "/api/v1/plugins/insights/compare"),
    ("get", "/api/v1/plugins/insights/retention/{id}"),
    ("get", "/api/v1/plugins/captions/{id}"),
    ("get", "/api/v1/plugins/captions/{id}/style"),
    ("post", "/api/v1/plugins/captions/{id}/style"),
    ("get", "/api/v1/plugins/multitrack/{id}"),
    ("post", "/api/v1/plugins/multitrack/{id}/extract"),
    ("get", "/api/v1/plugins/brandsafe/{id}"),
    ("post", "/api/v1/plugins/reuse/{id}/generate"),
    ("get", "/api/v1/plugins/reuse/{id}"),
    ("get", "/api/v1/plugins/casebook/{id}"),
    ("get", "/api/v1/plugins/heatmap/{id}"),
    ("get", "/api/v1/plugins/editor/{id}"),
    ("post", "/api/v1/plugins/editor/{id}"),
    ("post", "/api/v1/plugins/editor/{id}/render"),
    ("get", "/api/v1/plugins/editor/{id}/revisions"),
    (
        "post",
        "/api/v1/plugins/editor/{id}/revisions/{rev_id}/restore",
    ),
    ("get", "/api/v1/plugins/viewguard/trend"),
    ("post", "/api/v1/plugins/broll/{id}"),
    ("post", "/api/v1/plugins/chat-density/{id}"),
    ("post", "/api/v1/plugins/deadair/{id}"),
    ("get", "/api/v1/plugins/branding/{id}"),
    ("post", "/api/v1/plugins/branding/{id}"),
    ("get", "/api/v1/plugins/chat/rooms"),
    ("post", "/api/v1/plugins/chat/parse"),
    ("post", "/api/v1/chat/send"),
    ("post", "/api/v1/dataviz/run"),
    ("get", "/api/v1/research/projects"),
    ("post", "/api/v1/research/projects"),
    ("get", "/api/v1/research/projects/{id}"),
    ("get", "/api/v1/research/projects/{id}/codes"),
    ("post", "/api/v1/research/projects/{id}/codes"),
    ("get", "/api/v1/research/projects/{id}/sources"),
    ("post", "/api/v1/research/projects/{id}/sources"),
    ("get", "/api/v1/research/projects/{id}/cases"),
    ("post", "/api/v1/research/projects/{id}/cases"),
    (
        "post",
        "/api/v1/research/projects/{id}/cases/{case_id}/sources",
    ),
    ("get", "/api/v1/research/projects/{id}/codings"),
    ("post", "/api/v1/research/projects/{id}/codings"),
    ("get", "/api/v1/research/projects/{id}/memos"),
    ("post", "/api/v1/research/projects/{id}/memos"),
    ("get", "/api/v1/research/projects/{id}/relationships"),
    ("post", "/api/v1/research/projects/{id}/relationships"),
    ("get", "/api/v1/research/projects/{id}/agreement"),
    ("get", "/api/v1/research/projects/{id}/export"),
    ("get", "/api/v1/research/projects/{id}/signals"),
    ("get", "/api/v1/research/projects/{id}/search"),
    ("get", "/api/v1/research/projects/{id}/moments"),
    ("post", "/api/v1/research/projects/{id}/moments"),
    ("post", "/api/v1/research/projects/{id}/migrate/crunchr"),
    ("post", "/api/v1/research/projects/{id}/migrate/legacy"),
    ("post", "/api/v1/plugins/loudness/{id}"),
    ("post", "/api/v1/plugins/structure/{id}"),
    ("get", "/api/v1/plugins/automation/{id}"),
    ("post", "/api/v1/plugins/automation/{id}"),
    ("get", "/api/v1/plugins/scenes/{id}"),
    ("post", "/api/v1/plugins/scenes/{id}"),
    ("post", "/api/v1/plugins/scenes/{id}/{scene_id}/restore"),
    ("delete", "/api/v1/plugins/scenes/{id}/{scene_id}"),
    ("post", "/api/v1/plugins/schedule-optimizer/{id}"),
    ("post", "/api/v1/plugins/beat-detect/{id}"),
    ("post", "/api/v1/plugins/vad/{id}"),
    ("post", "/api/v1/plugins/sidechain/{id}"),
    ("get", "/api/v1/plugins/insert-fx/{id}"),
    ("post", "/api/v1/plugins/insert-fx/{id}"),
    ("post", "/api/v1/plugins/insert-fx/{id}/preset/{bus}"),
    ("get", "/api/v1/plugins/pitch/{id}"),
    ("post", "/api/v1/plugins/pitch/{id}"),
    ("post", "/api/v1/plugins/pitch/{id}/fit"),
    ("get", "/api/v1/plugins/ab-render/{id}"),
    ("post", "/api/v1/plugins/ab-render/{id}/{slot}"),
    ("post", "/api/v1/plugins/ab-render/{id}/compare"),
    ("get", "/api/v1/plugins/submix/{id}"),
    ("post", "/api/v1/plugins/submix/{id}"),
    ("delete", "/api/v1/plugin-storage/{name}"),
    ("get", "/api/v1/plugin-storage/{name}"),
];

/// Fill every `{token}` path segment with a value that parses as both a
/// `Uuid` and a `String` (so we don't need to know each handler's extractor
/// type), except tokens that look like a numeric index, which get `"0"`.
/// `{*path}` wildcards (only the allowlisted assets route uses one) get a
/// harmless literal.
fn fill_path(template: &str) -> String {
    let mut out = String::new();
    let mut chars = template.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            let mut token = String::new();
            for c2 in chars.by_ref() {
                if c2 == '}' {
                    break;
                }
                token.push(c2);
            }
            if token.starts_with('*') {
                out.push('x');
            } else if token.contains("index") {
                out.push('0');
            } else {
                out.push_str("00000000-0000-0000-0000-000000000000");
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Body-shape rejections happen before a handler's auth check ever runs
/// (axum resolves every extractor, `Json<T>` included, before invoking the
/// handler body) — not a signal about auth at all. Treat as inconclusive.
fn is_body_shape_rejection(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::BAD_REQUEST
            | StatusCode::UNSUPPORTED_MEDIA_TYPE
            | StatusCode::UNPROCESSABLE_ENTITY
    )
}

async fn check_table(table: &[(&str, &str)]) -> (Vec<String>, Vec<String>) {
    let mut violations = Vec::new();
    let mut inconclusive = Vec::new();
    for &(method, path) in table {
        if KNOWN_PUBLIC.contains(&(method, path)) {
            continue;
        }
        let filled = fill_path(path);
        let status = send_bogus_key(app(), method, &filled).await;
        if status == StatusCode::UNAUTHORIZED {
            continue;
        }
        if is_body_shape_rejection(status) {
            inconclusive.push(format!(
                "{} {path} -> {status} (body-shape rejection before auth check; inconclusive)",
                method.to_ascii_uppercase()
            ));
            continue;
        }
        violations.push(format!(
            "{} {path} -> {status} (expected 401)",
            method.to_ascii_uppercase()
        ));
    }
    (violations, inconclusive)
}

#[tokio::test]
async fn s08_always_routes_require_auth() {
    let (violations, inconclusive) = check_table(ALWAYS_ROUTES).await;
    assert!(
        inconclusive.is_empty(),
        "route(s) gave a body-shape rejection before auth ran (S16 regression — the auth \
         gate must run ahead of every extractor, not just some):\n{}",
        inconclusive.join("\n")
    );
    assert!(
        violations.is_empty(),
        "route(s) reachable without auth (bogus X-Api-Key did not get 401) — gate it, or add \
         it to KNOWN_PUBLIC with a one-line rationale:\n{}",
        violations.join("\n")
    );
}

#[cfg(feature = "creator")]
#[tokio::test]
async fn s08_creator_routes_require_auth() {
    let (violations, inconclusive) = check_table(CREATOR_ROUTES).await;
    assert!(
        inconclusive.is_empty(),
        "route(s) gave a body-shape rejection before auth ran (S16 regression — the auth \
         gate must run ahead of every extractor, not just some):\n{}",
        inconclusive.join("\n")
    );
    assert!(
        violations.is_empty(),
        "route(s) reachable without auth (bogus X-Api-Key did not get 401) — gate it, or add \
         it to KNOWN_PUBLIC with a one-line rationale:\n{}",
        violations.join("\n")
    );
}

// ── Channel export/import round-trip (task 4) ─────────────────────────

#[test]
fn channel_export_json_roundtrip() {
    use strivo_core::config::{AppConfig, AutoRecordEntry, RecordingFormat};

    let auto_record_channels = vec![
        AutoRecordEntry {
            platform: "Twitch".into(),
            channel_id: "12345".into(),
            channel_name: "streamer_one".into(),
            format: Some(RecordingFormat {
                container: Some("mp4".into()),
                ..Default::default()
            }),
            profile: Some("hd".into()),
        },
        AutoRecordEntry {
            platform: "YouTube".into(),
            channel_id: "UCabc123".into(),
            channel_name: "yt_creator".into(),
            format: None,
            profile: None,
        },
    ];
    let cfg = AppConfig {
        auto_record_channels,
        ..Default::default()
    };

    // Serialise export shape.
    let export = serde_json::json!({
        "version": 1,
        "channels": cfg.auto_record_channels,
        "capture_profiles": cfg.capture_profiles,
    });
    let serialised = serde_json::to_string(&export).unwrap();
    // Deserialise back.
    let parsed: serde_json::Value = serde_json::from_str(&serialised).unwrap();
    assert_eq!(parsed["version"], 1);
    let channels = parsed["channels"].as_array().unwrap();
    assert_eq!(channels.len(), 2);
    assert_eq!(channels[0]["platform"], "Twitch");
    assert_eq!(channels[0]["channel_id"], "12345");
    assert_eq!(channels[1]["platform"], "YouTube");
}

#[test]
fn channel_import_version_validation() {
    // Wrong version should be detectable before merging.
    let bad = serde_json::json!({ "version": 99, "channels": [] });
    let version = bad["version"].as_u64().unwrap_or(0);
    assert_ne!(version, 1, "version 99 must not be accepted as v1");

    let ok = serde_json::json!({ "version": 1, "channels": [] });
    let version = ok["version"].as_u64().unwrap_or(0);
    assert_eq!(version, 1);
}

#[test]
fn import_channels_merge_logic() {
    use strivo_core::config::{AppConfig, AutoRecordEntry};

    let auto_record_channels = vec![AutoRecordEntry {
        platform: "Twitch".into(),
        channel_id: "existing".into(),
        channel_name: "Existing Channel".into(),
        format: None,
        profile: None,
    }];
    let mut cfg = AppConfig {
        auto_record_channels,
        ..Default::default()
    };

    // Incoming export: one new channel + one existing one (update only format).
    let incoming: Vec<AutoRecordEntry> = vec![
        AutoRecordEntry {
            platform: "Twitch".into(),
            channel_id: "existing".into(),
            channel_name: "Existing Channel (renamed)".into(),
            format: None,
            profile: Some("hd".into()),
        },
        AutoRecordEntry {
            platform: "YouTube".into(),
            channel_id: "new_yt".into(),
            channel_name: "New YT".into(),
            format: None,
            profile: None,
        },
    ];

    // Simulate import merge logic.
    let mut added = 0u32;
    let mut updated = 0u32;
    for ch in &incoming {
        let key = format!("{}:{}", ch.platform, ch.channel_id);
        if let Some(existing) = cfg
            .auto_record_channels
            .iter_mut()
            .find(|c| format!("{}:{}", c.platform, c.channel_id) == key)
        {
            existing.profile = ch.profile.clone();
            updated += 1;
        } else {
            cfg.auto_record_channels.push(ch.clone());
            added += 1;
        }
    }

    assert_eq!(added, 1, "one new channel should be added");
    assert_eq!(updated, 1, "one existing channel should be updated");
    assert_eq!(cfg.auto_record_channels.len(), 2);
    // channel_name must be preserved from the existing record (not clobbered).
    let existing = cfg
        .auto_record_channels
        .iter()
        .find(|c| c.channel_id == "existing")
        .unwrap();
    assert_eq!(
        existing.channel_name, "Existing Channel",
        "channel_name must not be clobbered by import"
    );
    assert_eq!(
        existing.profile.as_deref(),
        Some("hd"),
        "profile updated from import"
    );
}

// ── Quality-tier → format selector (task 1) ───────────────────────────

#[test]
fn quality_tier_selectors_are_valid_ytdlp_format_strings() {
    use strivo_core::config::QualityTier;

    // Spot-check that each tier produces a non-empty string that looks
    // like a valid yt-dlp format expression.
    for (tier, expected_substr) in [
        (QualityTier::Best, "best"),
        (QualityTier::P1080, "1080"),
        (QualityTier::P720, "720"),
        (QualityTier::P480, "480"),
        (QualityTier::AudioOnly, "bestaudio"),
    ] {
        let sel = tier.format_selector();
        assert!(
            sel.contains(expected_substr),
            "tier {tier:?} selector {sel:?} should contain {expected_substr:?}"
        );
    }
}

// ── Shared jobs.db handle wiring (R05/V08) ─────────────────────────────
//
// The prior remediation attempt's only coverage exercised `AppState::jobs_db()`
// directly against its own temp state — never through a route. That let a
// handler silently revert to a per-request `PersistDb::open(..)` (the exact
// regression this branch fixes) while the suite stayed green. This test
// drives the REAL router (`build_router`, like every other test in this
// file) and observes the *effect* of the shared handle from outside the
// handler, rather than calling the accessor itself.

/// `GET /api/v1/history`, authenticated with `api_key`.
fn history_request(api_key: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri("/api/v1/history")
        .header("x-api-key", api_key)
        .body(Body::empty())
        .unwrap()
}

/// Two authenticated `/api/v1/history` calls through the real router must
/// initialise `AppState.jobs_db` exactly once. A handler that reverted to
/// opening its own `PersistDb` per request would never touch this cell at
/// all, so `jobs_db_cell.get()` would still read `None` after the requests
/// — that is the wiring gap this test is built to catch (proved by mutation
/// below; see the R05 report for the failing-then-passing transcript).
#[tokio::test]
async fn shared_jobs_db_handle_is_initialised_by_a_real_route() {
    let api_key = "jobs-db-wiring-test-key";
    let mut state = AppState::test_state(api_key);
    let dir = tempfile::tempdir().expect("tempdir");
    state.jobs_db_path = std::sync::Arc::new(dir.path().join("jobs.db"));
    // Retain a handle to the shared cell *before* `state` moves into the
    // router, so the test can inspect it after real requests run without
    // ever calling `jobs_db()` itself.
    let jobs_db_cell = state.jobs_db.clone();
    let router = build_router(state);

    let resp1 = router.clone().oneshot(history_request(api_key)).await.unwrap();
    assert_eq!(
        resp1.status(),
        StatusCode::OK,
        "first /api/v1/history call must succeed"
    );
    assert!(
        jobs_db_cell.get().is_some(),
        "AppState.jobs_db must be initialised after a real request reaches a jobs.db-backed \
         handler — a handler that opens its own PersistDb per request instead of going through \
         state.jobs_db() would leave this cell empty"
    );

    let resp2 = router.clone().oneshot(history_request(api_key)).await.unwrap();
    assert_eq!(
        resp2.status(),
        StatusCode::OK,
        "second /api/v1/history call must succeed"
    );
}
