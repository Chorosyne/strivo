//! Speaker re-diarization.
//!
//! Voxtral's own speaker labels are unreliable on fast/overlapping speech, so
//! after transcription the runner replaces them with voice-embedding clusters
//! computed by `scripts/cluster_speakers.py` (WavLM x-vectors + agglomerative
//! clustering over the audio). Best-effort: on any failure the caller keeps
//! Voxtral's labels.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use super::types::Segment;

/// Re-diarize `segments` in place (rewrites `Segment::speaker`) using the audio
/// at `audio_path`. `target_k`, when set, forces exactly that many speakers
/// (the known cast size); otherwise the count is auto-detected. Returns the
/// resulting distinct-speaker count.
pub async fn recluster_speakers(
    audio_path: &Path,
    segments: &mut [Segment],
    target_k: Option<u32>,
) -> Result<usize> {
    if segments.len() < 2 {
        return Ok(segments.iter().filter(|s| s.speaker.is_some()).count().min(1));
    }
    let script = resolve_script().context("could not locate cluster_speakers.py")?;

    let payload = serde_json::to_string(
        &segments
            .iter()
            .map(|s| {
                serde_json::json!({"index": s.index, "start": s.start_sec, "end": s.end_sec})
            })
            .collect::<Vec<_>>(),
    )?;
    let tmp = tempfile::Builder::new()
        .prefix("crunchr-segs-")
        .suffix(".json")
        .tempfile()?;
    tokio::fs::write(tmp.path(), payload).await?;

    let python = std::env::var("STRIVO_EMBED_PYTHON").unwrap_or_else(|_| "python3".to_string());
    let mut cmd = tokio::process::Command::new(&python);
    cmd.arg(&script).arg(audio_path).arg(tmp.path());
    if let Some(k) = target_k.filter(|k| *k > 0) {
        cmd.env("STRIVO_SPK_K", k.to_string());
    }
    let output = cmd
        .output()
        .await
        .with_context(|| format!("failed to spawn {python} {}", script.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.chars().rev().take(400).collect::<String>().chars().rev().collect();
        bail!("cluster_speakers.py exited with {}: {tail}", output.status);
    }

    let map: std::collections::HashMap<String, String> = serde_json::from_slice(&output.stdout)
        .context("cluster_speakers.py did not return a JSON object map")?;
    if map.is_empty() {
        bail!("cluster_speakers.py returned an empty map");
    }

    let mut speakers = std::collections::HashSet::new();
    for s in segments.iter_mut() {
        if let Some(new_label) = map.get(&s.index.to_string()) {
            s.speaker = Some(new_label.clone());
            speakers.insert(new_label.clone());
        }
    }
    Ok(speakers.len())
}

fn resolve_script() -> Result<PathBuf> {
    if let Ok(p) = std::env::var("STRIVO_CLUSTER_SCRIPT") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let p = PathBuf::from(home).join(".local/share/strivo/cluster_speakers.py");
        if p.is_file() {
            return Ok(p);
        }
    }
    let cwd = PathBuf::from("scripts/cluster_speakers.py");
    if cwd.is_file() {
        return Ok(cwd);
    }
    bail!("set $STRIVO_CLUSTER_SCRIPT or install cluster_speakers.py to ~/.local/share/strivo/")
}
