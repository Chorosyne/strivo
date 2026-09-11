//! Config/DB backup + restore (roadmap item 16), plus the durable recording
//! history endpoint (roadmap item 17). Split out of `routes::api`.
//!
//! Dep-free: a backup is a directory `data_dir/backups/<timestamp>/`
//! holding copies of config.toml + jobs.db.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::routes::settings::{check_key, page_bounds, walk_dir_bytes, PageQuery};
use crate::server::AppState;

fn backups_dir() -> std::path::PathBuf {
    strivo_core::config::AppConfig::data_dir().join("backups")
}

/// Validate a user-supplied backup name: plain filename, no path parts.
/// Prevents traversal on the restore/download path.
fn safe_backup_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

async fn backup_create(headers: HeaderMap, State(state): State<AppState>) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    let name = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let dest = backups_dir().join(&name);
    if let Err(e) = std::fs::create_dir_all(&dest) {
        return crate::problem::Problem::internal(format!("create backup dir: {e}"))
            .into_response();
    }
    let cfg = state
        .config_path()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(strivo_core::config::AppConfig::config_path);
    let db = strivo_core::config::AppConfig::data_dir().join("jobs.db");
    let mut copied = Vec::new();
    if cfg.exists() {
        if let Err(e) = std::fs::copy(&cfg, dest.join("config.toml")) {
            return crate::problem::Problem::internal(format!("copy config: {e}")).into_response();
        }
        copied.push("config.toml");
    }
    if db.exists() {
        if let Err(e) = std::fs::copy(&db, dest.join("jobs.db")) {
            return crate::problem::Problem::internal(format!("copy jobs.db: {e}")).into_response();
        }
        copied.push("jobs.db");
    }
    (
        StatusCode::CREATED,
        Json(json!({ "name": name, "files": copied, "bytes": walk_dir_bytes(&dest).unwrap_or(0) })),
    )
        .into_response()
}

async fn backups_list(headers: HeaderMap, State(state): State<AppState>) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    let dir = backups_dir();
    let mut sets: Vec<serde_json::Value> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let p = e.path();
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            json!({
                "name": name,
                "bytes": walk_dir_bytes(&p).unwrap_or(0),
                "files": std::fs::read_dir(&p)
                    .into_iter().flatten().flatten()
                    .filter_map(|f| f.file_name().to_str().map(String::from))
                    .collect::<Vec<_>>(),
            })
        })
        .collect();
    // Newest first (names are sortable timestamps).
    sets.sort_by(|a, b| b["name"].as_str().cmp(&a["name"].as_str()));
    Json(json!({ "backups": sets })).into_response()
}

/// `GET /api/v1/backups/<name>/download` — stream the backup as a
/// tarball so the user can pull a copy off-box. Same name/safety rules
/// as restore; no auth bypass.
async fn backup_download(
    headers: HeaderMap,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    if !safe_backup_name(&name) {
        return crate::problem::Problem::bad_request("invalid backup name").into_response();
    }
    let dir = backups_dir().join(&name);
    if !dir.is_dir() {
        return crate::problem::Problem::not_found("backup not found").into_response();
    }
    // Archive work is blocking, so keep it off Tokio's request workers.
    // Conservative content-type makes browsers use "Save As".
    let archive_name = name.clone();
    let archive = tokio::task::spawn_blocking(move || {
        let child = std::process::Command::new("tar")
            .args([
                "-C",
                &dir.parent().unwrap_or(&dir).to_string_lossy(),
                "-czf",
                "-",
                &archive_name,
            ])
            .stdout(std::process::Stdio::piped())
            .spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(error) => return Err(format!("tar: {error}")),
        };
        let mut out = Vec::new();
        use std::io::Read;
        if let Some(mut stdout) = child.stdout.take() {
            stdout
                .read_to_end(&mut out)
                .map_err(|error| error.to_string())?;
        }
        let status = child.wait().map_err(|error| error.to_string())?;
        if !status.success() {
            return Err(format!("tar exited with {status}"));
        }
        Ok::<_, String>(out)
    })
    .await;
    let out = match archive {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return crate::problem::Problem::internal(e).into_response(),
        Err(e) => {
            return crate::problem::Problem::internal(format!("archive worker crashed: {e}"))
                .into_response()
        }
    };
    (
        [
            (axum::http::header::CONTENT_TYPE, "application/gzip"),
            (
                axum::http::header::CONTENT_DISPOSITION,
                Box::leak(
                    format!("attachment; filename=\"strivo-backup-{name}.tar.gz\"")
                        .into_boxed_str(),
                ),
            ),
        ],
        out,
    )
        .into_response()
}

