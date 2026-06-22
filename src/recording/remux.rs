//! Post-completion container normalisation.
//!
//! Twitch HLS captures pulled via yt-dlp land as raw MPEG-TS bytes with a
//! `.mkv` extension — yt-dlp's `hls-native` downloader concatenates
//! transport-stream segments without repackaging. mpv/VLC play the result
//! fine, but the `<video>` element in Chromium-based browsers (and Firefox)
//! refuses MPEG-TS regardless of the file extension or Content-Type the
//! server sends. We sniff the first byte on completion and, if it's a TS
//! sync (`0x47`), remux losslessly into real Matroska via `ffmpeg -c copy`.
//! EBML / MP4 files are left untouched.

use std::path::{Path, PathBuf};

use tokio::io::AsyncReadExt;

/// Result of a finalize-time container check.
#[derive(Debug)]
pub enum Outcome {
    /// File already a browser-playable container (EBML / MP4 / WebM).
    AlreadyOk,
    /// Was MPEG-TS — remuxed in place; the pre-remux bytes survive at
    /// `kept_original` as a safety copy the user can delete by hand.
    Remuxed { kept_original: PathBuf },
    /// Header too short / not a recognised signature — left alone.
    Skipped,
}

/// Sniff up to 12 header bytes and decide whether `path` needs remuxing.
///
/// MPEG-TS is identified by a `0x47` sync byte at offset 0; this is the
/// same primary check `detect_mime` in `crates/strivo-web` uses (the
/// stronger 188-byte second-sync isn't needed here — we're not deciding
/// MIME, just whether to remux).
pub async fn normalise_container(path: &Path) -> anyhow::Result<Outcome> {
    let mut f = tokio::fs::File::open(path).await?;
    let mut buf = [0u8; 12];
    let n = f.read(&mut buf).await?;
    drop(f);
    if n < 4 {
        return Ok(Outcome::Skipped);
    }
    // Already-good containers — leave alone.
    if &buf[..4] == [0x1A, 0x45, 0xDF, 0xA3].as_slice() {
        // EBML — Matroska / WebM
        return Ok(Outcome::AlreadyOk);
    }
    if n >= 8 && &buf[4..8] == b"ftyp" {
        // MP4 family (mp4 / m4a / m4v / mov)
        return Ok(Outcome::AlreadyOk);
    }
    if buf[0] != 0x47 {
        // Unknown — don't gamble; let the user remux manually if needed.
        return Ok(Outcome::Skipped);
    }

    // MPEG-TS detected. Remux to real MKV with lossless stream-copy.
    let orig = path.with_extension(format!(
        "orig.{}",
        path.extension().and_then(|e| e.to_str()).unwrap_or("mkv"),
    ));
    let tmp = path.with_extension("remuxed.mkv");

    let input = path.to_path_buf();
    let tmp_for_ffmpeg = tmp.clone();
    let status = tokio::task::spawn_blocking(move || {
        std::process::Command::new("ffmpeg")
            .args(["-y", "-hide_banner", "-loglevel", "warning"])
            .arg("-i")
            .arg(&input)
            .args(["-c", "copy", "-bsf:a", "aac_adtstoasc", "-f", "matroska"])
            .arg(&tmp_for_ffmpeg)
            .status()
    })
    .await??;
    if !status.success() {
        let _ = tokio::fs::remove_file(&tmp).await;
        anyhow::bail!("ffmpeg remux exited {status}");
    }

    // Atomic swap: input → .orig.<ext> (kept), tmp → input.
    tokio::fs::rename(path, &orig)
        .await
        .map_err(|e| anyhow::anyhow!("rename original: {e}"))?;
    if let Err(e) = tokio::fs::rename(&tmp, path).await {
        // Best-effort restore: put the original back, drop the tmp.
        let _ = tokio::fs::rename(&orig, path).await;
        let _ = tokio::fs::remove_file(&tmp).await;
        anyhow::bail!("install remuxed: {e}");
    }
    Ok(Outcome::Remuxed { kept_original: orig })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn write_header(bytes: &[u8]) -> tempfile::NamedTempFile {
        let f = tempfile::Builder::new()
            .suffix(".mkv")
            .tempfile()
            .expect("temp");
        tokio::fs::write(f.path(), bytes).await.unwrap();
        f
    }

    #[tokio::test]
    async fn ebml_is_left_alone() {
        let f = write_header(&[0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01]).await;
        let out = normalise_container(f.path()).await.unwrap();
        assert!(matches!(out, Outcome::AlreadyOk));
    }

    #[tokio::test]
    async fn mp4_is_left_alone() {
        let mut hdr = [0u8; 16];
        hdr[4..8].copy_from_slice(b"ftyp");
        hdr[8..12].copy_from_slice(b"isom");
        let f = write_header(&hdr).await;
        let out = normalise_container(f.path()).await.unwrap();
        assert!(matches!(out, Outcome::AlreadyOk));
    }

    #[tokio::test]
    async fn short_or_unknown_is_skipped() {
        let f = write_header(b"ab").await;
        assert!(matches!(
            normalise_container(f.path()).await.unwrap(),
            Outcome::Skipped
        ));
        let f = write_header(b"random garbage header").await;
        assert!(matches!(
            normalise_container(f.path()).await.unwrap(),
            Outcome::Skipped
        ));
    }
}
