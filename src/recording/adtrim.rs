//! Black-frame ad trimmer.
//!
//! Twitch ad breaks suppressed by `streamlink --twitch-disable-ads` still
//! leave a stretch of black (or a frozen placeholder) in the recording.
//! This module scans the finished file for contiguous black regions with
//! ffmpeg's `blackdetect`, then rewrites the file to drop them via
//! concat+copy — no re-encode.
//!
//! Cuts land on the nearest keyframe, which is the right tradeoff for
//! multi-hour streams: ad breaks are 30–90s, much longer than a GOP.
use anyhow::{anyhow, bail, Context, Result};
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Debug, Clone, Copy)]
pub struct BlackRange {
    pub start: f64,
    pub end: f64,
}

impl BlackRange {
    pub fn duration(&self) -> f64 {
        self.end - self.start
    }
}

#[derive(Debug)]
pub enum TrimOutcome {
    NoBlackFound,
    Trimmed { removed_secs: f64, ranges: usize },
}

/// Detect black regions in `input` longer than `min_secs` seconds. Returns
/// ranges sorted by start time.
pub async fn detect_black_ranges(input: &Path, min_secs: f64) -> Result<Vec<BlackRange>> {
    let output = Command::new("ffmpeg")
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(input)
        .args([
            "-vf",
            &format!("blackdetect=d={min_secs}:pix_th=0.10"),
            "-an",
            "-sn",
            "-f",
            "null",
            "-",
        ])
        .output()
        .await
        .context("spawn ffmpeg blackdetect")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("ffmpeg blackdetect failed: {stderr}");
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut ranges = Vec::new();
    for line in stderr.lines() {
        if !line.contains("blackdetect") || !line.contains("black_start") {
            continue;
        }
        // Format: ...blackdetect @ 0x... black_start:12.345 black_end:78.910 black_duration:66.565
        let start = parse_field(line, "black_start:");
        let end = parse_field(line, "black_end:");
        if let (Some(s), Some(e)) = (start, end) {
            if e > s {
                ranges.push(BlackRange { start: s, end: e });
            }
        }
    }
    ranges.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(ranges)
}

fn parse_field(line: &str, key: &str) -> Option<f64> {
    let rest = line.split(key).nth(1)?;
    let tok: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    tok.parse().ok()
}

/// Probe the total duration in seconds via ffprobe.
async fn probe_duration(input: &Path) -> Result<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(input)
        .output()
        .await
        .context("spawn ffprobe")?;
    if !output.status.success() {
        bail!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    s.parse::<f64>()
        .with_context(|| format!("parse duration '{s}'"))
}

