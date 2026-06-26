//! A/B render compare — typed `RenderVariant` model + diff + VMAF/SSIM parser.
//!
//! A render variant is a snapshot of every editor setting that
//! affects what ffmpeg produces: insert-fx chain, pitch/time,
//! loudness target, sidechain duck depth, a free-form label, and a
//! creation timestamp. The host renders A and B against the same
//! EDL, runs `ffmpeg -lavfi libvmaf` or `-lavfi ssim` against the
//! pair, and parses the report through this crate.
//!
//! Pure-data: no IO. The host owns the ffmpeg spawn.

use serde::{Deserialize, Serialize};

/// One render variant — A or B in the compare set.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RenderVariant {
    pub label: String,
    /// Optional insert-fx chain. None = no chain (cleaner audio).
    #[serde(default)]
    pub insert_fx: Option<strivo_insert_fx::InsertChain>,
    /// Optional pitch / time warp. None = identity.
    #[serde(default)]
    pub pitch_time: Option<strivo_pitch::PitchTime>,
    /// Optional loudness target in LUFS. None = leave alone.
    #[serde(default)]
    pub loudness_target_lufs: Option<f64>,
    /// Optional sidechain duck depth in dB (negative). None = no
    /// duck.
    #[serde(default)]
    pub duck_db: Option<f64>,
    /// ISO-8601 creation stamp; the host stamps this when the user
    /// hits "Save as A" / "Save as B".
    #[serde(default)]
    pub stashed_at: String,
}

impl RenderVariant {
    /// Compose the ffmpeg `-af` slot for this variant. Empty when
    /// nothing audio-affecting is set.
    pub fn audio_filter(&self) -> String {
        let mut parts: Vec<String> = vec![];
        if let Some(chain) = &self.insert_fx {
            let s = chain.to_filter();
            if !s.is_empty() {
                parts.push(s);
            }
        }
        if let Some(pt) = &self.pitch_time {
            let s = pt.to_filter();
            if !s.is_empty() {
                parts.push(s);
            }
        }
        if let Some(target) = self.loudness_target_lufs {
            parts.push(format!("loudnorm=I={target}:LRA=7:TP=-1"));
        }
        parts.join(",")
    }
}

/// A single difference between A and B.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiffEntry {
    pub field: String,
    pub a: String,
    pub b: String,
}

/// Human-readable diff of two variants. Fields that match are
/// omitted. The host renders this side-by-side under the A/B player.
pub fn diff(a: &RenderVariant, b: &RenderVariant) -> Vec<DiffEntry> {
    let mut out = vec![];
    if a.label != b.label {
        out.push(DiffEntry {
            field: "label".into(),
            a: a.label.clone(),
            b: b.label.clone(),
        });
    }
    let an = a.insert_fx.as_ref().map(|c| c.effects.len()).unwrap_or(0);
    let bn = b.insert_fx.as_ref().map(|c| c.effects.len()).unwrap_or(0);
    if an != bn {
        out.push(DiffEntry {
            field: "insert_fx_stages".into(),
            a: an.to_string(),
            b: bn.to_string(),
        });
    }
    let at = a.pitch_time.as_ref().map(|p| p.tempo).unwrap_or(1.0);
    let bt = b.pitch_time.as_ref().map(|p| p.tempo).unwrap_or(1.0);
    if (at - bt).abs() > 1e-6 {
        out.push(DiffEntry {
            field: "tempo".into(),
            a: format!("{at:.3}×"),
            b: format!("{bt:.3}×"),
        });
    }
    let alut = a.loudness_target_lufs.unwrap_or(0.0);
    let blut = b.loudness_target_lufs.unwrap_or(0.0);
    if (alut - blut).abs() > 1e-6 {
        out.push(DiffEntry {
            field: "loudness_lufs".into(),
            a: format!("{alut:.1}"),
            b: format!("{blut:.1}"),
        });
    }
    let ad = a.duck_db.unwrap_or(0.0);
    let bd = b.duck_db.unwrap_or(0.0);
    if (ad - bd).abs() > 1e-6 {
        out.push(DiffEntry {
            field: "duck_db".into(),
            a: format!("{ad:.1}"),
            b: format!("{bd:.1}"),
        });
    }
    out
}

