//! Persisted watch history: which recording UUIDs the user has played.
//!
//! Stored at `{state_dir}/watched.json` as a flat array of Uuids. Best-effort:
//! IO failures are logged but never propagate — losing a "watched" flag is a
//! UX inconvenience, not a correctness bug.

use std::collections::HashSet;
use std::path::PathBuf;

use uuid::Uuid;

use crate::config::AppConfig;

fn path() -> PathBuf {
    AppConfig::state_dir().join("watched.json")
}

pub fn load() -> HashSet<Uuid> {
    let p = path();
    let Ok(contents) = std::fs::read_to_string(&p) else {
        return HashSet::new();
    };
    serde_json::from_str::<Vec<Uuid>>(&contents)
        .map(|v| v.into_iter().collect())
        .unwrap_or_else(|e| {
            tracing::warn!("watched.json parse failed: {e}");
            HashSet::new()
        })
}

pub fn save(watched: &HashSet<Uuid>) {
    let p = path();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let list: Vec<&Uuid> = watched.iter().collect();
    match serde_json::to_string_pretty(&list) {
        Ok(s) => {
            if let Err(e) = std::fs::write(&p, s) {
                tracing::warn!("watched.json write failed: {e}");
            }
        }
        Err(e) => tracing::warn!("watched.json serialize failed: {e}"),
    }
}
