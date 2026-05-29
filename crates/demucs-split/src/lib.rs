//! Demucs source-separation wrapper — pure-data model + command builder.
//!
//! The Demucs project ships a Python CLI (`pip install demucs`, then
//! `python -m demucs.separate …`); StriVo treats it the same way it
//! treats ffmpeg: vendor at the host boundary, call it as a child
//! process. This crate carries the typed model + the argv builder so
//! the host wrapper is one `Command::new("python3").args(args).spawn()`
//! call.
//!
//! Why no Cdylib? Demucs runs an ML model — embedding the Python
//! runtime + torch weights inside a Rust dylib is impractical. The
//! shell-out matches every other ffmpeg-class integration in the
//! codebase.

use serde::{Deserialize, Serialize};

/// Available Demucs models, ordered cheapest → highest fidelity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DemucsModel {
    /// `htdemucs` — default; 4-stem hybrid transformer model.
    Htdemucs,
    /// `htdemucs_ft` — fine-tuned, slower, higher quality.
    HtdemucsFt,
    /// `mdx_extra_q` — quantised MDX-Net, fast.
    MdxExtraQ,
}

impl DemucsModel {
    /// CLI string for the `-n` flag.
    pub fn cli_name(self) -> &'static str {
        match self {
            Self::Htdemucs => "htdemucs",
            Self::HtdemucsFt => "htdemucs_ft",
            Self::MdxExtraQ => "mdx_extra_q",
        }
    }
}

/// Output stem subset. Demucs always emits four stems; the host can
/// post-filter to drop the ones the streamer doesn't need.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DemucsStem {
    Vocals,
    Drums,
    Bass,
    Other,
}

impl DemucsStem {
    pub fn file_basename(self) -> &'static str {
        match self {
            Self::Vocals => "vocals",
            Self::Drums => "drums",
            Self::Bass => "bass",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DemucsRequest {
    pub model: DemucsModel,
    pub input_path: String,
    pub output_dir: String,
    /// MP3 output instead of WAV when true. Useful for previewing in
    /// the SPA without a transcoding step.
    #[serde(default)]
    pub mp3: bool,
    /// `--two-stems` mode emits just vocals + accompaniment when set
    /// (much faster, smaller artefacts). `None` = full 4-stem.
    #[serde(default)]
    pub two_stems: Option<DemucsStem>,
}

impl DemucsRequest {
    /// Argv for `python -m demucs.separate …`.
    pub fn cli_args(&self) -> Vec<String> {
        let mut args = vec![
            "-m".into(),
            "demucs.separate".into(),
            "-n".into(),
            self.model.cli_name().into(),
            "-o".into(),
            self.output_dir.clone(),
        ];
        if self.mp3 {
            args.push("--mp3".into());
        }
        if let Some(stem) = self.two_stems {
            args.push("--two-stems".into());
            args.push(stem.file_basename().into());
        }
        args.push(self.input_path.clone());
        args
    }

    /// Expected output file for a given stem. Demucs lays the stems
    /// out as `<output_dir>/<model>/<input_basename>/<stem>.<ext>`.
    pub fn expected_stem_path(&self, stem: DemucsStem) -> String {
        let base = std::path::Path::new(&self.input_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("input");
        let ext = if self.mp3 { "mp3" } else { "wav" };
        format!(
            "{}/{}/{}/{}.{}",
            self.output_dir,
            self.model.cli_name(),
            base,
            stem.file_basename(),
            ext
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> DemucsRequest {
        DemucsRequest {
            model: DemucsModel::Htdemucs,
            input_path: "/tmp/clip.wav".into(),
            output_dir: "/tmp/stems".into(),
            mp3: false,
            two_stems: None,
        }
    }

    #[test]
    fn default_cli_argv() {
        let args = req().cli_args();
        assert_eq!(
            args,
            vec!["-m", "demucs.separate", "-n", "htdemucs", "-o", "/tmp/stems", "/tmp/clip.wav"]
        );
    }

    #[test]
    fn mp3_flag_appended() {
        let mut r = req();
        r.mp3 = true;
        assert!(r.cli_args().contains(&"--mp3".to_string()));
    }

    #[test]
    fn two_stems_appended_with_basename() {
        let mut r = req();
        r.two_stems = Some(DemucsStem::Vocals);
        let args = r.cli_args();
        assert!(args.windows(2).any(|w| w == ["--two-stems", "vocals"]));
    }

    #[test]
    fn expected_stem_path_for_wav() {
        let r = req();
        assert_eq!(
            r.expected_stem_path(DemucsStem::Vocals),
            "/tmp/stems/htdemucs/clip/vocals.wav"
        );
    }

    #[test]
    fn expected_stem_path_for_mp3() {
        let mut r = req();
        r.mp3 = true;
        assert_eq!(
            r.expected_stem_path(DemucsStem::Drums),
            "/tmp/stems/htdemucs/clip/drums.mp3"
        );
    }

    #[test]
    fn serde_round_trip_full_request() {
        let r = DemucsRequest {
            model: DemucsModel::HtdemucsFt,
            input_path: "/x.wav".into(),
            output_dir: "/out".into(),
            mp3: true,
            two_stems: Some(DemucsStem::Bass),
        };
        let j = serde_json::to_string(&r).unwrap();
        let back: DemucsRequest = serde_json::from_str(&j).unwrap();
        assert_eq!(r, back);
    }

    #[test]
    fn each_model_has_distinct_cli_name() {
        let names: std::collections::HashSet<_> = [
            DemucsModel::Htdemucs.cli_name(),
            DemucsModel::HtdemucsFt.cli_name(),
            DemucsModel::MdxExtraQ.cli_name(),
        ]
        .into_iter()
        .collect();
        assert_eq!(names.len(), 3);
    }

    #[test]
    fn each_stem_has_distinct_basename() {
        let names: std::collections::HashSet<_> = [
            DemucsStem::Vocals.file_basename(),
            DemucsStem::Drums.file_basename(),
            DemucsStem::Bass.file_basename(),
            DemucsStem::Other.file_basename(),
        ]
        .into_iter()
        .collect();
        assert_eq!(names.len(), 4);
    }
}