/// VMAF / SSIM report parsed out of ffmpeg's stderr. Both numbers
/// are optional so the caller can decide which metric to display.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct QualityReport {
    pub vmaf_mean: Option<f64>,
    pub ssim_all: Option<f64>,
}

/// Parse ffmpeg's `[libvmaf]` and `[Parsed_ssim_0]` lines.
///
/// Looks for the two canonical anchor strings:
///   `VMAF score: 95.4218`
///   `SSIM All: 0.954218 (15.123)`
/// Robust to surrounding whitespace and extra log lines.
pub fn parse_quality_report(stderr: &str) -> QualityReport {
    let mut out = QualityReport::default();
    for line in stderr.lines() {
        if let Some(idx) = line.find("VMAF score:") {
            if let Some(val) = line[idx + "VMAF score:".len()..].split_whitespace().next() {
                if let Ok(v) = val.parse::<f64>() {
                    out.vmaf_mean = Some(v);
                }
            }
        }
        if let Some(idx) = line.find("SSIM All:") {
            if let Some(val) = line[idx + "SSIM All:".len()..].split_whitespace().next() {
                if let Ok(v) = val.parse::<f64>() {
                    out.ssim_all = Some(v);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty() -> RenderVariant {
        RenderVariant {
            label: "x".into(),
            insert_fx: None,
            pitch_time: None,
            loudness_target_lufs: None,
            duck_db: None,
            stashed_at: String::new(),
        }
    }

    #[test]
    fn audio_filter_empty_when_nothing_set() {
        assert_eq!(empty().audio_filter(), "");
    }

    #[test]
    fn audio_filter_composes_voice_preset_and_loudnorm() {
        let mut v = empty();
        v.insert_fx = Some(strivo_insert_fx::InsertChain::voice_bus_default());
        v.loudness_target_lufs = Some(-14.0);
        let af = v.audio_filter();
        assert!(af.contains("highpass=f=80.0"));
        assert!(af.contains("loudnorm=I=-14"));
    }

    #[test]
    fn diff_lists_only_changed_fields() {
        let mut a = empty();
        let mut b = empty();
        a.label = "A".into();
        b.label = "B".into();
        b.loudness_target_lufs = Some(-16.0);
        let d = diff(&a, &b);
        let fields: Vec<&str> = d.iter().map(|e| e.field.as_str()).collect();
        assert!(fields.contains(&"label"));
        assert!(fields.contains(&"loudness_lufs"));
        assert_eq!(fields.len(), 2);
    }

    #[test]
    fn vmaf_score_parsed_from_canonical_line() {
        let stderr = "[libvmaf] VMAF score: 95.4218\n";
        let r = parse_quality_report(stderr);
        assert_eq!(r.vmaf_mean, Some(95.4218));
        assert_eq!(r.ssim_all, None);
    }

    #[test]
    fn ssim_score_parsed_from_canonical_line() {
        let stderr = "[Parsed_ssim_0 @ 0x7f] SSIM All: 0.954218 (15.123)\n";
        let r = parse_quality_report(stderr);
        assert_eq!(r.ssim_all, Some(0.954218));
        assert_eq!(r.vmaf_mean, None);
    }

    #[test]
    fn both_metrics_parsed_when_present() {
        let stderr = "noise\n[libvmaf] VMAF score: 89.0\nmore noise\nSSIM All: 0.91 (10)\n";
        let r = parse_quality_report(stderr);
        assert_eq!(r.vmaf_mean, Some(89.0));
        assert_eq!(r.ssim_all, Some(0.91));
    }

    #[test]
    fn serde_round_trip() {
        let mut v = empty();
        v.duck_db = Some(-12.0);
        v.pitch_time = Some(strivo_pitch::PitchTime::transpose_semitones(-2.0));
        let s = serde_json::to_string(&v).unwrap();
        let back: RenderVariant = serde_json::from_str(&s).unwrap();
        assert_eq!(v, back);
    }
}
