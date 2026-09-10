//! Resolve bundled external tool binaries (ffmpeg, ffprobe, mpv, streamlink,
//! yt-dlp) without relying purely on the system PATH.
//!
//! Installers bundle these five tools alongside the `strivo` binary so users
//! don't need them pre-installed. An AppImage's `AppRun` can prepend `PATH`
//! before Linux even reaches `main()`, but the Windows and macOS installers
//! have no equivalent mechanism — there's nothing to prepend PATH for a
//! bundled `bin/` directory sitting next to the executable. Rather than
//! build three platform-specific lookup strategies, every platform resolves
//! tools the same way: check candidate locations relative to the running
//! executable first, then fall back to PATH via the `which` crate.

use std::path::{Path, PathBuf};

/// Resolve `name` to a runnable path: an exe-relative bundled binary if one
/// exists, otherwise whatever `which` finds on PATH, otherwise the bare name
/// unchanged (so `Command::new(..)` still gets a sane, if ultimately
/// unresolvable, argument and the same "not found" failure mode a caller
/// would see from spawning the bare name directly).
pub fn resolve_tool(name: &str) -> PathBuf {
    if let Some(p) = exe_relative_tool_path(name) {
        return p;
    }
    which::which(name).unwrap_or_else(|_| PathBuf::from(name))
}

/// Check the exe-relative candidate locations for a bundled `name`, in
/// priority order, returning the first that exists as a file.
fn exe_relative_tool_path(name: &str) -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    candidate_paths(&exe_dir, name)
        .into_iter()
        .find(|p| p.is_file())
}

/// Pure candidate-path construction, split out from [`exe_relative_tool_path`]
/// so it can be unit-tested against a tempdir without mocking
/// `std::env::current_exe()`.
fn candidate_paths(exe_dir: &Path, name: &str) -> Vec<PathBuf> {
    let file_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    vec![
        // Linux AppImage `usr/bin/`, Windows installer `bin\`, and a
        // generic fallback layout.
        exe_dir.join("bin").join(&file_name),
        // macOS `.app` bundle: `Contents/MacOS/strivo` ->
        // `Contents/Resources/bin/<name>`.
        exe_dir
            .join("..")
            .join("Resources")
            .join("bin")
            .join(&file_name),
        // Portable/dev layout: binary and tools flat in the same directory.
        exe_dir.join(&file_name),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_tool_falls_back_to_bare_name_when_unresolvable() {
        let name = "strivo-definitely-not-a-real-tool-xyz";
        assert_eq!(resolve_tool(name), PathBuf::from(name));
    }

    #[test]
    fn candidate_paths_finds_exe_relative_bin_file() {
        let tmp = tempfile::tempdir().unwrap();
        let bin_dir = tmp.path().join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let file_name = if cfg!(windows) {
            "some-tool.exe"
        } else {
            "some-tool"
        };
        let tool_path = bin_dir.join(file_name);
        std::fs::write(&tool_path, b"").unwrap();

        let candidates = candidate_paths(tmp.path(), "some-tool");
        let found = candidates.into_iter().find(|p| p.is_file());
        assert_eq!(found, Some(tool_path));
    }

    #[test]
    fn candidate_paths_no_match_when_nothing_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let candidates = candidate_paths(tmp.path(), "some-tool");
        assert!(candidates.into_iter().all(|p| !p.is_file()));
    }
}
