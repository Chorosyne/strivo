//! SQLite store for EDL drafts.
//!
//! One EDL per recording (latest wins). The SPA hits `save` after
//! every meaningful edit so the draft survives a page reload.

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};

use crate::Edl;

pub struct EdlStore {
    conn: Connection,
}

impl EdlStore {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path).with_context(|| format!("open {}", path.display()))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS edls (
                recording_id TEXT PRIMARY KEY,
                edl_json     TEXT NOT NULL,
                updated_at   TEXT NOT NULL
             );",
        )?;
        Ok(Self { conn })
    }

    pub fn save(&self, edl: &Edl) -> Result<()> {
        let json = serde_json::to_string(edl)?;
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR REPLACE INTO edls (recording_id, edl_json, updated_at)
             VALUES (?1, ?2, ?3)",
            params![edl.recording_id, json, now],
        )?;
        Ok(())
    }

    pub fn load(&self, recording_id: &str) -> Result<Option<Edl>> {
        let mut stmt = self
            .conn
            .prepare("SELECT edl_json FROM edls WHERE recording_id = ?1")?;
        let row = stmt
            .query_row([recording_id], |r| r.get::<_, String>(0))
            .optional()?;
        Ok(row
            .map(|json| serde_json::from_str(&json))
            .transpose()
            .context("parse cached EDL")?)
    }

    pub fn clear(&self, recording_id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM edls WHERE recording_id = ?1", [recording_id])?;
        Ok(())
    }
}