async fn backup_restore(
    headers: HeaderMap,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    if !safe_backup_name(&name) {
        return crate::problem::Problem::bad_request("invalid backup name").into_response();
    }
    let src = backups_dir().join(&name);
    if !src.is_dir() {
        return crate::problem::Problem::not_found("backup not found").into_response();
    }
    let mut restored = Vec::new();
    let cfg_src = src.join("config.toml");
    if cfg_src.exists() {
        let cfg_dest = state
            .config_path()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(strivo_core::config::AppConfig::config_path);
        if let Err(e) = std::fs::copy(&cfg_src, cfg_dest) {
            return crate::problem::Problem::internal(format!("restore config: {e}"))
                .into_response();
        }
        restored.push("config.toml");
    }
    let db_src = src.join("jobs.db");
    if db_src.exists() {
        let db_dest = strivo_core::config::AppConfig::data_dir().join("jobs.db");
        if let Err(e) = std::fs::copy(&db_src, &db_dest) {
            return crate::problem::Problem::internal(format!("restore jobs.db: {e}"))
                .into_response();
        }
        restored.push("jobs.db");
    }
    Json(json!({
        "restored": restored,
        "note": "Restart the daemon for the restored config/DB to take effect.",
    }))
    .into_response()
}

/// `GET /api/v1/history` — durable recording history from the jobs DB
/// (roadmap item 17). Unlike `/recordings` (the in-memory, bounded daemon
/// snapshot), this survives restarts and includes completed/failed jobs.
async fn history(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> impl IntoResponse {
    if check_key(&headers, &state).is_err() {
        return crate::problem::Problem::unauthorized().into_response();
    }
    let db = match state.jobs_db().await {
        Ok(d) => d,
        Err(e) => return crate::problem::Problem::internal(e).into_response(),
    };
    if let Some(limit) = query.limit {
        let start = query.cursor.unwrap_or(0);
        return match db
            .load_recording_jobs_page(start, limit.clamp(1, 500))
            .await
        {
            Ok((jobs, total)) => {
                let end = start.saturating_add(jobs.len());
                Json(json!({
                    "history": jobs,
                    "total": total,
                    "next_cursor": (end < total).then_some(end),
                }))
                .into_response()
            }
            Err(e) => crate::problem::Problem::internal(e.to_string()).into_response(),
        };
    }
    match db.load_recording_jobs().await {
        Ok(mut jobs) => {
            jobs.sort_by_key(|j| std::cmp::Reverse(j.started_at));
            let total = jobs.len();
            let (start, end, next_cursor) = page_bounds(total, &query);
            Json(json!({
                "history": &jobs[start..end],
                "total": total,
                "next_cursor": next_cursor,
            }))
            .into_response()
        }
        Err(e) => crate::problem::Problem::internal(e.to_string()).into_response(),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/history", get(history))
        .route("/api/v1/backup", post(backup_create))
        .route("/api/v1/backups", get(backups_list))
        .route("/api/v1/backups/{name}/restore", post(backup_restore))
        .route("/api/v1/backups/{name}/download", get(backup_download))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_name_rejects_traversal() {
        assert!(safe_backup_name("2026-05-26T22-30-00Z"));
        assert!(safe_backup_name("snapshot_1.bak"));
        assert!(!safe_backup_name(""));
        assert!(!safe_backup_name(".."));
        assert!(!safe_backup_name("../etc"));
        assert!(!safe_backup_name("a/b"));
        assert!(!safe_backup_name("with space"));
    }
}
