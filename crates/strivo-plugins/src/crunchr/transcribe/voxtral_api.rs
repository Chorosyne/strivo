use std::path::Path;
use std::time::Duration;

use anyhow::Result;
use async_trait::async_trait;

use super::{TranscriptionBackend, TranscriptionResult};
use crate::crunchr::types::Segment;

/// Voxtral Transcribe 2 backend using the Mistral API.
/// $0.003/min, 4% WER, diarization included. Supports recordings up to
/// 3 hours per request, so an episode is transcribed in a single shot and
/// speaker labels stay globally consistent.
///
/// The file is sent as a multipart upload (not base64-in-JSON) so even a
/// multi-hour, tens-of-MB audio file streams without ballooning memory.
pub struct VoxtralApiBackend {
    api_key: String,
}

impl VoxtralApiBackend {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }
}

fn mime_for(file_name: &str) -> &'static str {
    match file_name.rsplit('.').next().map(|e| e.to_ascii_lowercase()) {
        Some(e) if e == "mp3" => "audio/mpeg",
        Some(e) if e == "wav" => "audio/wav",
        Some(e) if e == "ogg" || e == "opus" => "audio/ogg",
        Some(e) if e == "m4a" || e == "mp4" => "audio/mp4",
        Some(e) if e == "flac" => "audio/flac",
        Some(e) if e == "webm" => "audio/webm",
        _ => "application/octet-stream",
    }
}

#[async_trait]
impl TranscriptionBackend for VoxtralApiBackend {
    async fn transcribe(&self, audio_path: &Path) -> Result<TranscriptionResult> {
        let audio_bytes = tokio::fs::read(audio_path).await?;
        let file_name = audio_path
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("audio.mp3")
            .to_string();
        let mime = mime_for(&file_name);

        let form = reqwest::multipart::Form::new()
            .text("model", "voxtral-mini-latest")
            .text("temperature", "0")
            .text("diarize", "true")
            .text("timestamp_granularities[]", "segment")
            .part(
                "file",
                reqwest::multipart::Part::bytes(audio_bytes)
                    .file_name(file_name)
                    .mime_str(mime)?,
            );

        // Long server-side transcription of multi-hour audio: give it room.
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(3600))
            .build()?;
        let response = client
            .post("https://api.mistral.ai/v1/audio/transcriptions")
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            anyhow::bail!(
                "Voxtral API returned {status}: {}",
                body.chars().take(300).collect::<String>()
            );
        }

        let parsed: serde_json::Value = response.json().await?;

        if let Some(secs) = parsed["usage"]["prompt_audio_seconds"].as_f64() {
            tracing::info!(
                audio_seconds = secs,
                "voxtral-api: transcription complete (~${:.4})",
                secs / 60.0 * 0.003
            );
        }

        let full_text = parsed["text"].as_str().unwrap_or("").to_string();

        let segments = parsed["segments"]
            .as_array()
            .map(|segs| {
                segs.iter()
                    .enumerate()
                    .map(|(i, seg)| Segment {
                        index: i,
                        start_sec: seg["start"].as_f64().unwrap_or(0.0),
                        end_sec: seg["end"].as_f64().unwrap_or(0.0),
                        text: seg["text"].as_str().unwrap_or("").trim().to_string(),
                        speaker: parse_speaker(seg),
                        confidence: seg["avg_logprob"].as_f64(),
                        words: None, // segment-granularity response carries no word timings
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(TranscriptionResult {
            segments,
            full_text,
        })
    }

    fn supports_diarization(&self) -> bool {
        true
    }

    fn backend_name(&self) -> &'static str {
        "voxtral-api"
    }
}

/// Diarized speaker label, tolerating either a string id (`"speaker_id"` /
/// `"speaker"`) or an integer index that we render as `Speaker N`.
fn parse_speaker(seg: &serde_json::Value) -> Option<String> {
    if let Some(s) = seg["speaker_id"].as_str().or_else(|| seg["speaker"].as_str()) {
        return Some(s.to_string());
    }
    for key in ["speaker_id", "speaker"] {
        if let Some(n) = seg[key].as_u64() {
            return Some(format!("Speaker {n}"));
        }
    }
    None
}
