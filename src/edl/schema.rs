//! EDL serde schema.

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

/// Schema version. Bump on any breaking change; the loader rejects
/// unrecognized versions so older binaries can't silently mis-interpret
/// newer files.
pub const EDL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdlKind {
    /// Pipeline ops applied to each input vod.
    Batch,
    /// Clip + concat ops producing a derived output.
    Edit,
    /// Reusable op chain without bound inputs.
    Preset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdlInput {
    /// Stable identifier within this StriVo install (recording uuid or
    /// archiver video_id).
    pub vod_id: String,
    /// Path to the source media. Optional — preset EDLs leave this empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
}

/// One verb in an EDL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum EdlOp {
    /// Extract audio (ffmpeg). Implicit in Transcribe today but exposable
    /// so a preset can declare "extract once, transcribe twice with
    /// different providers."
    Extract,
    Transcribe {
        provider: String,
        #[serde(default)]
        params: BTreeMap<String, serde_json::Value>,
    },
    Diarize {
        provider: String,
        #[serde(default)]
        params: BTreeMap<String, serde_json::Value>,
    },
    Subtitle,
    Analyze {
        provider: String,
        #[serde(default)]
        params: BTreeMap<String, serde_json::Value>,
    },
    /// Word-indexed clip — in/out are indices into the transcript's word
    /// stream (whisperx/voxtral produce word-level timings; see C5).
    Clip {
        in_word: u32,
        out_word: u32,
        #[serde(default)]
        label: String,
    },
    /// Lossless concat of N clips into one output. Indices reference
    /// `Clip` ops earlier in the same EDL's ops list.
    Concat {
        clips: Vec<usize>,
        output: String,
    },
    /// Pull a VOD via Archiver/yt-dlp. Used by batch EDLs that wire
    /// "pull-then-transcribe" through a single Pipeline.
    Archive {
        url: String,
    },
    /// Drop segments belonging to listed speakers, or keep only listed
    /// speakers if `keep_only=true`. Stolen from Aegisub's style model.
    FilterSpeaker {
        speakers: Vec<String>,
        keep_only: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdlDoc {
    pub version: u32,
    pub kind: EdlKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<EdlInput>,
    pub ops: Vec<EdlOp>,
    pub created_at: String,
    pub created_by: String,
}

impl EdlDoc {
    pub fn new(kind: EdlKind, name: impl Into<String>) -> Self {
        Self {
            version: EDL_VERSION,
            kind,
            name: name.into(),
            inputs: vec![],
            ops: vec![],
            created_at: chrono::Utc::now().to_rfc3339(),
            created_by: format!("strivo-{}", env!("CARGO_PKG_VERSION")),
        }
    }

    /// Validate the document's schema + topology.
    ///
    /// - Version must match `EDL_VERSION`.
    /// - Concat ops must reference Clip ops by valid index.
    /// - Edit-kind EDLs must have at least one input bound.
    /// - Preset-kind EDLs must have zero inputs.
    pub fn validate(&self) -> Result<()> {
        if self.version != EDL_VERSION {
            return Err(anyhow!(
                "EDL schema version {} unsupported (this build understands {})",
                self.version,
                EDL_VERSION
            ));
        }

        if matches!(self.kind, EdlKind::Edit) && self.inputs.is_empty() {
            return Err(anyhow!("edit-kind EDL needs at least one input vod"));
        }

        if matches!(self.kind, EdlKind::Preset) && !self.inputs.is_empty() {
            return Err(anyhow!(
                "preset-kind EDL must have zero inputs (presets are unbound op chains)"
            ));
        }

        // Concat indices reference Clip ops earlier in the ops list.
        for (i, op) in self.ops.iter().enumerate() {
            if let EdlOp::Concat { clips, .. } = op {
                for &idx in clips {
                    if idx >= i {
                        return Err(anyhow!(
                            "concat op #{i} references clip op #{idx} that doesn't precede it"
                        ));
                    }
                    if !matches!(self.ops[idx], EdlOp::Clip { .. }) {
                        return Err(anyhow!(
                            "concat op #{i} references op #{idx} which is not a Clip"
                        ));
                    }
                }
            }
        }

        // Clip in_word < out_word.
        for (i, op) in self.ops.iter().enumerate() {
            if let EdlOp::Clip {
                in_word, out_word, ..
            } = op
            {
                if in_word >= out_word {
                    return Err(anyhow!(
                        "clip op #{i}: in_word ({in_word}) must be < out_word ({out_word})"
                    ));
                }
            }
        }

        Ok(())
    }
}