/// Detect-and-trim. On success, the input file is rewritten in place. The
/// merge-temp lives alongside the input and is cleaned up regardless.
pub async fn trim_in_place(input: &Path, min_secs: f64) -> Result<TrimOutcome> {
    let ranges = detect_black_ranges(input, min_secs).await?;
    if ranges.is_empty() {
        return Ok(TrimOutcome::NoBlackFound);
    }

    let duration = probe_duration(input).await?;
    let keep = invert_ranges(&ranges, duration);
    if keep.is_empty() {
        bail!("ad-trim: entire recording is black — refusing to delete file");
    }

    let removed: f64 = ranges.iter().map(|r| r.duration()).sum();
    let parent = input.parent().unwrap_or(Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("recording");
    let ext = input.extension().and_then(|s| s.to_str()).unwrap_or("mkv");

    // Extract each keep range to a sibling temp with -c copy. Concat then
    // produces the final trimmed file.
    let mut segment_paths: Vec<PathBuf> = Vec::with_capacity(keep.len());
    let mut cleanup: Vec<PathBuf> = Vec::new();
    let extract_result = async {
        for (i, kr) in keep.iter().enumerate() {
            let seg = parent.join(format!(".{stem}.trim{i:03}.{ext}"));
            cleanup.push(seg.clone());
            let status = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
                .arg(format!("{:.3}", kr.start))
                .arg("-to")
                .arg(format!("{:.3}", kr.end))
                .arg("-i")
                .arg(input)
                .args(["-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero"])
                .arg(&seg)
                .status()
                .await
                .context("spawn ffmpeg segment extract")?;
            if !status.success() {
                bail!(
                    "ffmpeg segment extract failed (range {}: {:.2}-{:.2})",
                    i,
                    kr.start,
                    kr.end
                );
            }
            segment_paths.push(seg);
        }

        // concat list file
        let list_path = parent.join(format!(".{stem}.concat.txt"));
        cleanup.push(list_path.clone());
        let mut list = String::new();
        for s in &segment_paths {
            // ffmpeg concat demuxer expects POSIX-style escaping
            let p = s.to_string_lossy().replace('\'', "'\\''");
            list.push_str(&format!("file '{p}'\n"));
        }
        tokio::fs::write(&list_path, list)
            .await
            .context("write concat list")?;

        let merged = parent.join(format!(".{stem}.trimmed.{ext}"));
        cleanup.push(merged.clone());
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
            ])
            .arg(&list_path)
            .args(["-c", "copy"])
            .arg(&merged)
            .status()
            .await
            .context("spawn ffmpeg concat")?;
        if !status.success() {
            bail!("ffmpeg concat failed");
        }

        // Swap the trimmed file over the original.
        tokio::fs::rename(&merged, input)
            .await
            .map_err(|e| anyhow!("rename trimmed file over input: {e}"))?;
        // `merged` is now `input`; don't try to delete it in cleanup.
        cleanup.retain(|p| p != &merged);
        Ok::<_, anyhow::Error>(())
    }
    .await;

    // Best-effort cleanup of segment + list temps.
    for p in cleanup {
        let _ = tokio::fs::remove_file(p).await;
    }

    extract_result?;
    Ok(TrimOutcome::Trimmed {
        removed_secs: removed,
        ranges: ranges.len(),
    })
}

fn invert_ranges(black: &[BlackRange], total: f64) -> Vec<BlackRange> {
    let mut keep = Vec::new();
    let mut cursor = 0.0;
    for r in black {
        if r.start > cursor + 0.05 {
            keep.push(BlackRange {
                start: cursor,
                end: r.start,
            });
        }
        cursor = r.end.max(cursor);
    }
    if total > cursor + 0.05 {
        keep.push(BlackRange {
            start: cursor,
            end: total,
        });
    }
    keep
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invert_empty() {
        let k = invert_ranges(&[], 100.0);
        assert_eq!(k.len(), 1);
        assert_eq!(k[0].start, 0.0);
        assert_eq!(k[0].end, 100.0);
    }

    #[test]
    fn invert_middle() {
        let k = invert_ranges(
            &[BlackRange {
                start: 30.0,
                end: 60.0,
            }],
            100.0,
        );
        assert_eq!(k.len(), 2);
        assert_eq!(k[0].start, 0.0);
        assert_eq!(k[0].end, 30.0);
        assert_eq!(k[1].start, 60.0);
        assert_eq!(k[1].end, 100.0);
    }

    #[test]
    fn invert_leading_and_trailing() {
        let k = invert_ranges(
            &[
                BlackRange {
                    start: 0.0,
                    end: 10.0,
                },
                BlackRange {
                    start: 90.0,
                    end: 100.0,
                },
            ],
            100.0,
        );
        assert_eq!(k.len(), 1);
        assert_eq!(k[0].start, 10.0);
        assert_eq!(k[0].end, 90.0);
    }

    #[test]
    fn parse_blackdetect_line() {
        let line = "[blackdetect @ 0x7f] black_start:12.345 black_end:78.910 black_duration:66.565";
        assert_eq!(parse_field(line, "black_start:"), Some(12.345));
        assert_eq!(parse_field(line, "black_end:"), Some(78.910));
    }
}
