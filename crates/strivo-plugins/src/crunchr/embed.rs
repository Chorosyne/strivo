//! Local vectorization of transcript chunks.
//!
//! Shells out to `scripts/embed_chunks.py` (sentence-transformers on GPU
//! when available), which turns chunk texts into L2-normalized float
//! vectors. The runner persists those vectors to `chunks.embedding` as a
//! little-endian `f32` BLOB so they are saveable, parsable, and ready for
//! cosine k-NN search.
//!
//! The Python helper is resolved (in order) from `$STRIVO_EMBED_SCRIPT`,
//! `~/.local/share/strivo/embed_chunks.py`, or `./scripts/embed_chunks.py`
//! relative to the current dir — mirroring how the `whisperx-local` backend
//! finds its bundled orchestrator.

use std::path::PathBuf;

use anyhow::{bail, Context, Result};

/// Embed `texts`, returning one vector per input (same order). Empty input
/// yields an empty vec without spawning Python.
pub async fn embed_texts(texts: &[String]) -> Result<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let script = resolve_script().context("could not locate embed_chunks.py")?;

    let payload = serde_json::to_string(texts)?;
    let tmp = tempfile::Builder::new()
        .prefix("crunchr-embed-")
        .suffix(".json")
        .tempfile()?;
    tokio::fs::write(tmp.path(), payload).await?;

    let python = std::env::var("STRIVO_EMBED_PYTHON").unwrap_or_else(|_| "python3".to_string());
    let output = tokio::process::Command::new(&python)
        .arg(&script)
        .arg(tmp.path())
        .output()
        .await
        .with_context(|| format!("failed to spawn {python} {}", script.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "embed_chunks.py exited with {}: {}",
            output.status,
            stderr.chars().rev().take(400).collect::<String>().chars().rev().collect::<String>()
        );
    }

    let vectors: Vec<Vec<f32>> = serde_json::from_slice(&output.stdout)
        .context("embed_chunks.py did not return a JSON array of float arrays")?;
    if vectors.len() != texts.len() {
        bail!(
            "embed_chunks.py returned {} vectors for {} texts",
            vectors.len(),
            texts.len()
        );
    }
    Ok(vectors)
}

/// Pack an embedding into a little-endian `f32` BLOB for the
/// `chunks.embedding` column. Decoded the same way by any reader.
pub fn vector_to_blob(v: &[f32]) -> Vec<u8> {
    let mut blob = Vec::with_capacity(v.len() * 4);
    for f in v {
        blob.extend_from_slice(&f.to_le_bytes());
    }
    blob
}

fn resolve_script() -> Result<PathBuf> {
    if let Ok(p) = std::env::var("STRIVO_EMBED_SCRIPT") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let p = PathBuf::from(home)
            .join(".local/share/strivo/embed_chunks.py");
        if p.is_file() {
            return Ok(p);
        }
    }
    let cwd = PathBuf::from("scripts/embed_chunks.py");
    if cwd.is_file() {
        return Ok(cwd);
    }
    bail!("set $STRIVO_EMBED_SCRIPT or install embed_chunks.py to ~/.local/share/strivo/")
}
